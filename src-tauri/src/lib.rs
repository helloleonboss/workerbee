use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::tray::TrayIconEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

fn default_shortcut() -> String {
    "CommandOrControl+Shift+Space".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_show_hint_bar() -> bool {
    true
}

fn default_locale() -> String {
    "system".to_string()
}

fn default_agent_command() -> String {
    String::new()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    storage_path: String,
    #[serde(default = "default_shortcut")]
    shortcut: String,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_show_hint_bar")]
    show_hint_bar: bool,
    #[serde(default = "default_locale")]
    locale: String,
    #[serde(default = "default_agent_command")]
    agent_command: String,
}

impl AppConfig {
    fn config_path() -> PathBuf {
        dirs::home_dir()
            .map(|p| p.join(".workerbee").join(".workerbee.config.json"))
            .unwrap_or_else(|| PathBuf::from(".workerbee/.workerbee.config.json"))
    }

    fn load(_app: &tauri::AppHandle) -> Option<Self> {
        let path = Self::config_path();
        if path.exists() {
            let content = fs::read_to_string(&path).ok()?;
            serde_json::from_str(&content).ok()
        } else {
            None
        }
    }

    fn save(&self, _app: &tauri::AppHandle) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }

    fn load_or_default(app: &tauri::AppHandle) -> Self {
        Self::load(app).unwrap_or_else(|| AppConfig {
            storage_path: default_storage_path(),
            shortcut: default_shortcut(),
            theme: default_theme(),
            show_hint_bar: default_show_hint_bar(),
            locale: default_locale(),
            agent_command: default_agent_command(),
            agent_background: default_agent_background(),
        })
    }
}

fn default_storage_path() -> String {
    dirs::home_dir()
        .map(|p| p.join(".workerbee").to_string_lossy().to_string())
        .unwrap_or_else(|| ".workerbee".to_string())
}

fn ensure_dirs(storage_path: &str) -> Result<(), String> {
    let base = PathBuf::from(storage_path);
    fs::create_dir_all(base.join("logs")).map_err(|e| e.to_string())?;
    fs::create_dir_all(base.join("reports")).map_err(|e| e.to_string())?;
    fs::create_dir_all(base.join("templates")).map_err(|e| e.to_string())?;
    Ok(())
}

// Shared state for the current shortcut
struct ShortcutState(pub Mutex<String>);

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Option<AppConfig> {
    AppConfig::load(&app)
}

#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    config: AppConfig,
    state: tauri::State<'_, ShortcutState>,
) -> Result<(), String> {
    ensure_dirs(&config.storage_path)?;

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
        if let Ok(new_short) = new_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            match app.global_shortcut().register(new_short) {
                Ok(_) => eprintln!("[shortcut] Re-registered: {}", new_shortcut),
                Err(e) => eprintln!("[shortcut] Failed to re-register: {} - {}", new_shortcut, e),
            }
        }
    }

    *state.0.lock().unwrap() = config.shortcut.clone();
    config.save(&app)
}

#[tauri::command]
fn get_default_storage_path() -> String {
    default_storage_path()
}

#[tauri::command]
fn save_log(
    app: tauri::AppHandle,
    date: String,
    time: String,
    content: String,
) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let logs_dir = PathBuf::from(&config.storage_path).join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let file_path = logs_dir.join(format!("{}.md", date));

    let existing = if file_path.exists() {
        fs::read_to_string(&file_path).unwrap_or_default()
    } else {
        format!("---\ndate: {}\n---\n", date)
    };

    let entry = format!("\n## {}\n\n{}\n", time, content);
    let new_content = format!("{}{}", existing.trim_end(), entry);

    fs::write(&file_path, new_content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_log(app: tauri::AppHandle, date: String) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("logs")
        .join(format!("{}.md", date));

    if file_path.exists() {
        fs::read_to_string(&file_path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn list_logs(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let logs_dir = PathBuf::from(&config.storage_path).join("logs");

    if !logs_dir.exists() {
        return Ok(Vec::new());
    }

    let mut dates: Vec<String> = fs::read_dir(&logs_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") {
                Some(name.trim_end_matches(".md").to_string())
            } else {
                None
            }
        })
        .collect();

    dates.sort();
    dates.reverse();
    Ok(dates)
}

#[tauri::command]
fn list_reports(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let reports_dir = PathBuf::from(&config.storage_path).join("reports");

    if !reports_dir.exists() {
        return Ok(Vec::new());
    }

    let mut reports: Vec<String> = fs::read_dir(&reports_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") {
                Some(name.trim_end_matches(".md").to_string())
            } else {
                None
            }
        })
        .collect();

    reports.sort();
    reports.reverse();
    Ok(reports)
}

