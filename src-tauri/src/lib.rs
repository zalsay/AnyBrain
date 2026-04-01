use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri_plugin_shell::ShellExt;

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

fn settings_file_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().unwrap();
    dir.join("settings.json")
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_file_path(&app);
    match fs::read_to_string(&path) {
        Ok(data) => Ok(data),
        Err(_) => Ok("{}".to_string()),
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = settings_file_path(&app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutCommandResult {
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i32>,
    error: Option<String>,
}

type ShortcutCommandResultPayload = Result<ShortcutCommandResult, String>;

#[tauri::command]
async fn run_shortcut_command(app: tauri::AppHandle, command: String, exec_mode: String) -> ShortcutCommandResultPayload {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("命令为空".to_string());
    }

    if trimmed.len() > 4096 {
        return Err("命令过长".to_string());
    }

    let shell = app.shell();

    match exec_mode.as_str() {
        "external_terminal" => {
            #[cfg(target_os = "macos")]
            {
                let escaped = trimmed.replace('\\', "\\\\").replace('"', "\\\"");
                let apple_script = format!("tell application \"Terminal\" to do script \"{}\"", escaped);
                shell.command("osascript")
                    .args(["-e", &apple_script])
                    .status()
                    .await
                    .map_err(|e| e.to_string())?;
            }
            #[cfg(target_os = "windows")]
            {
                shell.command("cmd")
                    .args(["/C", "start", "cmd", "/K", trimmed])
                    .status()
                    .await
                    .map_err(|e| e.to_string())?;
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                shell.command("x-terminal-emulator")
                    .args(["-e", "sh", "-c", trimmed])
                    .status()
                    .await
                    .map_err(|e| e.to_string())?;
            }

            Ok(ShortcutCommandResult {
                stdout: None,
                stderr: None,
                exit_code: None,
                error: None,
            })
        }
        "shell_status_only" => {
            #[cfg(target_os = "windows")]
            let command_builder = shell.command("cmd").args(["/C", trimmed]);
            #[cfg(not(target_os = "windows"))]
            let command_builder = shell.command("sh").args(["-c", trimmed]);

            let status = command_builder
                .status()
                .await
                .map_err(|e| e.to_string())?;

            Ok(ShortcutCommandResult {
                stdout: None,
                stderr: None,
                exit_code: status.code(),
                error: None,
            })
        }
        _ => {
            #[cfg(target_os = "windows")]
            let command_builder = shell.command("cmd").args(["/C", trimmed]);
            #[cfg(not(target_os = "windows"))]
            let command_builder = shell.command("sh").args(["-c", trimmed]);

            let output = command_builder
                .output()
                .await
                .map_err(|e| e.to_string())?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            Ok(ShortcutCommandResult {
                stdout: Some(stdout),
                stderr: Some(stderr),
                exit_code: output.status.code(),
                error: None,
            })
        }
    }
}

mod ai_window_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_platforms,
            save_platforms,
            load_settings,
            save_settings,
            run_shortcut_command,
            ai_window_manager::create_or_show_webview,
            ai_window_manager::destroy_webview,
            ai_window_manager::hide_all_webviews,
            ai_window_manager::navigate_webview_home,
            ai_window_manager::navigate_webview_back,
            ai_window_manager::navigate_webview_forward,
            ai_window_manager::reload_webview,
            ai_window_manager::reload_webview_url,
            ai_window_manager::set_tts_rate
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

                        let top_chrome_physical_height =
                            (ai_window_manager::TOP_CHROME_LOGICAL_HEIGHT * scale_factor).ceil() as u32;
                        let child_extra_top_inset =
                            (ai_window_manager::CHILD_WEBVIEW_EXTRA_TOP_INSET_LOGICAL_HEIGHT * scale_factor).ceil() as u32;
                        let child_top_inset = top_chrome_physical_height.saturating_add(child_extra_top_inset);

                        let child_width = physical_size.width;
                        let child_height = physical_size.height.saturating_sub(child_top_inset);
                        let child_y = child_top_inset as i32;

                        eprintln!(
                            "[resize] window={}x{} scale={} top_chrome_phys={} child: y={} w={} h={}",
                            physical_size.width, physical_size.height,
                            scale_factor, top_chrome_physical_height,
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
