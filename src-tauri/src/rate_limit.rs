//! 后端转存限流器。按平台预留请求启动时隙，所有调用入口共享同一状态。

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use tokio::sync::Mutex;

#[derive(Clone, Default)]
pub struct TransferRateLimiter {
    next_allowed: Arc<Mutex<HashMap<String, Instant>>>,
}

impl TransferRateLimiter {
    /// 为平台预留一个请求启动时隙。锁只用于计算时隙，等待期间不会阻塞其他平台。
    pub async fn wait(&self, provider: &str, interval_seconds: u64) {
        self.wait_for(provider, Duration::from_secs(interval_seconds.max(3)))
            .await;
    }

    async fn wait_for(&self, provider: &str, interval: Duration) {
        let wait = {
            let mut slots = self.next_allowed.lock().await;
            let now = Instant::now();
            let allowed = slots.get(provider).copied().unwrap_or(now);
            let start = allowed.max(now);
            slots.insert(provider.to_string(), start + interval);
            start.saturating_duration_since(now)
        };
        if !wait.is_zero() {
            tracing::info!(
                provider,
                wait_ms = wait.as_millis(),
                "转存请求等待平台限流时隙"
            );
            tokio::time::sleep(wait).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn same_provider_is_spaced_but_different_provider_is_independent() {
        let limiter = TransferRateLimiter::default();
        limiter.wait_for("quark", Duration::from_millis(40)).await;
        let before_other = Instant::now();
        limiter.wait_for("baidu", Duration::from_millis(40)).await;
        assert!(before_other.elapsed() < Duration::from_millis(100));

        let start = Instant::now();
        limiter.wait_for("quark", Duration::from_millis(40)).await;
        assert!(start.elapsed() >= Duration::from_millis(30));
    }
}
