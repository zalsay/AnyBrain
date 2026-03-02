use tauri::{AppHandle, Manager, WebviewBuilder, WebviewUrl, PhysicalPosition, PhysicalSize, Emitter};
use url::Url;
use tauri::webview::{DownloadEvent, PageLoadEvent, NewWindowResponse};
use std::path::PathBuf;

fn debug_log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/brainer_debug.log") {
        let _ = writeln!(f, "{}", msg);
    }
    eprintln!("{}", msg);
}

/// The height of the tab bar in logical (CSS) pixels.
/// This is the single source of truth shared with the resize handler in lib.rs.
pub const TAB_BAR_LOGICAL_HEIGHT: f64 = 70.0;

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

/// Find a non-conflicting path in the Downloads folder.
/// If `~/Downloads/file.txt` exists, tries `~/Downloads/file (1).txt`, etc.
fn unique_download_path(downloads_dir: &PathBuf, filename: &str) -> PathBuf {
    let base = PathBuf::from(filename);
    let stem = base.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = base.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();

    let candidate = downloads_dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    for i in 1.. {
        let name = format!("{} ({}){}", stem, i, ext);
        let candidate = downloads_dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
    }
    // Fallback (unreachable in practice)
    downloads_dir.join(filename)
}

#[tauri::command]
pub fn create_or_show_webview(
    app: AppHandle,
    platform_id: String,
    url: String,
    #[allow(unused)] top_offset: f64,
) -> Result<(), String> {
    debug_log(&format!("[create_or_show_webview] id={} url={}", platform_id, url));
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
        let normalized_url = if url.starts_with("http://") || url.starts_with("https://") {
            url.clone()
        } else {
            format!("https://{}", url)
        };
        // 所有标签统一按域名存储 user-data，确保数据跨会话持久化
        let host_key = match Url::parse(&normalized_url) {
            Ok(u) => u.host_str().unwrap_or("default").to_string(),
            Err(_) => "default".to_string(),
        };
        let store_key = host_key;
        let data_dir = app.path().app_local_data_dir().unwrap().join("webdata").join(&store_key);
        let parsed_url = normalized_url.parse().map_err(|e| format!("Invalid URL '{}': {}", url, e))?;
        let mut builder = WebviewBuilder::new(&platform_id, WebviewUrl::External(parsed_url))
            .data_directory(data_dir);
            
        #[cfg(target_os = "macos")]
        {
            // TEMPORARILY DISABLED: data_store_identifier may cause OAuth callback failures
            // because the isolated WKWebsiteDataStore may not properly handle cross-domain cookies
            // (e.g., auth.openai.com -> chatgpt.com redirects)
            // let mut id = [0u8; 16];
            // let bytes = store_key.as_bytes();
            // let len = bytes.len().min(16);
            // id[..len].copy_from_slice(&bytes[..len]);
            // id[6] = (id[6] & 0x0f) | 0x40;
            // id[8] = (id[8] & 0x3f) | 0x80;
            // builder = builder.data_store_identifier(id);
            debug_log(&format!("[webview] data_store_identifier DISABLED for '{}'", store_key));
        }

        let platform_id_clone = platform_id.clone();
        builder = builder.on_page_load(move |webview, payload| {
            match payload.event() {
                PageLoadEvent::Started => {
                    eprintln!("[webview] page load STARTED '{}' url={}", platform_id_clone, payload.url());
                }
                PageLoadEvent::Finished => {
                    debug_log(&format!("[webview] page load FINISHED '{}' url={}", platform_id_clone, payload.url()));
                    // Inject JS to capture page details and log them to /tmp/
                    let _ = webview.eval(
                        r#"
                        (function() {
                            var t = document.title;
                            var b = document.body ? document.body.innerText.substring(0, 500) : '(no body)';
                            var url = window.location.href;
                            // Log detailed info for debugging OAuth errors
                            if (url.includes('error') || url.includes('auth')) {
                                var xhr = new XMLHttpRequest();
                                xhr.open('POST', 'https://localhost/__tauri_debug__', false);
                                // We can't make this request, but we can use console
                                console.log('[BRAINER-DEBUG] url=' + url);
                                console.log('[BRAINER-DEBUG] title=' + t);
                                console.log('[BRAINER-DEBUG] body=' + b);
                                console.log('[BRAINER-DEBUG] cookies=' + document.cookie);
                                console.log('[BRAINER-DEBUG] localStorage_keys=' + Object.keys(localStorage || {}).join(','));
                            }
                        })();
                        "#
                    );
                }
            }
        });

        let app_handle_for_new = app.clone();
        let app_handle_for_auth = app.clone();
        let platform_id_for_auth = platform_id.clone();
        builder = builder.on_new_window(move |url, _features| {
            debug_log(&format!("[on_new_window] url={} size={:?}", url.as_str(), _features.size()));

            let url_str = url.as_str();
            let is_auth = url_str.contains("auth") || url_str.contains("login")
                || url_str.contains("signin") || url_str.contains("signup")
                || url_str.contains("oauth") || url_str.contains("sso")
                || url_str.contains("apple") || url_str.contains("google")
                || url_str.contains("github") || url_str.contains("microsoft")
                || url_str.contains("chatgpt.com");

            if is_auth || _features.size().is_some() {
                // Navigate the originating webview to the auth URL directly.
                // This works reliably in both dev and release builds, unlike
                // NewWindowResponse::Allow which creates a detached native
                // popup that macOS WKWebView cannot properly manage in
                // release/sandboxed builds.
                debug_log(" -> Navigating current webview to auth URL");
                let nav_js = format!("window.location.href = '{}';", url_str.replace("'", "\\'"));
                if let Some(wv) = app_handle_for_auth.get_webview(&platform_id_for_auth) {
                    let _ = wv.eval(&nav_js);
                }
                return NewWindowResponse::Deny;
            }

            let url_string = url_str.to_string();
            let _ = app_handle_for_new.emit("new_tab_request", url_string);
            NewWindowResponse::Deny
        });

        // Download handler: save directly to ~/Downloads
        builder = builder.on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    eprintln!("[download] requested: {}, default destination: {:?}", url, destination);

                    // Use the filename from the pre-populated destination (derived from
                    // Content-Disposition header by wry), falling back to URL parsing.
                    let filename = destination.file_name()
                        .map(|f| f.to_string_lossy().to_string())
                        .unwrap_or_else(|| {
                            let url_str = url.as_str();
                            url_str.split('/').last()
                                .and_then(|s| s.split('?').next())
                                .unwrap_or("download")
                                .to_string()
                        });

                    // Use ~/Downloads as destination
                    let downloads_dir = dirs::download_dir()
                        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Downloads"));

                    let path = unique_download_path(&downloads_dir, &filename);
                    eprintln!("[download] saving to: {:?}", path);
                    *destination = path;
                    true
                }
                DownloadEvent::Finished { url, path, success } => {
                    eprintln!("[download] finished: {} -> {:?}, success: {}", url, path, success);
                    true
                }
                _ => true,
            }
        });

        let created_webview = window
            .add_child(builder, position, size)
            .map_err(|e| e.to_string())?;

        // Enable javaScriptCanOpenWindowsAutomatically on macOS WKWebView
        // Without this, window.open() is silently blocked before reaching on_new_window
        #[cfg(target_os = "macos")]
        created_webview.with_webview(|wv| {
            unsafe {
                // wv.inner() returns *mut c_void which is a raw WKWebView pointer
                let wk_webview: *mut std::ffi::c_void = wv.inner();
                if wk_webview.is_null() {
                    debug_log("[webview] wk_webview is null, cannot enable javaScriptCanOpenWindowsAutomatically");
                    return;
                }

                // Use Objective-C runtime to call:
                //   [[wkWebView configuration] preferences] setValue:@YES forKey:@"javaScriptCanOpenWindowsAutomatically"
                extern "C" {
                    fn objc_msgSend(obj: *mut std::ffi::c_void, sel: *mut std::ffi::c_void, ...) -> *mut std::ffi::c_void;
                    fn sel_registerName(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
                }

                let sel_configuration = sel_registerName(b"configuration\0".as_ptr() as *const _);
                let sel_preferences = sel_registerName(b"preferences\0".as_ptr() as *const _);
                let sel_set_value = sel_registerName(b"setValue:forKey:\0".as_ptr() as *const _);

                // Get NSNumber YES
                let sel_number_with_bool = sel_registerName(b"numberWithBool:\0".as_ptr() as *const _);
                let ns_number_class = {
                    extern "C" {
                        fn objc_getClass(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
                    }
                    objc_getClass(b"NSNumber\0".as_ptr() as *const _)
                };
                let yes_value: *mut std::ffi::c_void = {
                    let f: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, i8) -> *mut std::ffi::c_void = std::mem::transmute(objc_msgSend as *const ());
                    f(ns_number_class, sel_number_with_bool, 1i8)
                };

                // Get NSString for key
                let ns_string_class = {
                    extern "C" {
                        fn objc_getClass(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
                    }
                    objc_getClass(b"NSString\0".as_ptr() as *const _)
                };
                let sel_string_with_utf8 = sel_registerName(b"stringWithUTF8String:\0".as_ptr() as *const _);
                let key_str: *mut std::ffi::c_void = {
                    let f: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *const std::ffi::c_char) -> *mut std::ffi::c_void = std::mem::transmute(objc_msgSend as *const ());
                    f(ns_string_class, sel_string_with_utf8, b"javaScriptCanOpenWindowsAutomatically\0".as_ptr() as *const _)
                };

                // [wkWebView configuration]
                let config: *mut std::ffi::c_void = {
                    let f: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> *mut std::ffi::c_void = std::mem::transmute(objc_msgSend as *const ());
                    f(wk_webview, sel_configuration)
                };

                // [[wkWebView configuration] preferences]
                let prefs: *mut std::ffi::c_void = {
                    let f: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> *mut std::ffi::c_void = std::mem::transmute(objc_msgSend as *const ());
                    f(config, sel_preferences)
                };

                // [prefs setValue:@YES forKey:@"javaScriptCanOpenWindowsAutomatically"]
                let f: unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut std::ffi::c_void, *mut std::ffi::c_void) = std::mem::transmute(objc_msgSend as *const ());
                f(prefs, sel_set_value, yes_value, key_str);

                debug_log("[webview] enabled javaScriptCanOpenWindowsAutomatically via raw objc");
            }
        }).unwrap_or_else(|e| debug_log(&format!("[webview] with_webview error: {}", e)));

        debug_log(&format!("[webview] created new '{}'", platform_id));
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

#[tauri::command]
pub fn reload_webview_url(app: AppHandle, platform_id: String, url: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&platform_id) {
        let js = format!("window.location.href = '{}';", url.replace("'", "\\'"));
        let _ = webview.eval(&js);
    }
    Ok(())
}
