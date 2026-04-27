mod cli;
mod commands;
mod config;
mod state;

use std::sync::Mutex;
use tauri::tray::TrayIconEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use config::{AppConfig, ensure_dirs, ensure_default_templates, default_storage_path};
use state::{ShortcutState, ScreenshotShortcutState, CaptureState, ScreenshotOverlayDataState};
use commands::screenshot::{cleanup_temp_bmp, precreate_screenshot_overlay, show_screenshot_overlay};

fn toggle_quick_input_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick-input") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.set_always_on_top(true);
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            let config = AppConfig::load_or_default(app);
            let _ = app.emit("quick-input-shown", &config);
        }
    }
}

fn show_quick_input_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick-input") {
        let _ = window.set_always_on_top(true);
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let config = AppConfig::load_or_default(app);
        let _ = app.emit("quick-input-shown", &config);
    }
}

#[tauri::command]
fn show_quick_input_cmd(app: tauri::AppHandle) {
    show_quick_input_window(&app);
}

#[tauri::command]
fn hide_quick_input(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick-input") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Option<AppConfig> {
    AppConfig::load(&app)
}

#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    config: AppConfig,
    state: tauri::State<'_, ShortcutState>,
    screenshot_state: tauri::State<'_, ScreenshotShortcutState>,
) -> Result<(), String> {
    ensure_dirs(&config.storage_path)?;
    ensure_default_templates(&config.storage_path);

    // If shortcut changed, re-register the global shortcut
    let new_shortcut = config.shortcut.clone();
    let old_shortcut = state.0.lock().unwrap().clone();
    if new_shortcut != old_shortcut {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        // Unregister old
        if let Ok(old) = old_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            let _ = app.global_shortcut().unregister(old);
        }
        // Register new
        if let Ok(new_shortcut) = new_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            match app.global_shortcut().register(new_shortcut) {
                Ok(_) => eprintln!("[shortcut] Re-registered: {}", new_shortcut),
                Err(e) => eprintln!("[shortcut] Failed to re-register: {} - {}", new_shortcut, e),
            }
        }
    }

    // If screenshot shortcut changed, re-register it
    let new_screenshot_shortcut = &config.screenshot_shortcut;
    let old_screenshot_shortcut = screenshot_state.0.lock().unwrap().clone();
    if new_screenshot_shortcut != &old_screenshot_shortcut {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        // Unregister old
        if let Ok(old) = old_screenshot_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            let _ = app.global_shortcut().unregister(old);
        }
        // Register new
        if let Ok(new_shortcut) = new_screenshot_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            match app.global_shortcut().register(new_shortcut) {
                Ok(_) => eprintln!("[screenshot] Re-registered: {}", new_screenshot_shortcut),
                Err(e) => eprintln!("[screenshot] Failed to re-register: {} - {}", new_screenshot_shortcut, e),
            }
        }
    }

    *state.0.lock().unwrap() = config.shortcut.clone();
    *screenshot_state.0.lock().unwrap() = config.screenshot_shortcut.clone();
    config.save(&app)
}

#[tauri::command]
fn get_default_storage_path() -> String {
    default_storage_path()
}

#[tauri::command]
fn choose_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

