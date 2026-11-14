fn main() {
    // tauri.conf.json takes its version from package.json, and tauri-build writes that version
    // into the exe's file details. tauri-build only asks Cargo to watch tauri.conf.json, so
    // without this line a version bump alone would leave the previous version in the details.
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
