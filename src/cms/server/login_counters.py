"""Failure counters for the adaptive login CAPTCHA and its lockout.

Mirrors the admin panel's loginBuckets map. The counting lives here, the
decision to demand a captcha lives in captcha.py, and where the buckets are
kept lives in login_counter_backend.py.

Two independent things are enforced from the same counts: the *adaptive
captcha*, demanded once `threshold` failures accumulate, and the *lockout*,
an outright refusal at `ban_threshold` failures.

The lockout is the security boundary. Counts are therefore retained for the
whole window instead of being dropped at the threshold: a count that resets
when the threshold is reached re-arms itself on every subsequent attempt, so an
attacker who keeps guessing walks past the boundary meant to stop them.
"""

import ipaddress
import logging
import threading
import typing

from cms.server.login_counter_backend import (CounterBackend, InProcessBackend,
                                              build_backend)


logger = logging.getLogger(__name__)

# How long a failure count survives without a new failure, mirroring the
# panel's LOGIN_LOCKOUT_MS (15 minutes). Each new failure restarts the window,
# as incrementBucket does there.
FAILURE_WINDOW = 15 * 60

# Ceiling on tracked buckets. The panel caps its map the same way (MAX_LOGIN_
# BUCKETS); without a cap, a run of failed logins on fresh usernames would
# otherwise grow this map without bound.
MAX_BUCKETS = 1000


def is_loopback(ip: str) -> bool:
    """Return whether *ip* is a loopback address."""
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        # WHY not treat an unparseable address as loopback: it is more likely a
        # malformed header than a real local client, and skipping its IP bucket
        # would remove one of the two protections.
        return False


