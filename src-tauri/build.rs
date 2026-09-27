fn main() {
    // The installers bundle the browser extension from dist-extension/ (made by
    // `pnpm build:extension`, which runs before `tauri build`). Plain `cargo` builds
    // only need the folder to exist.
    let _ = std::fs::create_dir_all("../dist-extension");
    tauri_build::build()
}
