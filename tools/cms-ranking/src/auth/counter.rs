use std::time::Duration;

use redis::AsyncCommands;

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
