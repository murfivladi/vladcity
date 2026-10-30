//! "Simple" citizen agents: the cheapest level of detail a resident can have.
//!
//! Every agent commutes home <-> work along a Manhattan grid of roads (first along x, then
//! along y), waits a random time at the destination and goes back. No interaction between
//! agents. This is roughly the cost of a far-from-camera resident in the final game, and the
//! lower bound for how many residents can exist at all.

use crate::fnv1a;
use crate::rng::Rng;

/// Side of the square city, metres.
pub const CITY_SIZE: f32 = 8000.0;
/// Distance between parallel roads, metres.
pub const BLOCK: f32 = 50.0;
/// Road lines per axis.
pub const GRID: u32 = (CITY_SIZE / BLOCK) as u32 + 1;
/// Half of a lane width: cars are drawn on the right-hand side of the road centre line.
pub const LANE_OFFSET: f32 = 1.75;

const MIN_WAIT: f32 = 60.0;
const MAX_WAIT: f32 = 600.0;
const MIN_SPEED: f32 = 8.0;
const MAX_SPEED: f32 = 16.0;

const MOVING: u8 = 1;
const TO_WORK: u8 = 2;

const DIR_E: u8 = 0;
const DIR_W: u8 = 1;
const DIR_N: u8 = 2;
const DIR_S: u8 = 3;

/// Floats per agent in the render buffer: x, y, dir_x, dir_y.
/// A parked agent has dir = (0, 0), so the renderer can hide it.
pub const RENDER_STRIDE: usize = 4;

pub struct Agents {
    x: Vec<f32>,
    y: Vec<f32>,
    tx: Vec<f32>,
    ty: Vec<f32>,
    home: Vec<u32>,
    work: Vec<u32>,
    speed: Vec<f32>,
    timer: Vec<f32>,
    flags: Vec<u8>,
    dir: Vec<u8>,
    rng: Rng,
    render: Vec<f32>,
}

fn node_pos(node: u32) -> (f32, f32) {
    ((node % GRID) as f32 * BLOCK, (node / GRID) as f32 * BLOCK)
}

impl Agents {
    pub fn new(n: usize, seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let mut a = Agents {
            x: Vec::with_capacity(n),
            y: Vec::with_capacity(n),
            tx: Vec::with_capacity(n),
            ty: Vec::with_capacity(n),
            home: Vec::with_capacity(n),
            work: Vec::with_capacity(n),
            speed: Vec::with_capacity(n),
            timer: Vec::with_capacity(n),
            flags: Vec::with_capacity(n),
            dir: Vec::with_capacity(n),
            rng: Rng::new(0),
            render: Vec::new(),
        };
        for _ in 0..n {
            let home = rng.below(GRID * GRID);
            let work = rng.below(GRID * GRID);
            let (hx, hy) = node_pos(home);
            a.x.push(hx);
            a.y.push(hy);
            a.tx.push(hx);
            a.ty.push(hy);
            a.home.push(home);
            a.work.push(work);
            a.speed.push(rng.range(MIN_SPEED, MAX_SPEED));
            // Everyone starts at home; random timers spread the departures out.
            a.timer.push(rng.range(0.0, MAX_WAIT));
            a.flags.push(0);
            a.dir.push(DIR_E);
        }
        a.rng = rng;
        a
    }

    pub fn len(&self) -> usize {
        self.x.len()
    }

    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    pub fn tick(&mut self, dt: f32) {
        let n = self.x.len();
        let Agents { x, y, tx, ty, home, work, speed, timer, flags, dir, rng, .. } = self;
        // Re-slicing to the same length lets the compiler drop bounds checks in the loop.
        let (x, y, tx, ty) = (&mut x[..n], &mut y[..n], &mut tx[..n], &mut ty[..n]);
        let (home, work, speed, timer) = (&home[..n], &work[..n], &speed[..n], &mut timer[..n]);
        let (flags, dir) = (&mut flags[..n], &mut dir[..n]);

        for i in 0..n {
            if flags[i] & MOVING != 0 {
                let step = speed[i] * dt;
                let dx = tx[i] - x[i];
                if dx.abs() > step {
                    x[i] += step.copysign(dx);
                    dir[i] = if dx > 0.0 { DIR_E } else { DIR_W };
                } else {
                    // Finish the x-leg and spend what is left of the step on the y-leg.
                    x[i] = tx[i];
                    let rest = step - dx.abs();
                    let dy = ty[i] - y[i];
                    if dy.abs() > rest {
                        y[i] += rest.copysign(dy);
                        dir[i] = if dy > 0.0 { DIR_N } else { DIR_S };
                    } else {
                        y[i] = ty[i];
                        flags[i] &= !MOVING;
                        timer[i] = rng.range(MIN_WAIT, MAX_WAIT);
                    }
                }
            } else {
                timer[i] -= dt;
                if timer[i] <= 0.0 {
                    flags[i] ^= TO_WORK;
                    let dest = if flags[i] & TO_WORK != 0 { work[i] } else { home[i] };
                    (tx[i], ty[i]) = node_pos(dest);
                    flags[i] |= MOVING;
                }
            }
        }
    }

