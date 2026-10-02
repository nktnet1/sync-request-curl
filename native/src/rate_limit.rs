use std::time::{Duration, Instant};

/// A bounded inactivity allowance, earned only by actual transfer progress.
/// This does not implement rate limiting; libcurl still controls transfer speed.
/// It prevents libcurl's deliberate pauses from looking like a dead socket.
pub(crate) struct RateLimitAllowance {
  bytes_per_second: u64,
  transferred: u64,
  updated_at: Instant,
  allowance: Duration,
}

impl RateLimitAllowance {
  pub(crate) fn new(bytes_per_second: i64, now: Instant) -> Self {
    Self {
      bytes_per_second: u64::try_from(bytes_per_second).unwrap_or_default(),
      transferred: 0,
      updated_at: now,
      allowance: Duration::ZERO,
    }
  }

  pub(crate) fn update(
    &mut self,
    transferred: i64,
    now: Instant,
  ) -> bool {
    let transferred = u64::try_from(transferred).unwrap_or_default();
    if transferred < self.transferred {
      // libcurl can reset counters when restarting for authentication.
      self.transferred = 0;
      self.allowance = Duration::ZERO;
    }
    let delta = transferred - self.transferred;
    self.transferred = transferred;
    if self.bytes_per_second == 0 {
      self.allowance = Duration::ZERO;
    } else if delta > 0 {
      // Include the final burst: libcurl can pause for its rate limit after
      // reporting all upload bytes, before reading the response. Repeated
      // callbacks with the same counter neither renew nor discard this debt.
      let nanos = (u128::from(delta) * 1_000_000_000)
        .div_ceil(u128::from(self.bytes_per_second));
      let earned = Duration::new(
        (nanos / 1_000_000_000) as u64,
        (nanos % 1_000_000_000) as u32,
      );
      self.allowance = self
        .allowance
        .saturating_sub(now.saturating_duration_since(self.updated_at))
        .saturating_add(earned);
      self.updated_at = now;
    }
    delta > 0
  }

  pub(crate) fn idle_elapsed(&self, now: Instant) -> Option<Duration> {
    if self.allowance.is_zero() {
      None
    } else {
      Some(
        now.saturating_duration_since(self.updated_at)
          .saturating_sub(self.allowance),
      )
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_new_bytes_extend_the_allowance() {
    let start = Instant::now();
    let mut limit = RateLimitAllowance::new(1_000, start);
    assert!(limit.update(500, start));
    assert_eq!(limit.idle_elapsed(start + Duration::from_millis(499)), Some(Duration::ZERO));
    assert!(!limit.update(500, start + Duration::from_millis(600)));
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_millis(700)),
      Some(Duration::from_millis(200)),
    );
  }

  #[test]
  fn bursts_accumulate_but_elapsed_time_is_not_earned_twice() {
    let start = Instant::now();
    let mut limit = RateLimitAllowance::new(1_000, start);
    limit.update(500, start);
    limit.update(750, start + Duration::from_millis(100));
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_millis(800)),
      Some(Duration::from_millis(50)),
    );
    limit.update(1_000, start + Duration::from_secs(1));
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_millis(1_300)),
      Some(Duration::from_millis(50)),
    );
  }

  #[test]
  fn final_burst_allowance_expires_without_further_progress() {
    let start = Instant::now();
    let mut limit = RateLimitAllowance::new(65_536, start);
    limit.update(65_536, start);
    limit.update(131_072, start + Duration::from_secs(1));
    for millis in [1_100, 1_500, 2_000, 2_200] {
      assert!(!limit.update(131_072, start + Duration::from_millis(millis)));
    }
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_millis(1_999)),
      Some(Duration::ZERO),
    );
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_millis(2_200)),
      Some(Duration::from_millis(200)),
    );
  }

  #[test]
  fn authentication_counter_resets_clear_allowance() {
    let start = Instant::now();
    let mut limit = RateLimitAllowance::new(1, start);
    limit.update(200, start);
    limit.update(0, start);
    assert_eq!(limit.idle_elapsed(start), None);
    limit.update(1, start);
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_secs(2)),
      Some(Duration::from_secs(1)),
    );
  }

  #[test]
  fn unlimited_and_negative_native_limits_never_grant_allowance() {
    let start = Instant::now();
    for rate in [0, -1] {
      let mut limit = RateLimitAllowance::new(rate, start);
      limit.update(10_000, start);
      assert_eq!(limit.idle_elapsed(start), None);
    }
  }

  #[test]
  fn fractional_nanoseconds_round_up_and_large_counters_do_not_overflow() {
    let start = Instant::now();
    let mut limit = RateLimitAllowance::new(i64::MAX, start);
    limit.update(1, start);
    assert_eq!(limit.idle_elapsed(start), Some(Duration::ZERO));
    assert_eq!(
      limit.idle_elapsed(start + Duration::from_nanos(2)),
      Some(Duration::from_nanos(1)),
    );
    let mut limit = RateLimitAllowance::new(1, start);
    limit.update(i64::MAX, start);
    assert_eq!(limit.idle_elapsed(start + Duration::from_secs(1)), Some(Duration::ZERO));
  }
}
