// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Workaround for "Failed to create GBM buffer" on NVIDIA/Wayland.
    // Only applied when an NVIDIA GPU is detected, so AMD/Intel users get full GPU acceleration.
    #[cfg(target_os = "linux")]
    if is_nvidia_wayland() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    aventura_lib::run()
}

#[cfg(target_os = "linux")]
fn is_nvidia_wayland() -> bool {
    let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|s| s.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false);
    let is_nvidia = std::path::Path::new("/proc/driver/nvidia").exists()
        || std::fs::read_to_string("/proc/modules")
            .map(|m| m.lines().any(|line| line.starts_with("nvidia")))
            .unwrap_or(false);
    is_wayland && is_nvidia
}
