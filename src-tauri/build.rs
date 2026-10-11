use std::path::Path;

fn main() {
    embed_conpty();
    tauri_build::build()
}

/// Embeds the newer ConPTY from vendor/conpty (see scripts/fetch-conpty.ps1) when
/// it has been fetched; otherwise the app uses the ConPTY built into Windows.
fn embed_conpty() {
    println!("cargo::rustc-check-cfg=cfg(bundled_conpty)");
    println!("cargo::rerun-if-changed=vendor/conpty");

    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x64",
        Ok("aarch64") => "arm64",
        _ => return,
    };
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/conpty").join(arch);
    let version = std::fs::read_to_string(dir.join("VERSION")).ok();
    let complete = ["conpty.dll", "OpenConsole.exe"].iter().all(|f| dir.join(f).is_file());

    match version {
        Some(version) if complete => {
            println!("cargo::rustc-cfg=bundled_conpty");
            println!("cargo::rustc-env=QTERM_CONPTY_DIR={}", dir.display());
            println!("cargo::rustc-env=QTERM_CONPTY_VERSION={}", version.trim());
        }
        _ => println!(
            "cargo::warning=ConPTY not bundled (run scripts/fetch-conpty.ps1); using the one built into Windows"
        ),
    }
}
