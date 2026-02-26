use tauri::{AppHandle, Manager, WebviewBuilder, WebviewUrl, PhysicalPosition, PhysicalSize};
use tauri::webview::DownloadEvent;
use tauri_plugin_dialog::DialogExt;
use std::sync::{Arc, Mutex};

/// The height of the tab bar in logical (CSS) pixels.
/// This is the single source of truth shared with the resize handler in lib.rs.
pub const TAB_BAR_LOGICAL_HEIGHT: f64 = 76.0;

/// Compute the child webview's physical bounds based on the main window's current size.
fn compute_child_bounds(window: &tauri::Window) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let physical_size = window.inner_size().unwrap();
    let scale_factor = window.scale_factor().unwrap_or(2.0);

    let tab_physical_height = (TAB_BAR_LOGICAL_HEIGHT * scale_factor) as u32;

    let position = PhysicalPosition::new(0_i32, tab_physical_height as i32);
    let size = PhysicalSize::new(
        physical_size.width,
        physical_size.height.saturating_sub(tab_physical_height),
    );

    (position, size)
}

#[tauri::command]
pub fn create_or_show_webview(
    app: AppHandle,
    platform_id: String,
    url: String,
    #[allow(unused)] top_offset: f64,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("Main window not found")?;

    // Hide other child webviews first
    for webview in app.webviews().values() {
        if webview.label() != "main" && webview.label() != platform_id {
            eprintln!("[webview] hiding '{}'", webview.label());
            let _ = webview.hide();
        }
    }

    let (position, size) = compute_child_bounds(&window);
    eprintln!(
        "[webview] create_or_show '{}' bounds: pos=({},{}) size={}x{}",
        platform_id, position.x, position.y, size.width, size.height
    );

    if let Some(existing_webview) = app.get_webview(&platform_id) {
        // Webview already exists — update bounds and show
        let _ = existing_webview.set_position(position);
        let _ = existing_webview.set_size(size);
        let _ = existing_webview.show();
        eprintln!("[webview] re-shown '{}'", platform_id);
    } else {
        // Create a new child webview with isolated data directory
        let data_dir = app.path().app_local_data_dir().unwrap().join(&platform_id);

        let mut builder = WebviewBuilder::new(&platform_id, WebviewUrl::External(url.parse().unwrap()))
            .data_directory(data_dir);
            
        #[cfg(target_os = "macos")]
        {
            // Set data_store_identifier for macOS 14+ to ensure cookies/localStorage isolation
            // It requires exactly [u8; 16] and should be a valid UUID.
            let mut id = [0u8; 16];
            let bytes = platform_id.as_bytes();
            let len = bytes.len().min(16);
            id[..len].copy_from_slice(&bytes[..len]);
            
            // Format as a valid UUIDv4
            id[6] = (id[6] & 0x0f) | 0x40;
            id[8] = (id[8] & 0x3f) | 0x80;
            
            builder = builder.data_store_identifier(id);
        }

        let platform_id_clone = platform_id.clone();
        builder = builder.on_page_load(move |_webview, payload| {
            eprintln!("[webview] page loaded '{}' url={:?}", platform_id_clone, payload.url());
        });

        // Download handler: show native save file dialog
        builder = builder.on_download(move |webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    eprintln!("[download] requested: {}", url);

                    // Extract filename from URL
                    let url_str = url.as_str();
                    let filename = url_str.split('/').last()
                        .and_then(|s| s.split('?').next())
                        .unwrap_or("download")
                        .to_string();

                    // Use a blocking approach with condvar to wait for dialog result
                    let result: Arc<Mutex<Option<Option<std::path::PathBuf>>>> = Arc::new(Mutex::new(None));
                    let result_clone = result.clone();
                    let condvar = Arc::new(std::sync::Condvar::new());
                    let condvar_clone = condvar.clone();

                    webview.app_handle().dialog()
                        .file()
                        .set_file_name(&filename)
                        .save_file(move |path| {
                            let mut lock = result_clone.lock().unwrap();
                            *lock = Some(path.map(|p| p.as_path().unwrap().to_path_buf()));
                            condvar_clone.notify_one();
                        });

                    // Wait for the dialog to complete
                    let mut lock = result.lock().unwrap();
                    while lock.is_none() {
                        lock = condvar.wait(lock).unwrap();
                    }

                    if let Some(Some(path)) = lock.take() {
                        eprintln!("[download] saving to: {:?}", path);
                        *destination = path;
                        true
                    } else {
                        eprintln!("[download] cancelled by user");
                        false
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    eprintln!("[download] finished: {} -> {:?}, success: {}", url, path, success);
                    true
                }
                _ => true,
            }
        });

        let _webview = window
            .add_child(builder, position, size)
            .map_err(|e| e.to_string())?;
        eprintln!("[webview] created new '{}'", platform_id);
    }

    Ok(())
}

#[tauri::command]
pub fn destroy_webview(
    app: AppHandle,
    platform_id: String,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&platform_id) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_all_webviews(app: AppHandle) -> Result<(), String> {
    for webview in app.webviews().values() {
        if webview.label() != "main" {
            let _ = webview.hide();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reload_webview(app: AppHandle, platform_id: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&platform_id) {
        let _ = webview.eval("window.location.reload()");
    }
    Ok(())
}