    /// Writes `x, y, dir_x, dir_y` of the first `count` agents into the render buffer
    /// and returns it. Positions are shifted to the right-hand lane.
    pub fn fill_render(&mut self, count: usize) -> &[f32] {
        let count = count.min(self.len());
        self.render.resize(count * RENDER_STRIDE, 0.0);
        for i in 0..count {
            let (dx, dy) = if self.flags[i] & MOVING == 0 {
                (0.0, 0.0)
            } else {
                match self.dir[i] {
                    DIR_E => (1.0, 0.0),
                    DIR_W => (-1.0, 0.0),
                    DIR_N => (0.0, 1.0),
                    _ => (0.0, -1.0),
                }
            };
            let out = &mut self.render[i * RENDER_STRIDE..(i + 1) * RENDER_STRIDE];
            out[0] = self.x[i] + dy * LANE_OFFSET;
            out[1] = self.y[i] - dx * LANE_OFFSET;
            out[2] = dx;
            out[3] = dy;
        }
        &self.render
    }

    pub fn moving(&self) -> usize {
        self.flags.iter().filter(|&&f| f & MOVING != 0).count()
    }

    /// Hash of the full state; equal on every device if the simulation is deterministic.
    pub fn checksum(&self) -> u32 {
        let mut h = fnv1a::OFFSET;
        for i in 0..self.len() {
            h = fnv1a::step_u32(h, self.x[i].to_bits());
            h = fnv1a::step_u32(h, self.y[i].to_bits());
            h = fnv1a::step_u32(h, self.timer[i].to_bits());
            h = fnv1a::step_u32(h, self.flags[i] as u32);
        }
        h
    }

    /// Heap bytes owned by the world (render buffer excluded).
    pub fn bytes(&self) -> usize {
        let f = std::mem::size_of::<f32>();
        self.len() * (6 * f + 2 * std::mem::size_of::<u32>() + 2)
    }

    #[cfg(test)]
    pub(crate) fn position(&self, i: usize) -> (f32, f32, bool) {
        (self.x[i], self.y[i], self.flags[i] & MOVING != 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on_road(v: f32) -> bool {
        (v / BLOCK).fract() == 0.0
    }

    #[test]
    fn deterministic() {
        let mut a = Agents::new(5_000, 42);
        let mut b = Agents::new(5_000, 42);
        for _ in 0..500 {
            a.tick(1.0);
            b.tick(1.0);
        }
        assert_eq!(a.checksum(), b.checksum());
        let mut c = Agents::new(5_000, 43);
        for _ in 0..500 {
            c.tick(1.0);
        }
        assert_ne!(a.checksum(), c.checksum());
    }

    #[test]
    fn agents_stay_on_roads_inside_the_city() {
        let mut a = Agents::new(2_000, 7);
        for _ in 0..2_000 {
            a.tick(1.0);
            for i in 0..a.len() {
                let (x, y, _) = a.position(i);
                assert!((0.0..=CITY_SIZE).contains(&x) && (0.0..=CITY_SIZE).contains(&y));
                assert!(on_road(x) || on_road(y), "agent {i} off-road at ({x}, {y})");
            }
        }
    }

    #[test]
    fn agents_actually_commute() {
        let mut a = Agents::new(2_000, 1);
        let mut max_moving = 0;
        for _ in 0..1_000 {
            a.tick(1.0);
            max_moving = max_moving.max(a.moving());
        }
        assert!(max_moving > a.len() / 4, "only {max_moving} agents ever moved at once");
    }

    #[test]
    fn render_buffer_hides_parked_agents() {
        let mut a = Agents::new(100, 3);
        let buf = a.fill_render(100).to_vec();
        assert_eq!(buf.len(), 100 * RENDER_STRIDE);
        // At t=0 everyone is parked at home.
        assert!(buf.chunks(RENDER_STRIDE).all(|c| c[2] == 0.0 && c[3] == 0.0));
    }
}
