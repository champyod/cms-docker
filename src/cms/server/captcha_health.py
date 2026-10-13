"""Provider health for the CAPTCHA chain.

A provider is marked unhealthy when its siteverify cannot be reached, so the next
provider in a service's chain is used until the cooldown lapses. Only a transport
failure counts: a refused or expired token is an ordinary rejection and must not
push a provider out of the chain.

The health counters live in the same shared Redis as the login counters when one
is configured, under their own namespace, so one replica's observation is seen by
every other; without Redis they are process-local.
"""

import logging
import typing

from cms.server.login_counter_backend import InProcessBackend, RedisBackend


logger = logging.getLogger(__name__)

# Namespace for the health keys, distinct from cms:login: so a lockout reader
# never mistakes a health counter for a failure bucket.
HEALTH_PREFIX = "cms:captcha:health:"
# Transport failures within one cooldown before a provider is skipped, and how
# long the skip lasts. WHY a threshold and not a single blip: one timeout must
# not move every login off the primary provider.
HEALTH_FAILURES = 3
HEALTH_COOLDOWN = 60


class ProviderHealth:
    """Whether each provider's siteverify is currently reachable."""

    def __init__(self, backend: typing.Any = None) -> None:
        self._backend = backend if backend is not None else InProcessBackend()

    def is_healthy(self, provider: str) -> bool:
        """Return whether *provider* may still be selected."""
        bucket = self._backend.read(f"health:{provider}")
        return bucket is None or bucket[0] < HEALTH_FAILURES

    def record_failure(self, provider: str) -> None:
        """Count one unreachable check against *provider*."""
        key = f"health:{provider}"
        bucket = self._backend.read(key)
        count = (bucket[0] if bucket is not None else 0) + 1
        self._backend.write(key, count, HEALTH_COOLDOWN)
        if count >= HEALTH_FAILURES:
            logger.warning("CAPTCHA provider %s is unreachable; the chain skips "
                           "it for %d seconds.", provider, HEALTH_COOLDOWN)

    def record_success(self, provider: str) -> None:
        """Forget *provider*'s failures after a check it answered."""
        self._backend.delete([f"health:{provider}"])


def build_health(config: typing.Any) -> ProviderHealth:
    """Return the health store *config* asks for.

    The shared Redis is used when the login counters already use it; otherwise
    the store is process-local, which still fails over within one process.
    """
    if not bool(getattr(config, "redis_enabled", False)):
        return ProviderHealth()
    try:
        backend = RedisBackend.connect(str(config.redis_host),
                                       int(config.redis_port), HEALTH_COOLDOWN,
                                       prefix=HEALTH_PREFIX)
    except Exception as exc:
        # WHY not raise: an unreachable Redis already degrades the counters, and
        # a login must not fail because the health store is down; health is then
        # tracked in process.
        logger.error("Redis is configured for provider health but could not be "
                     "reached (%s); health is tracked in process.", exc)
        return ProviderHealth()
    return ProviderHealth(backend)


__all__ = ["ProviderHealth", "build_health", "HEALTH_PREFIX",
           "HEALTH_FAILURES", "HEALTH_COOLDOWN"]
