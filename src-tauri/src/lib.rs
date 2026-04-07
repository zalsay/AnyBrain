use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
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
    serde_json::from_str(&data).ok()
}

fn save_window_state(app: &tauri::AppHandle, state: &WindowState) {
    let path = state_file_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(&path, json);
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

fn chat_history_jsonl_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    Ok(user_home_dir()?.join("AnyBrain").join("chat-history.jsonl"))
}

fn chat_sessions_root_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    Ok(user_home_dir()?.join("AnyBrain").join("chat-sessions"))
}

fn user_home_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "无法解析当前用户目录".to_string())
}

fn chat_sessions_index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(chat_sessions_root_dir(app)?.join("index.json"))
}

fn chat_sessions_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(chat_sessions_root_dir(app)?.join("sessions"))
}

fn chat_sessions_archive_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(chat_sessions_root_dir(app)?.join("archives"))
}

fn sanitize_session_file_name(session_id: &str) -> String {
    let sanitized = session_id
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
                char
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "session".to_string()
    } else {
        sanitized
    }
}

fn chat_session_jsonl_path(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    Ok(chat_sessions_data_dir(app)?.join(format!("{}.jsonl", sanitize_session_file_name(session_id))))
}

fn chat_session_archive_jsonl_path(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    Ok(chat_sessions_archive_dir(app)?.join(format!("{}.jsonl", sanitize_session_file_name(session_id))))
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ChatHistoryJsonlRecord {
    saved_at: i64,
    history: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ChatSessionJsonlRecord {
    saved_at: i64,
    session: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ChatSessionsIndexRecord {
    saved_at: i64,
    active_session_id: String,
    session_ids: Vec<String>,
}

fn current_timestamp_millis() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64)
}

fn read_jsonl_lines(path: &PathBuf) -> Result<Vec<String>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        }
    }

    Ok(lines)
}

fn read_last_jsonl_line(path: &PathBuf) -> Result<Option<String>, String> {
    match read_jsonl_lines(path) {
        Ok(lines) => Ok(lines.last().cloned()),
        Err(error) => {
            if path.exists() {
                Err(error)
            } else {
                Ok(None)
            }
        }
    }
}

fn read_last_session_record(path: &PathBuf) -> Result<Option<ChatSessionJsonlRecord>, String> {
    let Some(last_line) = read_last_jsonl_line(path)? else {
        return Ok(None);
    };
    let record = serde_json::from_str::<ChatSessionJsonlRecord>(&last_line).map_err(|e| e.to_string())?;
    Ok(Some(record))
}

fn is_chat_session_jsonl_file(path: &PathBuf) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false)
}

fn read_session_snapshot_map_from_dir(
    dir: &PathBuf,
    sessions_by_id: &mut std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !is_chat_session_jsonl_file(&path) {
            continue;
        }

        let record = match read_last_session_record(&path) {
            Ok(Some(record)) => record,
            Ok(None) => continue,
            Err(error) => {
                eprintln!(
                    "[AnyBrain][chat-history] skip invalid session file {}: {}",
                    path.display(),
                    error
                );
                continue;
            }
        };

        let session_id = match extract_session_id(&record.session) {
            Ok(session_id) => session_id,
            Err(error) => {
                eprintln!(
                    "[AnyBrain][chat-history] skip session without valid id {}: {}",
                    path.display(),
                    error
                );
                continue;
            }
        };

        sessions_by_id.insert(session_id, record.session);
    }

    Ok(())
}

fn extract_session_updated_at(session: &serde_json::Value) -> i64 {
    session
        .get("updatedAt")
        .and_then(|value| value.as_i64())
        .unwrap_or(0)
}

fn session_has_meaningful_messages(session: &serde_json::Value) -> bool {
    session
        .get("messages")
        .and_then(|value| value.as_array())
        .map(|messages| {
            messages.iter().any(|message| {
                message
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(|value| value != "welcome")
                    .unwrap_or(true)
            })
        })
        .unwrap_or(false)
}

fn sort_sessions_by_recent(mut sessions: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    sessions.sort_by(|a, b| extract_session_updated_at(b).cmp(&extract_session_updated_at(a)));
    sessions
}

