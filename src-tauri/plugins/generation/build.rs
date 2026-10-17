const COMMANDS: &[&str] = &["start", "stop", "update"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
