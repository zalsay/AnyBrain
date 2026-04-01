use tauri::{AppHandle, Manager, WebviewBuilder, WebviewUrl, PhysicalPosition, PhysicalSize, Emitter};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::webview::{DownloadEvent, PageLoadEvent, NewWindowResponse};
use url::Url;

/// The height of the tab row in logical (CSS) pixels.
pub const TITLE_BAR_LOGICAL_HEIGHT: f64 = 40.0;
/// The height of the browser toolbar row in logical (CSS) pixels.
pub const BROWSER_TOOLBAR_LOGICAL_HEIGHT: f64 = 36.0;
/// Total reserved top chrome height shared with the resize handler in lib.rs.
pub const TOP_CHROME_LOGICAL_HEIGHT: f64 = TITLE_BAR_LOGICAL_HEIGHT + BROWSER_TOOLBAR_LOGICAL_HEIGHT;

#[derive(Clone, Debug, Default)]
struct BrowserNavigationState {
    current_url: String,
    home_url: String,
    is_loading: bool,
    history: Vec<String>,
    history_index: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserNavigationStatePayload {
    platform_id: String,
    current_url: String,
    home_url: String,
    is_loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
}

static NAVIGATION_STATES: OnceLock<Mutex<HashMap<String, BrowserNavigationState>>> = OnceLock::new();

fn navigation_states() -> &'static Mutex<HashMap<String, BrowserNavigationState>> {
    NAVIGATION_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn emit_navigation_state(app: &AppHandle, platform_id: &str) {
    let payload = {
        let states = navigation_states().lock().unwrap();
        states.get(platform_id).map(|state| BrowserNavigationStatePayload {
            platform_id: platform_id.to_string(),
            current_url: state.current_url.clone(),
            home_url: state.home_url.clone(),
            is_loading: state.is_loading,
            can_go_back: state.history_index > 0,
            can_go_forward: state.history_index + 1 < state.history.len(),
        })
    };

    if let Some(payload) = payload {
        let _ = app.emit("browser_navigation_state", payload);
    }
}

fn upsert_navigation_state<F>(app: &AppHandle, platform_id: &str, update: F)
where
    F: FnOnce(&mut BrowserNavigationState),
{
    {
        let mut states = navigation_states().lock().unwrap();
        let state = states.entry(platform_id.to_string()).or_default();
        update(state);
    }
    emit_navigation_state(app, platform_id);
}

fn sync_navigation_url(app: &AppHandle, platform_id: &str, next_url: &str, is_loading: bool) {
    upsert_navigation_state(app, platform_id, |state| {
        let normalized = next_url.trim().to_string();
        if state.home_url.is_empty() {
            state.home_url = normalized.clone();
        }

        if normalized.is_empty() {
            state.current_url.clear();
            state.is_loading = is_loading;
            return;
        }

        if state.history.get(state.history_index).map(|item| item == &normalized).unwrap_or(false) {
            state.current_url = normalized;
            state.is_loading = is_loading;
            return;
        }

        if state.history_index + 1 < state.history.len() {
            state.history.truncate(state.history_index + 1);
        }
        state.history.push(normalized.clone());
        state.history_index = state.history.len().saturating_sub(1);
        state.current_url = normalized;
        state.is_loading = is_loading;
    });
}

fn remove_navigation_state(app: &AppHandle, platform_id: &str) {
    let mut states = navigation_states().lock().unwrap();
    states.remove(platform_id);
    let _ = app.emit("browser_navigation_state_removed", platform_id.to_string());
}

fn navigate_webview_to_url(webview: &tauri::Webview, url: &str) -> Result<(), String> {
    let js = format!("window.location.href = {};", serde_json::to_string(url).map_err(|e| e.to_string())?);
    webview.eval(&js).map_err(|e| e.to_string())
}

const TTS_INJECT_SCRIPT: &str = r###"(function () {
  if (window.__brainer_tts_bootstrap) {
    if (window.__brainer_tts_init) {
      window.__brainer_tts_init();
    }
    return;
  }
  window.__brainer_tts_bootstrap = true;

