//! Car-following with the Intelligent Driver Model (IDM) on ring lanes.
//!
//! This is the per-car core of the future traffic micro-simulation (Phase 6): every car
//! looks at the car in front and accelerates or brakes. Lanes are 1 km rings with a slow
//! zone, so real stop-and-go waves form. No lane changes and no routing yet.

use crate::fnv1a;
use crate::rng::Rng;

pub const LANE_LENGTH: f32 = 1000.0;
/// Initial spacing; gives ~40 cars per lane, dense enough for jams to appear.
const SPACING: f32 = 25.0;
const CAR_LENGTH: f32 = 4.5;

// IDM parameters (typical urban values).
const MAX_ACCEL: f32 = 1.5;
const COMFORT_DECEL: f32 = 2.0;
const MIN_GAP: f32 = 2.0;
const TIME_HEADWAY: f32 = 1.2;
const SLOW_ZONE_SPEED: f32 = 6.0;

struct Lane {
    start: u32,
    count: u32,
}

pub struct Idm {
    lanes: Vec<Lane>,
    pos: Vec<f32>,
    vel: Vec<f32>,
    v0: Vec<f32>,
    acc: Vec<f32>,
}

impl Idm {
    pub fn new(n: usize, seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let per_lane = (LANE_LENGTH / SPACING) as usize;
        let mut idm = Idm {
            lanes: Vec::with_capacity(n.div_ceil(per_lane)),
            pos: Vec::with_capacity(n),
            vel: Vec::with_capacity(n),
            v0: Vec::with_capacity(n),
            acc: vec![0.0; n],
        };
        let mut placed = 0;
        while placed < n {
            let count = per_lane.min(n - placed);
            idm.lanes.push(Lane { start: placed as u32, count: count as u32 });
            for k in 0..count {
                // Ascending positions: car k+1 is the leader of car k.
                idm.pos.push(k as f32 * SPACING + rng.range(0.0, 2.0));
                idm.vel.push(rng.range(0.0, 10.0));
                idm.v0.push(rng.range(11.0, 17.0));
            }
            placed += count;
        }
        idm
    }

    pub fn len(&self) -> usize {
        self.pos.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pos.is_empty()
    }

    pub fn tick(&mut self, dt: f32) {
        let two_sqrt_ab = 2.0 * (MAX_ACCEL * COMFORT_DECEL).sqrt();
        let slow_from = LANE_LENGTH * 0.4;
        let slow_to = LANE_LENGTH * 0.5;

        // Pass 1: accelerations from the old state.
        for lane in &self.lanes {
            let s = lane.start as usize;
            let c = lane.count as usize;
            let pos = &self.pos[s..s + c];
            let vel = &self.vel[s..s + c];
            let v0 = &self.v0[s..s + c];
            let acc = &mut self.acc[s..s + c];
            for k in 0..c {
                let lead = if k + 1 == c { 0 } else { k + 1 };
                let mut d = pos[lead] - pos[k];
                if d <= 0.0 {
                    d += LANE_LENGTH;
                }
                let gap = (d - CAR_LENGTH).max(0.1);
                let v = vel[k];
                let dv = v - vel[lead];
                let desired =
                    if pos[k] >= slow_from && pos[k] < slow_to { v0[k].min(SLOW_ZONE_SPEED) } else { v0[k] };
                let s_star = MIN_GAP + (v * TIME_HEADWAY + v * dv / two_sqrt_ab).max(0.0);
                let r = v / desired;
                let r2 = r * r;
                let q = s_star / gap;
                acc[k] = MAX_ACCEL * (1.0 - r2 * r2 - q * q);
            }
        }

        // Pass 2: ballistic integration; cars never roll backwards.
        for i in 0..self.pos.len() {
            let v = self.vel[i];
            let a = self.acc[i];
            let v_new = (v + a * dt).max(0.0);
            let mut p = self.pos[i] + 0.5 * (v + v_new) * dt;
            if p >= LANE_LENGTH {
                p -= LANE_LENGTH;
            }
            self.pos[i] = p;
            self.vel[i] = v_new;
        }
    }

    pub fn mean_speed(&self) -> f32 {
        if self.vel.is_empty() {
            return 0.0;
        }
        self.vel.iter().sum::<f32>() / self.vel.len() as f32
    }

    pub fn checksum(&self) -> u32 {
        let mut h = fnv1a::OFFSET;
        for i in 0..self.len() {
            h = fnv1a::step_u32(h, self.pos[i].to_bits());
            h = fnv1a::step_u32(h, self.vel[i].to_bits());
        }
        h
    }

    pub fn bytes(&self) -> usize {
        self.len() * 4 * std::mem::size_of::<f32>() + self.lanes.len() * std::mem::size_of::<Lane>()
    }

    #[cfg(test)]
    fn min_gap(&self) -> f32 {
        let mut min = f32::MAX;
        for lane in &self.lanes {
            let s = lane.start as usize;
            let c = lane.count as usize;
            for k in 0..c {
                let lead = s + if k + 1 == c { 0 } else { k + 1 };
                let mut d = self.pos[lead] - self.pos[s + k];
                if d <= 0.0 {
                    d += LANE_LENGTH;
                }
                min = min.min(d - CAR_LENGTH);
            }
        }
        min
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic() {
        let mut a = Idm::new(4_000, 9);
        let mut b = Idm::new(4_000, 9);
        for _ in 0..1_000 {
            a.tick(0.2);
            b.tick(0.2);
        }
        assert_eq!(a.checksum(), b.checksum());
    }

    #[test]
    fn no_collisions_and_sane_speeds() {
        let mut m = Idm::new(4_000, 5);
        for _ in 0..5_000 {
            m.tick(0.2);
            assert!(m.min_gap() > 0.0, "cars overlapped");
        }
        assert!(m.vel.iter().all(|&v| (0.0..=17.0).contains(&v)));
    }

    #[test]
    fn slow_zone_creates_a_jam() {
        let mut m = Idm::new(4_000, 5);
        for _ in 0..3_000 {
            m.tick(0.2);
        }
        // Free flow would be ~14 m/s; the bottleneck must drag the mean well below that.
        let mean = m.mean_speed();
        assert!(mean > 1.0 && mean < 10.0, "mean speed {mean}");
    }
}