fn resolve_preferred_active_session_id(
    sessions: &[serde_json::Value],
    preferred_session_id: &str,
) -> String {
    if sessions.is_empty() {
        return String::new();
    }

    let has_meaningful_session = sessions.iter().any(session_has_meaningful_messages);
    if !preferred_session_id.is_empty() {
        if let Some(preferred_session) = sessions.iter().find(|session| {
            session
                .get("id")
                .and_then(|value| value.as_str())
                == Some(preferred_session_id)
        }) {
            if !has_meaningful_session || session_has_meaningful_messages(preferred_session) {
                return preferred_session_id.to_string();
            }
        }
    }

    sessions
        .iter()
        .find(|session| session_has_meaningful_messages(session))
        .or_else(|| sessions.first())
        .and_then(|session| session.get("id").and_then(|value| value.as_str()))
        .unwrap_or_default()
        .to_string()
}

fn append_jsonl_line(path: &PathBuf, line: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())
}

fn rewrite_jsonl_lines(path: &PathBuf, lines: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    for line in lines {
        writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn extract_session_id(session: &serde_json::Value) -> Result<String, String> {
    session
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "会话缺少有效 id".to_string())
}

fn read_legacy_chat_history(path: &PathBuf) -> Result<Option<serde_json::Value>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };

    let reader = BufReader::new(file);
    let mut last_history: Option<serde_json::Value> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(record) = serde_json::from_str::<ChatHistoryJsonlRecord>(trimmed) {
            last_history = Some(record.history);
        }
    }

    Ok(last_history)
}

#[tauri::command]
fn load_chat_history_jsonl(app: tauri::AppHandle) -> Result<String, String> {
    let index_path = chat_sessions_index_path(&app)?;
    let stored_active_session_id = if index_path.exists() {
        match fs::read_to_string(&index_path) {
            Ok(index_data) => serde_json::from_str::<ChatSessionsIndexRecord>(&index_data)
                .map(|index| index.active_session_id)
                .unwrap_or_else(|error| {
                    eprintln!(
                        "[AnyBrain][chat-history] failed to parse index {}, fallback to latest session: {}",
                        index_path.display(),
                        error
                    );
                    String::new()
                }),
            Err(error) => {
                eprintln!(
                    "[AnyBrain][chat-history] failed to read index {}, fallback to latest session: {}",
                    index_path.display(),
                    error
                );
                String::new()
            }
        }
    } else {
        String::new()
    };

    let sessions_dir = chat_sessions_data_dir(&app)?;
    let archives_dir = chat_sessions_archive_dir(&app)?;
    if sessions_dir.exists() || archives_dir.exists() {
        let mut sessions_by_id = std::collections::HashMap::<String, serde_json::Value>::new();

        read_session_snapshot_map_from_dir(&archives_dir, &mut sessions_by_id)?;
        read_session_snapshot_map_from_dir(&sessions_dir, &mut sessions_by_id)?;

        let sessions = sort_sessions_by_recent(sessions_by_id.into_values().collect::<Vec<_>>());

        if !sessions.is_empty() {
            let active_session_id = resolve_preferred_active_session_id(&sessions, &stored_active_session_id);

            return Ok(serde_json::json!({
                "sessions": sessions,
                "activeSessionId": active_session_id,
            }).to_string());
        }
    }

    let legacy_path = chat_history_jsonl_path(&app)?;
    Ok(read_legacy_chat_history(&legacy_path)?
        .map(|history| history.to_string())
        .unwrap_or_else(|| "null".to_string()))
}