  const state = window.__brainer_tts_state || (window.__brainer_tts_state = { text: '', btn: null });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  window.__brainer_tts_rate = typeof window.__brainer_tts_rate === 'number' ? window.__brainer_tts_rate : 0.9;
  window.__brainer_tts_set_rate = function (rate) {
    const next = Number(rate);
    if (!Number.isFinite(next)) return;
    window.__brainer_tts_rate = clamp(next, 0.7, 1.3);
  };

  function ensureStyle() {
    if (document.getElementById('brainer-tts-style')) return;
    if (!document.head) {
      document.addEventListener('DOMContentLoaded', ensureStyle, { once: true });
      return;
    }
    const style = document.createElement('style');
    style.id = 'brainer-tts-style';
    style.textContent =
      '#brainer-tts-fab{' +
      'position:fixed;' +
      'z-index:2147483647;' +
      'display:none;' +
      'padding:6px 10px;' +
      'background:#111;' +
      'color:#fff;' +
      'border:0;' +
      'border-radius:999px;' +
      'font-size:12px;' +
      'line-height:1;' +
      'box-shadow:0 4px 14px rgba(0,0,0,0.2);' +
      'cursor:pointer;' +
      'user-select:none;' +
      '}' +
      '#brainer-tts-fab:active{transform:scale(0.98);}';
    document.head.appendChild(style);
  }

  function ensureButton() {
    let btn = document.getElementById('brainer-tts-fab');
    if (!btn) {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
        return;
      }
      btn = document.createElement('button');
      btn.id = 'brainer-tts-fab';
      btn.type = 'button';
      btn.textContent = '朗读';
      document.body.appendChild(btn);
    }
    if (!btn.__brainer_bound) {
      btn.__brainer_bound = true;
      btn.addEventListener('click', onButtonClick, true);
    }
    state.btn = btn;
  }

  function hideButton() {
    if (state.btn) state.btn.style.display = 'none';
  }

  function positionButton(rect) {
    ensureButton();
    const btn = state.btn;
    if (!btn) return;
    const padding = 8;
    const left = clamp(rect.right + 8, padding, window.innerWidth - btn.offsetWidth - padding);
    const top = clamp(rect.top - 8, padding, window.innerHeight - btn.offsetHeight - padding);
    btn.style.left = Math.round(left) + 'px';
    btn.style.top = Math.round(top) + 'px';
    btn.style.display = 'block';
  }

  function getSelectionData() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text, rect };
  }

  function updateFromSelection() {
    const data = getSelectionData();
    if (!data) {
      hideButton();
      return;
    }
    state.text = data.text;
    positionButton(data.rect);
  }

  function onButtonClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!state.text) {
      hideButton();
      return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      console.warn('[brainer-tts] speechSynthesis not available');
      hideButton();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(state.text);
      utter.rate = window.__brainer_tts_rate ?? 0.9;
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.warn('[brainer-tts] speak failed', err);
    }
  }

  function onMouseDown(ev) {
    if (state.btn && state.btn.contains(ev.target)) return;
    hideButton();
  }

  function setupListeners() {
    if (window.__brainer_tts_listeners) return;
    window.__brainer_tts_listeners = true;
    document.addEventListener('selectionchange', updateFromSelection);
    document.addEventListener('mouseup', updateFromSelection);
    document.addEventListener('keyup', updateFromSelection);
    document.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('scroll', hideButton, true);
  }

  window.__brainer_tts_init = function () {
    ensureStyle();
    ensureButton();
  };

  setupListeners();
  ensureStyle();
  ensureButton();
})();
"###;

const TTS_REINIT_SCRIPT: &str = "window.__brainer_tts_init && window.__brainer_tts_init();";

