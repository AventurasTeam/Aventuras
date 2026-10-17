// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if is_nvidia_wayland() {
        // Explicit sync on NVIDIA's Wayland driver kills the WebView with "Error 71".
        set_default("__NV_DISABLE_EXPLICIT_SYNC", "1");
        // The AppImage's bundled WebKitGTK/libgbm cannot allocate GBM buffers on NVIDIA.
        if std::env::var_os("APPIMAGE").is_some() {
            set_default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    aventura_lib::run()
}

/// Leaves a variable the user already set alone, so either workaround can be overridden.
#[cfg(target_os = "linux")]
fn set_default(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        // SAFETY: nothing else has started a thread yet.
        unsafe { std::env::set_var(key, value) };
    }
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
