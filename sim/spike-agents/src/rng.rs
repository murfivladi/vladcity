/// Xorshift32: tiny, fast and fully deterministic on every platform.
/// Good enough for a benchmark; the real simulation will get a better generator in Phase 2.
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng((seed ^ 0x9E37_79B9).max(1))
    }

    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// Uniform in [0, 1).
    pub fn unit(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.unit()
    }

    /// Uniform in [0, n).
    pub fn below(&mut self, n: u32) -> u32 {
        ((self.next_u32() as u64 * n as u64) >> 32) as u32
    }
}