/// Helper: register a global shortcut with logging.
fn register_shortcut(
    app: &tauri::AppHandle,
    shortcut_str: &str,
    label: &str,
) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if let Ok(shortcut) = shortcut_str.parse::<tauri_plugin_global_shortcut::Shortcut>() {
        match app.global_shortcut().register(shortcut) {
            Ok(_) => eprintln!("[{label}] Registered: {}", shortcut_str),
            Err(e) => eprintln!("[{label}] Failed: {} - {}", shortcut_str, e),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_agent_control::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    let expected_str = app.state::<ShortcutState>().0.lock().unwrap().clone();
                    let expected_screenshot_str = app.state::<ScreenshotShortcutState>().0.lock().unwrap().clone();

                    // Compare parsed Shortcut objects instead of strings.
                    // `shortcut.to_string()` may normalize "CommandOrControl" to
                    // "Ctrl" on Windows, causing string comparison to fail.
                    if let Ok(expected) = expected_str.parse::<tauri_plugin_global_shortcut::Shortcut>() {
                        if *shortcut == expected {
                            toggle_quick_input_window(app);
                            return;
                        }
                    }

                    if let Ok(expected_screenshot) = expected_screenshot_str.parse::<tauri_plugin_global_shortcut::Shortcut>() {
                        if *shortcut == expected_screenshot {
                            let _ = show_screenshot_overlay(app);
                        }
                    }
                })
                .build(),
        )
        .manage(ShortcutState(Mutex::new(config::default_shortcut())))
        .manage(ScreenshotShortcutState(Mutex::new(config::default_screenshot_shortcut())))
        .manage(CaptureState(Mutex::new(None)))
        .manage(ScreenshotOverlayDataState(Mutex::new(None)))
        .setup(move |app| {
            // Clean up any leftover temp BMP files from a previous crash
            cleanup_temp_bmp();

            // Register global shortcut from Rust — works even before JS loads,
            // and works when the main window is hidden (minimized to tray)
            {
                let app_handle = app.handle().clone();
                let config = AppConfig::load_or_default(&app_handle);
                let shortcut_str = config.shortcut.clone();
                *app.state::<ShortcutState>().0.lock().unwrap() = shortcut_str.clone();

                register_shortcut(&app_handle, &shortcut_str, "shortcut");
            }

            // Register screenshot shortcut
            {
                let app_handle = app.handle().clone();
                let config = AppConfig::load_or_default(&app_handle);
                let screenshot_shortcut_str = config.screenshot_shortcut.clone();
                *app.state::<ScreenshotShortcutState>().0.lock().unwrap() = screenshot_shortcut_str.clone();

                register_shortcut(&app_handle, &screenshot_shortcut_str, "screenshot");
            }

            // Intercept main window close → hide to tray
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            // Create quick-input window (hidden by default)
            let quick_input_url = if cfg!(debug_assertions) {
                tauri::WebviewUrl::External(
                    "http://localhost:1420/quick-input.html".parse().unwrap(),
                )
            } else {
                tauri::WebviewUrl::App("quick-input.html".into())
            };
            let _quick_input =
                tauri::WebviewWindowBuilder::new(app, "quick-input", quick_input_url)
                    .inner_size(480.0, 160.0)
                    .center()
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .resizable(false)
                    .visible(false)
                    .build()?;

            // Quick-input window: close button should hide, not destroy
            if let Some(qi_window) = app.get_webview_window("quick-input") {
                let qi_clone = qi_window.clone();
                qi_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = qi_clone.hide();
                    }
                });
            }

            // Pre-create screenshot overlay window (hidden) to eliminate
            // the 300-500ms WebView2 creation delay on first screenshot.
            precreate_screenshot_overlay(app.handle());

            // Tray icon setup
            let show_item =
                tauri::menu::MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let settings_item =
                tauri::menu::MenuItem::with_id(app, "settings", "设置...", true, None::<&str>)?;
            let quit_item =
                tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let menu = tauri::menu::Menu::with_items(
                app,
                &[&show_item, &settings_item, &separator, &quit_item],
            )?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .tooltip("WorkerBee")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("navigate-to-settings", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = &event
                    {
                        if *button == tauri::tray::MouseButton::Left
                            && *button_state == tauri::tray::MouseButtonState::Up
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_default_storage_path,
            choose_folder,
            show_quick_input_cmd,
            hide_quick_input,
            commands::logs::save_log,
            commands::logs::read_log,
            commands::logs::write_log,
            commands::logs::list_logs,
            commands::reports::list_reports,
            commands::reports::read_report,
            commands::reports::write_report,
            commands::templates::list_templates,
            commands::templates::read_template,
            commands::templates::write_template,
            commands::templates::delete_template,
            commands::screenshot::crop_and_save_screenshot,
            commands::screenshot::save_screenshot_log_entry,
            commands::screenshot::close_screenshot_overlay,
            commands::screenshot::cancel_screenshot,
            commands::screenshot::read_screenshot_as_base64,
            commands::screenshot::get_screenshot_overlay_data,
            commands::screenshot::list_screenshots,
            commands::screenshot::delete_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
