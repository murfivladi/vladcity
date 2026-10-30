//! Native baseline for the Phase 1 agent benchmark.
//!
//! Runs exactly the same protocol as the browser benchmark (client/src/bench/protocol.ts)
//! and prints a Markdown table. Usage: `cargo run --release --bin native_bench`.
//! With `--checksums` it only prints the state checksums (see scripts/check-determinism.sh).

use spike_agents::{Agents, Idm};
use std::time::Instant;

// Keep in sync with client/src/bench/protocol.ts.
const SEED: u32 = 2026;
const AGENT_DT: f32 = 1.0;
const AGENT_WARMUP_DT: f32 = 10.0;
const AGENT_WARMUP_TICKS: u32 = 90;
const IDM_DT: f32 = 0.25;
const IDM_WARMUP_TICKS: u32 = 20;
/// Ticks run after warm-up and before the checksum; also calibrate the browser timer.
const CHECKSUM_TICKS: u32 = 30;
const MIN_TICKS: usize = 30;
const MAX_TICKS: usize = 3000;
const MIN_SECONDS: f64 = 1.0;

struct Stats {
    avg: f64,
    p50: f64,
    p95: f64,
    checksum: u32,
}

fn measure<W>(w: &mut W, tick: impl Fn(&mut W), checksum: impl Fn(&W) -> u32) -> Stats {
    for _ in 0..CHECKSUM_TICKS {
        tick(w);
    }
    let checksum = checksum(w);
    let mut times = Vec::new();
    let mut sum = 0.0;
    while (sum < MIN_SECONDS * 1000.0 || times.len() < MIN_TICKS) && times.len() < MAX_TICKS {
        let t = Instant::now();
        tick(w);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        times.push(ms);
        sum += ms;
    }
    let avg = sum / times.len() as f64;
    times.sort_by(f64::total_cmp);
    let pct = |p: f64| times[((times.len() - 1) as f64 * p).round() as usize];
    Stats { avg, p50: pct(0.5), p95: pct(0.95), checksum }
}

fn row(model: &str, n: usize, bytes: usize, s: &Stats) {
    println!(
        "| {model} | {n} | {:.2} | {:.2} | {:.2} | {:.1} | {} | {:08x} |",
        s.avg,
        s.p50,
        s.p95,
        s.avg * 1e6 / n as f64,
        bytes / n,
        s.checksum
    );
}

const AGENT_SIZES: [usize; 3] = [100_000, 500_000, 1_000_000];
const IDM_SIZES: [usize; 4] = [10_000, 50_000, 100_000, 250_000];

fn print_checksums() {
    for n in AGENT_SIZES {
        let mut w = Agents::new(n, SEED);
        for _ in 0..AGENT_WARMUP_TICKS {
            w.tick(AGENT_WARMUP_DT);
        }
        for _ in 0..CHECKSUM_TICKS {
            w.tick(AGENT_DT);
        }
        println!("agents {n} {:08x}", w.checksum());
    }
    for n in IDM_SIZES {
        let mut w = Idm::new(n, SEED);
        for _ in 0..IDM_WARMUP_TICKS + CHECKSUM_TICKS {
            w.tick(IDM_DT);
        }
        println!("idm {n} {:08x}", w.checksum());
    }
}

fn main() {
    if std::env::args().any(|a| a == "--checksums") {
        print_checksums();
        return;
    }
    println!("| Модель | Агентов | мс/тик (ср.) | p50 | p95 | нс/агент | байт/агент | checksum |");
    println!("|---|---|---|---|---|---|---|---|");

    for n in AGENT_SIZES {
        let mut w = Agents::new(n, SEED);
        for _ in 0..AGENT_WARMUP_TICKS {
            w.tick(AGENT_WARMUP_DT);
        }
        let s = measure(&mut w, |w| w.tick(AGENT_DT), Agents::checksum);
        row("agents", n, w.bytes(), &s);
    }

    for n in IDM_SIZES {
        let mut w = Idm::new(n, SEED);
        for _ in 0..IDM_WARMUP_TICKS {
            w.tick(IDM_DT);
        }
        let s = measure(&mut w, |w| w.tick(IDM_DT), Idm::checksum);
        row("idm", n, w.bytes(), &s);
    }
}