/// Extra inset applied to child webviews to keep the browser toolbar visible above native webview content.
pub const CHILD_WEBVIEW_EXTRA_TOP_INSET_LOGICAL_HEIGHT: f64 = 36.0;

/// Compute the reserved top chrome height in physical pixels.
fn compute_top_chrome_physical_height(window: &tauri::Window) -> u32 {
    let scale_factor = window.scale_factor().unwrap_or(2.0);
    (TOP_CHROME_LOGICAL_HEIGHT * scale_factor).ceil() as u32
}

fn compute_child_extra_top_inset_physical_height(window: &tauri::Window) -> u32 {
    let scale_factor = window.scale_factor().unwrap_or(2.0);
    (CHILD_WEBVIEW_EXTRA_TOP_INSET_LOGICAL_HEIGHT * scale_factor).ceil() as u32
}

/// Compute the child webview's physical bounds based on the main window's current size.
fn compute_child_bounds(window: &tauri::Window) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let physical_size = window.inner_size().unwrap();
    let top_chrome_physical_height = compute_top_chrome_physical_height(window);
    let child_extra_top_inset = compute_child_extra_top_inset_physical_height(window);
    let child_top_inset = top_chrome_physical_height.saturating_add(child_extra_top_inset);

    let size = PhysicalSize::new(
        physical_size.width,
        physical_size.height.saturating_sub(child_top_inset),
    );

    let position = PhysicalPosition::new(0_i32, child_top_inset as i32);

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
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("Main window not found")?;

    // Hide other child webviews first
    for webview in app.webviews().values() {
        if webview.label() != "main" && webview.label() != platform_id {
            let _ = webview.hide();
        }
    }

    let (position, size) = compute_child_bounds(&window);

    if let Some(existing_webview) = app.get_webview(&platform_id) {
        // Webview already exists — update bounds and show
        let _ = existing_webview.set_position(position);
        let _ = existing_webview.set_size(size);
        let _ = existing_webview.show();
        emit_navigation_state(&app, &platform_id);
    } else {
        // Create a new child webview with isolated data directory
        let normalized_url = if url.starts_with("http://") || url.starts_with("https://") {
            url.clone()
        } else {
            format!("https://{}", url)
        };
        upsert_navigation_state(&app, &platform_id, |state| {
            if state.home_url.is_empty() {
                state.home_url = normalized_url.clone();
            }
            if state.current_url.is_empty() {
                state.current_url = normalized_url.clone();
            }
            if state.history.is_empty() {
                state.history.push(normalized_url.clone());
                state.history_index = 0;
            }
            state.is_loading = false;
        });
        // 所有标签统一按域名存储 user-data，确保数据跨会话持久化
        let host_key = match Url::parse(&normalized_url) {
            Ok(u) => u.host_str().unwrap_or("default").to_string(),
            Err(_) => "default".to_string(),
        };
        let store_key = host_key;
        let data_dir = app.path().app_local_data_dir().unwrap().join("webdata").join(&store_key);
        let parsed_url = normalized_url.parse().map_err(|e| format!("Invalid URL '{}': {}", url, e))?;
        let mut builder = WebviewBuilder::new(&platform_id, WebviewUrl::External(parsed_url))
            .data_directory(data_dir)
            .initialization_script(TTS_INJECT_SCRIPT);

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
        }

        let platform_id_clone = platform_id.clone();
        let app_handle_for_page_load = app.clone();
        builder = builder.on_page_load(move |_webview, payload| {
            match payload.event() {
                PageLoadEvent::Started => {
                    sync_navigation_url(&app_handle_for_page_load, &platform_id_clone, payload.url().as_str(), true);
                }
                PageLoadEvent::Finished => {
                    sync_navigation_url(&app_handle_for_page_load, &platform_id_clone, payload.url().as_str(), false);
                    let _ = _webview.eval(TTS_REINIT_SCRIPT);
                }
            }
        });

        let app_handle_for_new = app.clone();
        let app_handle_for_auth = app.clone();
        let platform_id_for_auth = platform_id.clone();
        builder = builder.on_new_window(move |url, _features| {
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
                if let Some(wv) = app_handle_for_auth.get_webview(&platform_id_for_auth) {
                    let _ = navigate_webview_to_url(&wv, url_str);
                }
                sync_navigation_url(&app_handle_for_auth, &platform_id_for_auth, url_str, true);
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
                    *destination = path;
                    true
                }
                DownloadEvent::Finished { .. } => true,
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
            }
        }).map_err(|e| e.to_string())?;
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
    remove_navigation_state(&app, &platform_id);
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
pub fn navigate_webview_home(app: AppHandle, platform_id: String) -> Result<(), String> {
    let home_url = {
        let states = navigation_states().lock().unwrap();
        states
            .get(&platform_id)
            .map(|state| state.home_url.clone())
            .filter(|url| !url.is_empty())
    };

    let home_url = home_url.ok_or_else(|| "Home URL not found".to_string())?;
    let webview = app.get_webview(&platform_id).ok_or_else(|| "Webview not found".to_string())?;
    sync_navigation_url(&app, &platform_id, &home_url, true);
    navigate_webview_to_url(&webview, &home_url)
}

