use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cms_svc::Stop;

use super::{retry_score, wait_until, MAX_RETRIES};

#[tokio::test]
async fn a_transient_score_failure_is_retried_until_it_succeeds() {
    let stop = Stop::new();
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attempts);

    let value = retry_score("score", &stop, move || {
        let counter = Arc::clone(&counter);
        async move {
            let attempt = counter.fetch_add(1, Ordering::SeqCst) + 1;
            if attempt < 3 {
                Err("temporary refusal")
            } else {
                Ok(42)
            }
        }
    })
    .await
    .expect("the third attempt succeeds");

    assert_eq!(value, 42);
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_persistent_score_failure_is_dropped_after_three_retries() {
    let stop = Stop::new();
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attempts);

    let refusal = retry_score("score", &stop, move || {
        let counter = Arc::clone(&counter);
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>("persistent refusal")
        }
    })
    .await
    .expect_err("the candidate is dropped for the next sweep");

    assert_eq!(refusal, "persistent refusal");
    assert_eq!(attempts.load(Ordering::SeqCst), MAX_RETRIES as usize + 1);
}

#[tokio::test]
async fn a_stop_raised_during_a_failure_prevents_another_retry() {
    let stop = Stop::new();
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attempts);

    let refusal = retry_score("score", &stop.clone(), move || {
        let counter = Arc::clone(&counter);
        let stop = stop.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            stop.request();
            Err::<(), _>("stop before retry")
        }
    })
    .await
    .expect_err("the stopped worker returns the last refusal");

    assert_eq!(refusal, "stop before retry");
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_requested_stop_ends_a_347_second_wait_at_once() {
    let stop = Stop::new();
    stop.request();

    tokio::time::timeout(
        Duration::from_secs(1),
        wait_until(
            tokio::time::Instant::now() + Duration::from_secs(347),
            &stop,
        ),
    )
    .await
    .expect("a stopped loop does not sleep out the sweep interval");
}
