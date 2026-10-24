// ZION launcher: one window that opens the online game. The game itself is always loaded from the
// server, so it is always the latest build; only this small window ever needs replacing (the game
// page tells the player when a newer launcher is out, see apps/web/src/lib/launcher.ts).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The game's address: `zion.json` next to the program ({"url": "https://…"}) wins, else the one
/// built in (ZION_URL when it was built).
fn game_url() -> String {
    let built = option_env!("ZION_URL").unwrap_or("http://localhost:3000").to_string();
    let beside = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("zion.json"))).unwrap_or_else(|| PathBuf::from("zion.json"));
    std::fs::read_to_string(beside)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(str::to_string))
        .unwrap_or(built)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = game_url().parse().expect("invalid game url");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("ZION")
                .inner_size(1600.0, 900.0)
                .min_inner_size(960.0, 540.0)
                .maximized(true)
                // The page knows it runs in the launcher (and which version) from this.
                .user_agent(&format!("{} ZIONLauncher/{}", default_user_agent(), env!("CARGO_PKG_VERSION")))
                // Run on the strong (discrete) graphics card even where the browser blocklists it.
                .additional_browser_args("--force_high_performance_gpu --ignore-gpu-blocklist --autoplay-policy=no-user-gesture-required")
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ZION");
}

/// A current Edge user agent, so sites treat the window as a normal browser.
fn default_user_agent() -> &'static str {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
}