#[tauri::command]
fn save_chat_history_jsonl(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let history = serde_json::from_str::<serde_json::Value>(&data).map_err(|e| e.to_string())?;
    let requested_active_session_id = history
        .get("activeSessionId")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let incoming_sessions = history
        .get("sessions")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "聊天历史缺少 sessions".to_string())?;

    let saved_at = current_timestamp_millis()?;
    let sessions_dir = chat_sessions_data_dir(&app)?;
    fs::create_dir_all(&sessions_dir).map_err(|e| e.to_string())?;
    let archives_dir = chat_sessions_archive_dir(&app)?;
    fs::create_dir_all(&archives_dir).map_err(|e| e.to_string())?;

    let mut persisted_sessions_by_id = std::collections::HashMap::<String, serde_json::Value>::new();
    read_session_snapshot_map_from_dir(&archives_dir, &mut persisted_sessions_by_id)?;
    read_session_snapshot_map_from_dir(&sessions_dir, &mut persisted_sessions_by_id)?;
    for session in incoming_sessions {
        let session_id = extract_session_id(session)?;
        let session_already_exists = persisted_sessions_by_id.contains_key(&session_id);
        if !session_already_exists
            && !persisted_sessions_by_id.is_empty()
            && !session_has_meaningful_messages(session)
        {
            continue;
        }

        let session_path = chat_session_jsonl_path(&app, &session_id)?;
        let archive_path = chat_session_archive_jsonl_path(&app, &session_id)?;
        let record = ChatSessionJsonlRecord {
            saved_at,
            session: session.clone(),
        };
        let json = serde_json::to_string(&record).map_err(|e| e.to_string())?;

        if let Some(last_line) = read_last_jsonl_line(&session_path)? {
            let last_record = serde_json::from_str::<ChatSessionJsonlRecord>(&last_line).map_err(|e| e.to_string())?;
            if last_record.session == record.session {
                persisted_sessions_by_id.insert(session_id.clone(), record.session.clone());
                continue;
            }

            append_jsonl_line(&archive_path, &last_line)?;
        }

        rewrite_jsonl_lines(&session_path, &[json])?;
        persisted_sessions_by_id.insert(session_id, record.session);
    }

    let persisted_sessions = sort_sessions_by_recent(persisted_sessions_by_id.into_values().collect::<Vec<_>>());
    let session_ids = persisted_sessions
        .iter()
        .filter_map(|session| session.get("id").and_then(|value| value.as_str()).map(|value| value.to_string()))
        .collect::<Vec<_>>();
    let active_session_id = resolve_preferred_active_session_id(&persisted_sessions, &requested_active_session_id);

    let index = ChatSessionsIndexRecord {
        saved_at,
        active_session_id,
        session_ids,
    };
    write_chat_sessions_index(&app, &index)
}

fn write_chat_sessions_index(app: &tauri::AppHandle, index: &ChatSessionsIndexRecord) -> Result<(), String> {
    let index_path = chat_sessions_index_path(&app)?;
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if index_path.exists() {
        let existing_data = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
        let existing_index =
            serde_json::from_str::<ChatSessionsIndexRecord>(&existing_data).map_err(|e| e.to_string())?;
        if existing_index.active_session_id == index.active_session_id
            && existing_index.session_ids == index.session_ids
        {
            return Ok(());
        }
    }

    fs::write(
        &index_path,
        serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_chat_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let trimmed_session_id = session_id.trim();
    if trimmed_session_id.is_empty() {
        return Err("会话 id 不能为空".to_string());
    }

    let session_path = chat_session_jsonl_path(&app, trimmed_session_id)?;
    let archive_path = chat_session_archive_jsonl_path(&app, trimmed_session_id)?;

    if session_path.exists() {
        fs::remove_file(&session_path).map_err(|e| e.to_string())?;
    }

    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|e| e.to_string())?;
    }

    let index_path = chat_sessions_index_path(&app)?;
    let preferred_active_session_id = if index_path.exists() {
        match fs::read_to_string(&index_path) {
            Ok(index_data) => serde_json::from_str::<ChatSessionsIndexRecord>(&index_data)
                .map(|index| {
                    if index.active_session_id == trimmed_session_id {
                        String::new()
                    } else {
                        index.active_session_id
                    }
                })
                .unwrap_or_default(),
            Err(_) => String::new(),
        }
    } else {
        String::new()
    };

    let sessions_dir = chat_sessions_data_dir(&app)?;
    let archives_dir = chat_sessions_archive_dir(&app)?;
    let mut persisted_sessions_by_id = std::collections::HashMap::<String, serde_json::Value>::new();
    read_session_snapshot_map_from_dir(&archives_dir, &mut persisted_sessions_by_id)?;
    read_session_snapshot_map_from_dir(&sessions_dir, &mut persisted_sessions_by_id)?;

    let persisted_sessions = sort_sessions_by_recent(persisted_sessions_by_id.into_values().collect::<Vec<_>>());
    let session_ids = persisted_sessions
        .iter()
        .filter_map(|session| session.get("id").and_then(|value| value.as_str()).map(|value| value.to_string()))
        .collect::<Vec<_>>();

    let index = ChatSessionsIndexRecord {
        saved_at: current_timestamp_millis()?,
        active_session_id: resolve_preferred_active_session_id(&persisted_sessions, &preferred_active_session_id),
        session_ids,
    };

    write_chat_sessions_index(&app, &index)
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
            load_chat_history_jsonl,
            save_chat_history_jsonl,
            delete_chat_session,
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
            }

            let window_clone = main_window.clone();

            // Throttle state: last resize timestamp
            let last_resize = Mutex::new(Instant::now());

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