#[tauri::command]
pub fn navigate_webview_back(app: AppHandle, platform_id: String) -> Result<(), String> {
    let target_url = {
        let mut states = navigation_states().lock().unwrap();
        let state = states.get_mut(&platform_id).ok_or_else(|| "Navigation state not found".to_string())?;
        if state.history_index == 0 {
            return Err("No back history".to_string());
        }
        state.history_index -= 1;
        let target = state.history.get(state.history_index).cloned().ok_or_else(|| "No back history".to_string())?;
        state.current_url = target.clone();
        state.is_loading = true;
        target
    };
    emit_navigation_state(&app, &platform_id);
    let webview = app.get_webview(&platform_id).ok_or_else(|| "Webview not found".to_string())?;
    navigate_webview_to_url(&webview, &target_url)
}

#[tauri::command]
pub fn navigate_webview_forward(app: AppHandle, platform_id: String) -> Result<(), String> {
    let target_url = {
        let mut states = navigation_states().lock().unwrap();
        let state = states.get_mut(&platform_id).ok_or_else(|| "Navigation state not found".to_string())?;
        if state.history_index + 1 >= state.history.len() {
            return Err("No forward history".to_string());
        }
        state.history_index += 1;
        let target = state.history.get(state.history_index).cloned().ok_or_else(|| "No forward history".to_string())?;
        state.current_url = target.clone();
        state.is_loading = true;
        target
    };
    emit_navigation_state(&app, &platform_id);
    let webview = app.get_webview(&platform_id).ok_or_else(|| "Webview not found".to_string())?;
    navigate_webview_to_url(&webview, &target_url)
}

#[tauri::command]
pub fn reload_webview(app: AppHandle, platform_id: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&platform_id) {
        upsert_navigation_state(&app, &platform_id, |state| {
            state.is_loading = true;
        });
        webview.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reload_webview_url(app: AppHandle, platform_id: String, url: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&platform_id) {
        let normalized_url = if url.starts_with("http://") || url.starts_with("https://") {
            url
        } else {
            format!("https://{}", url)
        };
        sync_navigation_url(&app, &platform_id, &normalized_url, true);
        navigate_webview_to_url(&webview, &normalized_url)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_tts_rate(app: AppHandle, rate: f64) -> Result<(), String> {
    let clamped = if rate.is_finite() {
        rate.clamp(0.7, 1.3)
    } else {
        0.9
    };
    let js = format!(
        "window.__brainer_tts_rate = {0}; window.__brainer_tts_set_rate && window.__brainer_tts_set_rate({0});",
        clamped
    );
    for webview in app.webviews().values() {
        if webview.label() != "main" {
            let _ = webview.eval(&js);
        }
    }
    Ok(())
}