#[tauri::command]
fn read_report(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("reports")
        .join(format!("{}.md", filename));
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_report(app: tauri::AppHandle, filename: String, content: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let reports_dir = PathBuf::from(&config.storage_path).join("reports");
    fs::create_dir_all(&reports_dir).map_err(|e| e.to_string())?;
    let file_path = reports_dir.join(format!("{}.md", filename));
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_templates(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let templates_dir = PathBuf::from(&config.storage_path).join("templates");

    if !templates_dir.exists() {
        return Ok(Vec::new());
    }

    let mut templates: Vec<String> = fs::read_dir(&templates_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") {
                Some(name.trim_end_matches(".md").to_string())
            } else {
                None
            }
        })
        .collect();

    templates.sort();
    templates.reverse();
    Ok(templates)
}

#[tauri::command]
fn read_template(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("templates")
        .join(format!("{}.md", filename));
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_template(app: tauri::AppHandle, filename: String, content: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let templates_dir = PathBuf::from(&config.storage_path).join("templates");
    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;
    let file_path = templates_dir.join(format!("{}.md", filename));
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn generate_report(
    app: tauri::AppHandle,
    source_files: Vec<String>,
    template_name: String,
) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;

    // Check if agent_command is configured
    if config.agent_command.is_empty() {
        return Err("请先配置 Agent 命令".to_string());
    }

    if source_files.is_empty() {
        return Err("请选择至少一个来源文件".to_string());
    }

    // Parse agent_command - split on whitespace
    let parts: Vec<&str> = config.agent_command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("请先配置 Agent 命令".to_string());
    }
    let cmd = parts[0];
    let args: Vec<&str> = parts[1..].to_vec();

    // Read template content (optional)
    let template_content = if template_name.is_empty() {
        String::new()
    } else {
        let template_path = PathBuf::from(&config.storage_path)
            .join("templates")
            .join(format!("{}.md", template_name));
        if template_path.exists() {
            fs::read_to_string(&template_path).map_err(|e| e.to_string())?
        } else {
            return Err(format!("模板文件不存在: {}", template_name));
        }
    };

    // Read source files. Each source_file entry is like "logs/2026-04-14" or "reports/report-2026-04-14"
    // Format: "<subdir>/<filename_without_ext>"
    let mut all_source = String::new();
    let mut sorted_sources: Vec<(String, String)> = Vec::new();

    for sf in &source_files {
        let parts_vec: Vec<&str> = sf.splitn(2, '/').collect();
        if parts_vec.len() != 2 {
            return Err(format!("无效的文件路径: {}", sf));
        }
        let (subdir, name) = (parts_vec[0], parts_vec[1]);
        if !["logs", "reports"].contains(&subdir) {
            return Err(format!("无效的目录: {}", subdir));
        }
        let file_path = PathBuf::from(&config.storage_path)
            .join(subdir)
            .join(format!("{}.md", name));
        if !file_path.exists() {
            return Err(format!("文件不存在: {}", sf));
        }
        let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        sorted_sources.push((sf.clone(), content));
    }

    // Sort by source path for consistent ordering
    sorted_sources.sort_by(|a, b| a.0.cmp(&b.0));

    for (path, content) in &sorted_sources {
        if !all_source.is_empty() {
            all_source.push_str("\n\n---\n\n");
        }
        all_source.push_str(&format!("# {}\n\n{}", path, content));
    }

    // Build prompt
    let prompt = if template_content.is_empty() {
        all_source
    } else {
        format!("{}\n\n---\n\n# 输入内容\n\n{}", template_content, all_source)
    };

    // Execute agent command
    // On Windows, use `cmd /C` to support .ps1/.cmd scripts (e.g. claude, opencode)
    #[cfg(windows)]
    let mut child = {
        let full_cmd = format!("{} {}", cmd, args.join(" "));
        Command::new("cmd")
            .arg("/C")
            .arg(&full_cmd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?
    };

    #[cfg(not(windows))]
    let mut child = Command::new(cmd)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    // Write prompt to stdin and close it
    if let Some(mut stdin) = child.stdin.take() {
        std::thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
            // Drop stdin to close the pipe — signals EOF to the child process
        });
    }

    // Read stdout with size limit to prevent memory exhaustion
    const MAX_OUTPUT_SIZE: usize = 2 * 1024 * 1024; // 2 MB

    let output = child
        .wait_with_output()
        .map_err(|e| format!("执行命令失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("命令执行失败: {}", stderr));
    }

    // Truncate output if too large
    let stdout_len = output.stdout.len();
    let stdout_buf: Vec<u8> = if stdout_len > MAX_OUTPUT_SIZE {
        output.stdout[..MAX_OUTPUT_SIZE].to_vec()
    } else {
        output.stdout
    };

    let mut stdout = String::from_utf8_lossy(&stdout_buf).to_string();
    if stdout_len > MAX_OUTPUT_SIZE {
        stdout.push_str("\n\n---\n[输出超过 2MB，已截断]");
    }

    // Generate report filename with timestamp
    let now = chrono::Local::now();
    let filename = format!("report-{}", now.format("%Y-%m-%d-%H%M%S"));

    // Save report
    let reports_dir = PathBuf::from(&config.storage_path).join("reports");
    fs::create_dir_all(&reports_dir).map_err(|e| e.to_string())?;
    let report_path = reports_dir.join(format!("{}.md", filename));
    fs::write(&report_path, &stdout).map_err(|e| e.to_string())?;

    Ok(filename)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DetectedAgent {
    name: String,
    command: String,
    available: bool,
}

#[cfg(windows)]
fn is_command_available(cmd: &str) -> bool {
    use std::process::{Command, Stdio};
    Command::new("where.exe")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_command_available(cmd: &str) -> bool {
    use std::process::{Command, Stdio};
    Command::new("which")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
fn detect_agents() -> Vec<DetectedAgent> {
    let agents = [
        ("claude", "Claude (Anthropic)"),
        ("aichat", "aichat"),
        ("opencode", "OpenCode"),
        ("codex", "Codex (OpenAI)"),
        ("ollama", "Ollama"),
        ("aider", "Aider"),
        ("llm", "llm (Datasette)"),
        ("sgpt", "Shell-GPT"),
        ("fabric", "Fabric"),
        ("chatgpt", "ChatGPT CLI"),
    ];

    agents.iter().map(|(cmd, name)| {
        DetectedAgent {
            name: name.to_string(),
            command: cmd.to_string(),
            available: is_command_available(cmd),
        }
    }).collect()
}

#[tauri::command]
fn delete_template(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("templates")
        .join(format!("{}.md", filename));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn choose_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

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
fn write_log(app: tauri::AppHandle, date: String, content: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let logs_dir = PathBuf::from(&config.storage_path).join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let file_path = logs_dir.join(format!("{}.md", date));

    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    toggle_quick_input_window(app);
                })
                .build(),
        )
        .manage(ShortcutState(Mutex::new(default_shortcut())))
        .setup(move |app| {
            // Register global shortcut from Rust — works even before JS loads,
            // and works when the main window is hidden (minimized to tray)
            {
                let app_handle = app.handle().clone();
                let config = AppConfig::load_or_default(&app_handle);
                let shortcut_str = config.shortcut.clone();
                *app.state::<ShortcutState>().0.lock().unwrap() = shortcut_str.clone();

                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Ok(shortcut) = shortcut_str.parse::<tauri_plugin_global_shortcut::Shortcut>()
                {
                    match app_handle.global_shortcut().register(shortcut) {
                        Ok(_) => eprintln!("[shortcut] Registered: {}", shortcut_str),
                        Err(e) => eprintln!("[shortcut] Failed: {} - {}", shortcut_str, e),
                    }
                }
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
            save_log,
            read_log,
            write_log,
            list_logs,
            list_reports,
            read_report,
            write_report,
            list_templates,
            read_template,
            write_template,
            delete_template,
            generate_report,
            detect_agents,
            choose_folder,
            show_quick_input_cmd,
            hide_quick_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