class LoginFailureCounters:
    """Failure counters for the adaptive captcha and the login lockout.

Mirrors the panel's `loginBuckets` map: keys are `"{username}|{ip}"` for
    the per-account family, each count lapses after `FAILURE_WINDOW` without a
    new failure, and the map is capped. Both families are tracked because the
    per-account bucket keeps one attacker on one account from exhausting the
    map, and the per-IP bucket stops the same source from resetting its counter
    by rotating usernames; tracking only one leaves the other bypassable.

    The buckets live in an injected backend, so the algorithm below is the same
    whether the counts sit in this process or in a Redis that outlives a restart.
    """

    def __init__(self, backend: CounterBackend | None = None,
                 degraded: bool = False) -> None:
        # WHY a lock here as well as inside the backend: an operation touches
        # both key families, and holding one lock across them keeps a concurrent
        # read from seeing a half-recorded failure. The backend's own lock is
        # always the inner one, so the order can never invert.
        self._lock = threading.Lock()
        # WHY a plain default rather than reading the config here: the counters
        # are standalone so the test suite can drive them without a config, and
        # Captcha builds the configured backend when it is constructed.
        self._backend = backend if backend is not None else InProcessBackend()
        # WHY the counters own this flag: it is a property of where the counts
        # are kept, and the captcha needs it to decide what to demand.
        self._degraded = degraded
        self._ban_threshold = 5

    @property
    def degraded(self) -> bool:
        """Return whether the shared backend is unreachable.

        True means the counts are process-local because Redis could not be
        reached, so a restart or another web server can clear them and the
        lockout is not holding across the deployment.

        """
        return self._degraded

    def clear(self) -> None:
        """Forget every recorded failure.

        Only the test suite calls this: the process-wide counters of a running
        server must not be droppable from outside.

        """
        with self._lock:
            self._backend.clear()

    def clear_for(self, username: str, ip: str) -> None:
        """Forget the failures recorded against one account and address.

        Called after a successful login, as the panel's completeLogin clears
        the buckets it incremented: whoever gets the password right starts over.

        """
        with self._lock:
            self._backend.delete([f"{username}|{ip}", self._ip_key(ip)])

    def record_success(self, username: str, ip: str) -> None:
        """Forget the failures behind an account and address after a login.

        The counterpart to `record_failure`, and an alias of `clear_for`, so a
        caller holding only the counters can pair the two without the captcha.

        """
        self.clear_for(username, ip)

    def count(self, username: str, ip: str) -> int:
        """Return the failures recorded for this account and address.

        The two families are reported separately because they mean different
        things: the per-account count is what an attacker grinding one account
        accumulates, and the per-IP count is what they accumulate by rotating
        usernames. Expired counters read as zero.

        """
        with self._lock:
            account = self._live_count(f"{username}|{ip}")
            address = self._live_count(self._ip_key(ip))
        return max(account, address)

    def is_limited(self, username: str, ip: str) -> bool:
        """Return whether this account and address are locked out.

        Mirrors the panel's `isBucketAtLimit`: at or past the ban threshold
        while the window is still live. `count` already reads a lapsed window as
        zero, so the two conditions are the same test.

        This is a query, not an action: it never resets the count. The counter
        keeping climbing is what makes the refusal hold on every later attempt
        instead of handing out a fresh allowance after each one.

        """
        return self.count(username, ip) >= self._ban_threshold

    def record_failure(self, username: str, ip: str) -> None:
        """Count one more failed attempt against this account and address."""
        ban_threshold = self._ban_threshold
        with self._lock:
            self._increment(f"{username}|{ip}", ban_threshold)
            if not is_loopback(ip):
                self._increment(self._ip_key(ip), ban_threshold)

    def set_ban_threshold(self, value: int) -> None:
        """Set the failure count at which the account or address is refused.

        Clamped to at least one, so a misconfigured zero cannot express
        "lock everyone out at all times" by accident.

        """
        self._ban_threshold = max(1, value)

    def _increment(self, key: str, ban_threshold: int) -> None:
        """Bump one counter, keeping the window sliding.

        WHY the count is not dropped at the threshold: dropping it there would
        re-arm the counter on the very next attempt, which is the difference
        between a lockout and an unlimited number of guesses.

        """
        if self._increment_backend(key) >= ban_threshold:
            logger.info("Login failure counter for %r is at the ban "
                        "threshold; refusing further attempts.", key)

    def _increment_backend(self, key: str) -> int:
        """Add one to *key* through the backend and return the new total.

        Redis increments atomically, so two web server processes cannot lose
        one another's failure between a read and a write.

        """
        increment = getattr(self._backend, "increment", None)
        if increment is not None:
            # WHY no eviction here: Redis expires each key on its own once its
            # window lapses, so the map cannot grow past the keys still inside
            # their window.
            return int(increment(key, FAILURE_WINDOW))
        previous = self._live_count(key)
        self._backend.write(key, previous + 1, FAILURE_WINDOW)
        self._evict_if_full(self._ban_threshold)
        return previous + 1

    def _evict_if_full(self, ban_threshold: int) -> None:
        """Keep the map bounded by dropping a counter that is cheapest to lose.

        WHY the ban threshold and not the map cap: the cap is the size of the
        map, so every count is trivially below it and the comparison selects
        nothing. The threshold is what actually marks a bucket as holding a
        live lockout, and that is what must never be the victim.

        """
        if len(self._backend.keys()) <= MAX_BUCKETS:
            return
        victim = self._disposable_key(ban_threshold)
        if victim is not None:
            self._backend.delete([victim])

    def _disposable_key(self, ban_threshold: int) -> typing.Optional[str]:
        """Return a bucket that is not holding a live lockout, if any.

        Prefers the bucket closest to lapsing, so the ones with the most left
        to do survive. Mirrors the panel's `evictSafestLoginBucket`.

        """
        fallback: typing.Optional[str] = None
        shortest: typing.Optional[float] = None
        for key in self._backend.keys():
            bucket = self._backend.read(key)
            if bucket is None or bucket[0] < ban_threshold:
                return key
            if shortest is None or bucket[1] < shortest:
                shortest, fallback = bucket[1], key
        return fallback

    def _ip_key(self, ip: str) -> str:
        """Return the per-IP bucket key.

        The `ip#` prefix is what the panel uses: usernames are operator-defined
        and may contain anything, so the family needs a separator shape that no
        username key can ever take.

        """
        return f"ip#{ip}"

    def _live_count(self, key: str) -> int:
        """Return a counter's value, or zero when its window has lapsed."""
        bucket = self._backend.read(key)
        return 0 if bucket is None else bucket[0]


def build_counters(config: typing.Any) -> LoginFailureCounters:
    """Return the counters *config* asks for, and record how they are kept."""
    backend, degraded = build_backend(config, FAILURE_WINDOW)
    return LoginFailureCounters(backend, degraded)


__all__ = ["LoginFailureCounters", "build_counters", "is_loopback",
           "FAILURE_WINDOW", "MAX_BUCKETS"]
