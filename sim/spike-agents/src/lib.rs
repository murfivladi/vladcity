//! Phase 1 spike: how many agents can we afford per simulation tick?
//!
//! Two kernels are measured natively (`native_bench`) and in the browser (WASM in a Web
//! Worker): simple commuting residents and IDM car-following. The C ABI below is the whole
//! WASM interface; the JS side calls it directly, without wasm-bindgen.

pub mod agents;
pub mod idm;
pub mod rng;

pub use agents::Agents;
pub use idm::Idm;

pub(crate) mod fnv1a {
    pub const OFFSET: u32 = 0x811C_9DC5;
    const PRIME: u32 = 0x0100_0193;

    pub fn step_u32(mut h: u32, v: u32) -> u32 {
        for b in v.to_le_bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(PRIME);
        }
        h
    }
}

// ---- C ABI for WASM ------------------------------------------------------------------------
//
// Pointers returned by `*_new` are owned by JS and must be released with `*_free`.

#[unsafe(no_mangle)]
pub extern "C" fn agents_new(n: u32, seed: u32) -> *mut Agents {
    Box::into_raw(Box::new(Agents::new(n as usize, seed)))
}

/// # Safety
/// `p` must come from `agents_new` and not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn agents_free(p: *mut Agents) {
    drop(unsafe { Box::from_raw(p) });
}

/// # Safety
/// `p` must be a live pointer from `agents_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn agents_tick(p: *mut Agents, dt: f32) {
    unsafe { &mut *p }.tick(dt);
}

/// Fills the render buffer for the first `count` agents and returns a pointer to it
/// (`count * 4` floats). Valid until the next call on this world.
///
/// # Safety
/// `p` must be a live pointer from `agents_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn agents_fill_render(p: *mut Agents, count: u32) -> *const f32 {
    unsafe { &mut *p }.fill_render(count as usize).as_ptr()
}

/// # Safety
/// `p` must be a live pointer from `agents_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn agents_moving(p: *const Agents) -> u32 {
    unsafe { &*p }.moving() as u32
}

/// # Safety
/// `p` must be a live pointer from `agents_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn agents_checksum(p: *const Agents) -> u32 {
    unsafe { &*p }.checksum()
}

/// # Safety
/// `p` must be a live pointer from `agents_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn agents_bytes(p: *const Agents) -> u32 {
    unsafe { &*p }.bytes() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn idm_new(n: u32, seed: u32) -> *mut Idm {
    Box::into_raw(Box::new(Idm::new(n as usize, seed)))
}

/// # Safety
/// `p` must come from `idm_new` and not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn idm_free(p: *mut Idm) {
    drop(unsafe { Box::from_raw(p) });
}

/// # Safety
/// `p` must be a live pointer from `idm_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn idm_tick(p: *mut Idm, dt: f32) {
    unsafe { &mut *p }.tick(dt);
}

/// # Safety
/// `p` must be a live pointer from `idm_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn idm_mean_speed(p: *const Idm) -> f32 {
    unsafe { &*p }.mean_speed()
}

/// # Safety
/// `p` must be a live pointer from `idm_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn idm_checksum(p: *const Idm) -> u32 {
    unsafe { &*p }.checksum()
}

/// # Safety
/// `p` must be a live pointer from `idm_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn idm_bytes(p: *const Idm) -> u32 {
    unsafe { &*p }.bytes() as u32
}
