use std::time::Duration;

use redis::AsyncCommands;

use crate::config::CaptchaProvider;

/// Provider health for the CAPTCHA chain, in the same Redis as the counters but
/// under its own namespace, so an unreachable provider seen by one replica is
/// skipped by every replica.
const HEALTH_NAMESPACE: &str = "cms:captcha:health:";
/// Unreachable checks within one cooldown before a provider is skipped.
const HEALTH_FAILURES: u32 = 3;
const HEALTH_COOLDOWN_SECONDS: u64 = 60;

fn health_key(provider: CaptchaProvider) -> String {
    format!("{HEALTH_NAMESPACE}{}", provider.wire_name())
}

/// The failure counters live in the Redis the stack already runs for rate limiting,
/// so a restart does not forgive a brute-force run and the panel can read the same
/// keys to list and clear them.
#[derive(Clone)]
pub struct Counter {
    manager: redis::aio::ConnectionManager,
}

impl Counter {
    pub async fn connect(url: &str) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(url)?;
        let manager = redis::aio::ConnectionManager::new(client).await?;
        Ok(Self { manager })
    }

    /// INCR, with the expiry set only on the first write of a window, so the window
    /// does not slide forward on every attempt and a lockout cannot be extended by
    /// trying again.
    pub async fn record_failure(
        &self,
        key: &str,
        window: Duration,
    ) -> Result<u32, redis::RedisError> {
        let mut connection = self.manager.clone();
        let count: u32 = connection.incr(key, 1).await?;
        if count == 1 {
            let seconds = window.as_secs().max(1);
            let _: () = connection.expire(key, seconds as i64).await?;
        }
        Ok(count)
    }

    /// The count and the remaining window, or None once the key has lapsed.
    pub async fn read(&self, key: &str) -> Result<Option<(u32, Duration)>, redis::RedisError> {
        let mut connection = self.manager.clone();
        let count: Option<u32> = connection.get(key).await?;
        let Some(count) = count else {
            return Ok(None);
        };
        let ttl: i64 = connection.ttl(key).await?;
        if ttl <= 0 {
            return Ok(None);
        }
        Ok(Some((count, Duration::from_secs(ttl as u64))))
    }

    pub async fn clear(&self, keys: &[String]) -> Result<(), redis::RedisError> {
        if keys.is_empty() {
            return Ok(());
        }
        let mut connection = self.manager.clone();
        let _: () = connection.del(keys).await?;
        Ok(())
    }

    /// Whether a provider may still be selected. An unreadable store reads as
    /// healthy: it must not remove a provider from the chain.
    pub async fn provider_healthy(&self, provider: CaptchaProvider) -> bool {
        match self.read(&health_key(provider)).await {
            Ok(Some((count, _))) => count < HEALTH_FAILURES,
            _ => true,
        }
    }

    /// Count one unreachable check against a provider.
    pub async fn record_provider_failure(&self, provider: CaptchaProvider) {
        let _ = self
            .record_failure(
                &health_key(provider),
                Duration::from_secs(HEALTH_COOLDOWN_SECONDS),
            )
            .await;
    }

    /// Forget a provider's failures after a check it answered.
    pub async fn record_provider_success(&self, provider: CaptchaProvider) {
        let _ = self.clear(&[health_key(provider)]).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ignored without a Redis: the unit-level behaviour is covered by the pure
    /// verdict tests, and this is what proves the key shapes and the expiry actually
    /// behave in the service the stack runs.
    #[tokio::test]
    #[ignore = "requires a live redis; CI runs it against a redis service"]
    async fn a_failure_counter_expires_and_clears() {
        let url = std::env::var("RANKING_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let counter = Counter::connect(&url).await.expect("redis is reachable");
        let key = format!("cms:ranking:login:test-{}", std::process::id());
        counter
            .clear(std::slice::from_ref(&key))
            .await
            .expect("the key clears");
        assert_eq!(
            counter
                .record_failure(&key, Duration::from_secs(60))
                .await
                .expect("the write"),
            1
        );
        assert_eq!(
            counter
                .record_failure(&key, Duration::from_secs(60))
                .await
                .expect("the write"),
            2
        );
        let (count, remaining) = counter
            .read(&key)
            .await
            .expect("the read")
            .expect("a value");
        assert_eq!(count, 2);
        assert!(remaining.as_secs() > 0 && remaining.as_secs() <= 60);
        counter
            .clear(std::slice::from_ref(&key))
            .await
            .expect("the key clears");
        assert_eq!(counter.read(&key).await.expect("the read"), None);
    }
}
