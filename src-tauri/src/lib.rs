use chrono::Local;
use serde::{Deserialize, Serialize};
use std::env;
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

const DEFAULT_PROMPT: &str = "# 任务

你是一个工作日报生成助手。请根据以下工作日志生成一份专业的工作日报。

{{instruction}}

# 输入内容

{{source}}
";

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
) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;

    if config.agent_command.is_empty() {
        return Err("请先配置 Agent 命令".to_string());
    }

    if source_files.is_empty() {
        return Err("请选择至少一个来源文件".to_string());
    }

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

    // Read source files
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

    sorted_sources.sort_by(|a, b| a.0.cmp(&b.0));

    for (path, content) in &sorted_sources {
        if !all_source.is_empty() {
            all_source.push_str("\n\n---\n\n");
        }
        all_source.push_str(&format!("# {}\n\n{}", path, content));
    }

    // Load prompt template: always use default.md, fill in placeholders
    let templates_dir = PathBuf::from(&config.storage_path).join("templates");
    let default_path = templates_dir.join("default.md");
    let template = if default_path.exists() {
        fs::read_to_string(&default_path).unwrap_or_else(|_| DEFAULT_PROMPT.to_string())
    } else {
        let _ = fs::create_dir_all(&templates_dir);
        let _ = fs::write(&default_path, DEFAULT_PROMPT);
        DEFAULT_PROMPT.to_string()
    };

    let prompt = template
        .replace("{{instruction}}", &template_content)
        .replace("{{source}}", &all_source);

    // Write prompt to file (for user reference)
    let prompt_path = PathBuf::from(&config.storage_path).join(".last-prompt.md");
    fs::write(&prompt_path, &prompt).map_err(|e| e.to_string())?;

    // Open a visible terminal window: pipe prompt content to agent via stdin.
    // Must use raw_arg() instead of args() — args() applies MSVCRT escaping
    // which wraps the command in quotes, turning the pipe `|` into a literal char.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;
        let prompt_str = prompt_path.to_string_lossy().to_string();
        let full_cmd = format!("type \"{}\" | {}", prompt_str, config.agent_command);
        let mut cmd = Command::new("cmd.exe");
        cmd.raw_arg(format!("/K {}", full_cmd))
            .creation_flags(CREATE_NEW_CONSOLE);
        cmd.spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?;
    }

    #[cfg(not(windows))]
    {
        let prompt_str = prompt_path.to_string_lossy().to_string();
        let full_cmd = format!("cat '{}' | {}", prompt_str, config.agent_command);
        Command::new("sh")
            .args(&["-c", &full_cmd])
            .spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn execute_prompt(app: tauri::AppHandle, prompt: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;

    if config.agent_command.is_empty() {
        return Err("请先配置 Agent 命令".to_string());
    }

    // Write prompt to file
    let prompt_path = PathBuf::from(&config.storage_path).join(".last-prompt.md");
    fs::write(&prompt_path, &prompt).map_err(|e| e.to_string())?;

    // Open a visible terminal window: pipe prompt content to agent via stdin.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;
        let prompt_str = prompt_path.to_string_lossy().to_string();
        let full_cmd = format!("type \"{}\" | {}", prompt_str, config.agent_command);
        let mut cmd = Command::new("cmd.exe");
        cmd.raw_arg(format!("/K {}", full_cmd))
            .creation_flags(CREATE_NEW_CONSOLE);
        cmd.spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?;
    }

    #[cfg(not(windows))]
    {
        let prompt_str = prompt_path.to_string_lossy().to_string();
        let full_cmd = format!("cat '{}' | {}", prompt_str, config.agent_command);
        Command::new("sh")
            .args(&["-c", &full_cmd])
            .spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?;
    }

    Ok(())
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
            execute_prompt,
            choose_folder,
            show_quick_input_cmd,
            hide_quick_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── CLI 共用纯函数（不依赖 tauri::AppHandle） ───

/// 定位数据目录，优先级：环境变量 > 配置文件 > 默认值
pub fn cli_get_data_dir() -> PathBuf {
    // 1. 环境变量
    if let Ok(dir) = env::var("WORKERBEE_DATA_DIR") {
        return PathBuf::from(dir);
    }

    // 2. 配置文件
    let config_path = dirs::home_dir()
        .map(|p| p.join(".workerbee").join(".workerbee.config.json"))
        .unwrap_or_else(|| PathBuf::from(".workerbee/.workerbee.config.json"));
    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
            if !config.storage_path.is_empty() {
                return PathBuf::from(config.storage_path);
            }
        }
    }

    // 3. 默认值
    dirs::home_dir()
        .map(|p| p.join(".workerbee"))
        .unwrap_or_else(|| PathBuf::from(".workerbee"))
}

/// CLI inspect：返回数据目录结构
pub fn cli_inspect() -> serde_json::Value {
    let data_dir = cli_get_data_dir();
    serde_json::json!({
        "data_dir": data_dir.to_string_lossy(),
        "structure": {
            "templates/": "报告模板目录，存放提示词文件，AI 读后生成对应格式报告",
            "logs/": "日志片段目录，每文件一天，命名 YYYY-MM-DD.md",
            "reports/": "生成的报告目录，AI 生成报告后写入此处"
        }
    })
}

/// CLI add：追加日志条目到今日文件
pub fn cli_add_log(content: &str) -> Result<serde_json::Value, String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();

    let data_dir = cli_get_data_dir();
    let logs_dir = data_dir.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let file_path = logs_dir.join(format!("{}.md", date_str));

    let existing = if file_path.exists() {
        fs::read_to_string(&file_path).unwrap_or_default()
    } else {
        format!("---\ndate: {}\n---\n", date_str)
    };

    let entry = format!("\n## {}\n\n{}\n", time_str, content.trim());
    let new_content = format!("{}{}", existing.trim_end(), entry);

    fs::write(&file_path, &new_content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "file": file_path.to_string_lossy(),
        "time": time_str
    }))
}
