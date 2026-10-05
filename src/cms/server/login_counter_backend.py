"""Storage backends behind the login failure counters.

`LoginFailureCounters` owns the counting algorithm; this module owns where the
buckets live. `CounterBackend` states what both backends have to guarantee, so
the security decisions stay in one file and the persistence details in another.

Two backends implement one interface: `InProcessBackend`, the process-local
dict, which is what a deployment with no Redis configured gets and what a Redis
outage falls back to; and `RedisBackend`, which keeps the counts in a shared
instance so a lockout survives a web server restart and is seen by every process
behind the proxy.

The Redis import is guarded on purpose: the contest server must start on the
standard library alone, so a deployment that never enabled Redis cannot be
taken down by the package being absent.
"""

import logging
import threading
import time
import typing


logger = logging.getLogger(__name__)

# Namespace for every key this module writes. The instance is shared with other
# CMS components, so the prefix is what keeps login counters from colliding
# with an unrelated key that happens to share a name.
REDIS_KEY_PREFIX = "cms:login:"


class CounterBackend(typing.Protocol):
    """Where the login failure buckets are kept.

    A bucket reads back as ``(count, seconds_left)``. Keys are the counters'
    own key shape, unprefixed: the backend owns the namespace.

    """

    def read(self, key: str) -> typing.Optional[typing.Tuple[int, float]]:
        """Return ``(count, seconds_left)`` under *key*, or None when lapsed.

        The seconds count down to the lapse, so what a backend keeps to
        remember a window is its own business and a caller never has to know
        whose clock it is reading.

        """
        ...

    def write(self, key: str, count: int, expires_in: float) -> None:
        """Store *count* under *key* for the next *expires_in* seconds.

        A span and never an absolute moment: the backends keep their windows on
        different clocks, and only a span means the same to each of them.
        """
        ...

    def delete(self, key: typing.Iterable[str]) -> None:
        """Forget every bucket named in *key*."""
        ...

    def keys(self) -> typing.List[str]:
        """Return every bucket key currently tracked."""
        ...

    def clear(self) -> None:
        """Forget every tracked bucket."""
        ...


class InProcessBackend:
    """Counters in a dict owned by this process.

    Counts are per process and are lost on restart. Losing them lowers the
    barrier rather than raising it, which is the safe direction in which to
    lose that state.

    """

    def __init__(self, clock: typing.Callable[[], float] = time.monotonic) -> None:
        self._buckets: dict[str, tuple[int, float]] = {}
        # WHY the clock is injected: a test has to let a window lapse
        # without waiting out a real one.
        self._clock = clock
        # A login can be requested concurrently by several tornado threads, so
        # the map needs a lock to keep a concurrent increment from losing one.
        self._lock = threading.Lock()

    def read(self, key: str) -> typing.Optional[typing.Tuple[int, float]]:
        """Return the count and the seconds left, or None when there is none."""
        with self._lock:
            bucket = self._buckets.get(key)
            # WHY the lapsed bucket is dropped rather than merely ignored:
            # buckets leave this dict only when someone looks at them, so a key
            # nobody looks at again would sit here until the process ends and
            # let the map grow past the cap it is held to.
            if bucket is None or self._clock() >= bucket[1]:
                self._buckets.pop(key, None)
                return None
            return bucket[0], bucket[1] - self._clock()

    def write(self, key: str, count: int, expires_in: float) -> None:
        with self._lock:
            self._buckets[key] = (count, self._clock() + max(0.0, expires_in))

    def delete(self, key: typing.Iterable[str]) -> None:
        with self._lock:
            for one in key:
                self._buckets.pop(one, None)

    def keys(self) -> typing.List[str]:
        with self._lock:
            return list(self._buckets)

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


