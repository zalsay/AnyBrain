use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

fn state_file_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().unwrap();
    dir.join("window_state.json")
}

fn load_window_state(app: &tauri::AppHandle) -> Option<WindowState> {
    let path = state_file_path(app);
    let data = fs::read_to_string(&path).ok()?;
    let state: WindowState = serde_json::from_str(&data).ok()?;
    eprintln!("[state] loaded: {:?}", state);
    Some(state)
}

fn save_window_state(app: &tauri::AppHandle, state: &WindowState) {
    let path = state_file_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(&path, json);
        eprintln!("[state] saved: {:?}", state);
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn platforms_file_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().unwrap();
    dir.join("platforms.json")
}

#[tauri::command]
fn load_platforms(app: tauri::AppHandle) -> Result<String, String> {
    let path = platforms_file_path(&app);
    match fs::read_to_string(&path) {
        Ok(data) => Ok(data),
        Err(_) => Ok("[]".to_string()),
    }
}

#[tauri::command]
fn save_platforms(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = platforms_file_path(&app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

mod ai_window_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_platforms,
            save_platforms,
            ai_window_manager::create_or_show_webview,
            ai_window_manager::destroy_webview,
            ai_window_manager::hide_all_webviews,
            ai_window_manager::reload_webview
        ])
        .setup(|app| {
            use tauri::Manager;
            use tauri::WindowEvent;
            use std::sync::Mutex;
            use std::time::Instant;

            let main_window = app.get_webview_window("main").unwrap();

            // Restore saved window state
            if let Some(state) = load_window_state(&app.handle()) {
                use tauri::PhysicalPosition;
                use tauri::PhysicalSize;
                let _ = main_window.set_size(PhysicalSize::new(state.width, state.height));
                let _ = main_window.set_position(PhysicalPosition::new(state.x, state.y));
                eprintln!("[setup] Restored window: {}x{} at ({},{})", state.width, state.height, state.x, state.y);
            }

            let window_clone = main_window.clone();

            // Throttle state: last resize timestamp
            let last_resize = Mutex::new(Instant::now());

            eprintln!("[setup] Window resize listener registered");

            main_window.on_window_event(move |event| {
                match event {
                    WindowEvent::Resized(physical_size) => {
                        // Throttle: skip if less than 16ms (~60fps) since last update
                        {
                            let mut last = last_resize.lock().unwrap();
                            let now = Instant::now();
                            if now.duration_since(*last).as_millis() < 16 {
                                return;
                            }
                            *last = now;
                        }

                        let scale_factor = window_clone.scale_factor().unwrap_or(2.0);

                        let tab_logical_height = ai_window_manager::TAB_BAR_LOGICAL_HEIGHT;
                        let tab_physical_height = (tab_logical_height * scale_factor) as u32;

                        let child_y = tab_physical_height as i32;
                        let child_width = physical_size.width;
                        let child_height = physical_size.height.saturating_sub(tab_physical_height);

                        eprintln!(
                            "[resize] window={}x{} scale={} tab_phys={} child: y={} w={} h={}",
                            physical_size.width, physical_size.height,
                            scale_factor, tab_physical_height,
                            child_y, child_width, child_height
                        );

                        let webviews = window_clone.app_handle().webviews();
                        for webview in webviews.values() {
                            if webview.label() != "main" {
                                use tauri::PhysicalPosition;
                                use tauri::PhysicalSize;
                                let _ = webview.set_position(PhysicalPosition::new(0, child_y));
                                let _ = webview.set_size(PhysicalSize::new(child_width, child_height));
                            }
                        }
                    }
                    WindowEvent::CloseRequested { .. } => {
                        // Save window state on close
                        if let (Ok(size), Ok(pos)) = (
                            window_clone.inner_size(),
                            window_clone.outer_position(),
                        ) {
                            let state = WindowState {
                                width: size.width,
                                height: size.height,
                                x: pos.x,
                                y: pos.y,
                            };
                            save_window_state(&window_clone.app_handle(), &state);
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
