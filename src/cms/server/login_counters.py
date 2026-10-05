"""In-memory failure counters for the adaptive login CAPTCHA.

Mirrors the admin panel's loginBuckets map. Split out of captcha.py so each file
stays readable: this one owns the counting, the other the decision to demand.
"""

import ipaddress
import logging
import threading
import time


# Ceiling on tracked buckets. The panel caps its map the same way (MAX_LOGIN_
# BUCKETS); without a cap, a run of failed logins on fresh usernames would
# otherwise grow this map without bound.
# How long a failure count survives without a new failure, mirroring the
# panel's LOGIN_LOCKOUT_MS (15 minutes). Each new failure restarts the window,
# as incrementBucket does there.
FAILURE_WINDOW = 15 * 60


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

logger = logging.getLogger(__name__)

class LoginFailureCounters:
    """In-memory failure counters for the adaptive captcha.

    Mirrors the panel's `loginBuckets` map: keys are `"{username}|{ip}"` for
    the per-account family, each count lapses after `FAILURE_WINDOW` without a
    new failure, counters are dropped once `ban_threshold` is reached, and the
    map is capped.

    Why both key families are tracked: the per-account bucket keeps one
    attacker on one account from exhausting the map, and the per-IP bucket
    stops the same source from resetting its counter by rotating usernames.
    Tracking only one of them leaves the other trivially bypassable.

    The counters live in process memory, exactly as the panel's do. They are
    therefore per web-server process and are lost on restart; a restart
    lowers the barrier rather than raising it, which is the safe direction to
    fail in.
    """

    def __init__(self) -> None:
        # A login can be requested concurrently by several tornado threads, so
        # the map needs a lock to keep a concurrent increment from losing one.
        self._buckets: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()
        # WHY a plain default rather than reading the config here: the counters
        # are standalone so the test suite can drive them without a config, and
        # Captcha sets the real value from its own section when it is built.
        self._ban_threshold = 5

    def clear(self) -> None:
        """Forget every recorded failure.

        Only the test suite calls this: the process-wide counters of a running
        server must not be droppable from outside.

        """
        with self._lock:
            self._buckets.clear()

    def clear_for(self, username: str, ip: str) -> None:
        """Forget the failures recorded against one account and address.

        Called after a successful login, as the panel's completeLogin clears
        the buckets it incremented: whoever eventually gets the password right
        starts from a clean count.

        """
        with self._lock:
            self._buckets.pop(f"{username}|{ip}", None)
            self._buckets.pop(self._ip_key(ip), None)

    def count(self, username: str, ip: str) -> int:
        """Return the failures recorded for this account and address.

        The two families are reported separately because they mean different
        things: the per-account count is what an attacker grinding one account
        accumulates, and the per-IP count is what they accumulate by rotating
        usernames. Expired counters read as zero.

        """
        now = time.monotonic()
        with self._lock:
            account = self._live_count(f"{username}|{ip}", now)
            address = self._live_count(self._ip_key(ip), now)
        return max(account, address)

    def record_failure(self, username: str, ip: str) -> None:
        """Count one more failed attempt against this account and address."""
        ban_threshold = self._ban_threshold
        now = time.monotonic()
        with self._lock:
            self._increment(f"{username}|{ip}", now, ban_threshold)
            if not is_loopback(ip):
                self._increment(self._ip_key(ip), now, ban_threshold)

    def set_ban_threshold(self, value: int) -> None:
        """Set the failure count at which counters are dropped."""
        self._ban_threshold = value

    def _increment(self, key: str, now: float, ban_threshold: int) -> None:
        """Bump one counter, resetting it if it has reached the ban."""
        entry = self._buckets.get(key)
        count = entry[0] if entry is not None else 0
        count += 1
        if count >= ban_threshold:
            # WHY drop instead of keep counting: past the ban threshold the
            # attempt is refused by the rate limiter, so a retained counter
            # would pin the captcha on forever. This is the panel's behaviour
            # (its isRateLimited/clearBucket pair), kept so the two surfaces
            # escalate identically.
            logger.info("Login failure counter for %r reached the ban "
                        "threshold; resetting it.", key)
            count = 0
        # The stored second is the moment the count lapses, not the moment of
        # the failure: a counter is live while now is before it.
        self._buckets[key] = (count, now + FAILURE_WINDOW)
        self._evict_if_full()

    def _evict_if_full(self) -> None:
        """Keep the map bounded by dropping a counter that is cheapest to lose."""
        if len(self._buckets) <= MAX_BUCKETS:
            return
        # Prefer a counter that is not itself holding a lockout, so an
        # attacker cannot push out a live ban by flooding with fresh usernames.
        disposable = [key for key, (count, _) in self._buckets.items()
                      if count < MAX_BUCKETS]
        victim = disposable[0] if disposable else next(iter(self._buckets))
        del self._buckets[victim]

    def _ip_key(self, ip: str) -> str:
        """Return the per-IP bucket key.

        The `ip#` prefix is what the panel uses: usernames are operator-defined
        and may contain anything, so the family needs a separator shape that no
        username key can ever take, and the prefix also keeps the two families
        distinguishable.

        """
        return f"ip#{ip}"

    def _live_count(self, key: str, now: float) -> int:
        """Return a counter's value, or zero when its window has lapsed."""
        entry = self._buckets.get(key)
        if entry is None:
            return 0
        if now >= entry[1]:
            del self._buckets[key]
            return 0
        return entry[0]