class RedisBackend:
    """Counters in a shared Redis, incremented atomically.

    Every counter is an `INCR` plus an `EXPIRE` on the same key, so the count
    cannot be lost to a read-modify-write race between two web server
    processes, and the key disappears on its own when the window lapses.

    """

    def __init__(self, client: typing.Any) -> None:
        self._client = client

    @classmethod
    def connect(cls, host: str, port: int,
                window: float) -> "RedisBackend":
        """Build a backend against *host*:*port*.

        Raises whatever the client raises when the instance cannot be reached,
        which the caller turns into the degraded path rather than letting a
        login request fail.

        """
        # WHY imported here and not at module scope: the client is an optional
        # dependency, and importing it at import time would make its absence a
        # startup failure for deployments that never enabled Redis.
        import redis

        client = redis.Redis(host=host, port=port, socket_connect_timeout=1.0,
                             socket_timeout=1.0, decode_responses=True)
        client.ping()
        logger.info("Login counters are backed by Redis at %s:%d.", host, port)
        return cls(client)

    def read(self, key: str) -> typing.Optional[typing.Tuple[int, float]]:
        """Return the count and the seconds left in *key*'s window.

        A key that has expired reads as absent, which is what makes a lapsed
        window indistinguishable from a failure that never happened.

        """
        namespaced = self._key(key)
        pipe = self._client.pipeline()
        pipe.get(namespaced)
        pipe.ttl(namespaced)
        count, ttl = pipe.execute()
        if count is None or ttl is None or ttl < 0:
            return None
        return int(count), float(ttl)

    def write(self, key: str, count: int, expires_in: float) -> None:
        """Store *count* with a TTL, for callers that already know the value.

        The value is set outright rather than incremented, so this is for
        restoring a known count; new failures go through `increment`.

        """
        namespaced = self._key(key)
        pipe = self._client.pipeline()
        pipe.set(namespaced, count)
        pipe.expire(namespaced, max(1, int(expires_in)))
        pipe.execute()

    def delete(self, key: typing.Iterable[str]) -> None:
        namespaced = [self._key(one) for one in key]
        if namespaced:
            self._client.delete(*namespaced)

    def keys(self) -> typing.List[str]:
        """Return the tracked keys with the namespace stripped off.

        The prefix keeps the scan from touching unrelated keys in the instance.

        """
        found = self._client.keys(f"{REDIS_KEY_PREFIX}*")
        return [str(one)[len(REDIS_KEY_PREFIX):] for one in found]

    def clear(self) -> None:
        tracked = self.keys()
        self.delete(tracked)

    def increment(self, key: str, window: float) -> int:
        """Add one failure to *key* and return the running total.

        `INCR` and `EXPIRE` are issued together, so a counter that is being
        pushed over the threshold still keeps its window: the lockout slides
        forward with each attempt instead of expiring under the attacker, who
        would otherwise regain a fresh counter every window.

        """
        namespaced = self._key(key)
        pipe = self._client.pipeline()
        pipe.incr(namespaced)
        pipe.expire(namespaced, max(1, int(window)))
        total, _ = pipe.execute()
        return int(total)

    def _key(self, key: str) -> str:
        """Return the Redis key for a counter key."""
        return f"{REDIS_KEY_PREFIX}{key}"


def build_backend(config: typing.Any, window: float,
                  fallback: CounterBackend | None = None
                  ) -> tuple[CounterBackend, bool]:
    """Return the backend for *config* and whether it is running degraded.

    Degraded means Redis was configured but could not be reached, so the
    counters live in the *fallback* (in-process) dict and the caller has to
    demand a captcha on every attempt: an unreachable lockout store must tax
    the attacker rather than stop guarding the login.

    """
    local = fallback if fallback is not None else InProcessBackend()
    if not bool(getattr(config, "redis_enabled", False)):
        return local, False
    try:
        backend = RedisBackend.connect(str(config.redis_host),
                                       int(config.redis_port), window)
    except Exception as exc:
        # WHY not re-raise: refusing every login would turn a Redis outage into
        # a total outage. Degrading keeps the adaptive captcha working, which
        # is what still stands between an attacker and the password.
        logger.error("Redis is configured for the login counters but could not "
                     "be reached (%s); counting in process and demanding the "
                     "captcha on every attempt.", exc)
        return local, True
    return backend, False


__all__ = ["CounterBackend", "InProcessBackend", "RedisBackend",
           "build_backend", "REDIS_KEY_PREFIX"]
