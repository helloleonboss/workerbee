use chrono::Local;
use chrono::Timelike;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::tray::TrayIconEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use xcap;
use image::{DynamicImage, RgbaImage};
use base64::{Engine, engine::general_purpose::STANDARD};

fn default_shortcut() -> String {
    "CommandOrControl+Shift+Space".to_string()
}

fn default_screenshot_shortcut() -> String {
    "CommandOrControl+Shift+S".to_string()
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

fn default_provider() -> String {
    "opencode-go".to_string()
}
fn default_api_base_url() -> String {
    "https://opencode.ai/zen/go/v1".to_string()
}

fn default_model() -> String {
    "glm-5.1".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiConfig {
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default = "default_api_base_url")]
    api_base_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default = "default_model")]
    model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    storage_path: String,
    #[serde(default = "default_shortcut")]
    shortcut: String,
    #[serde(default = "default_screenshot_shortcut")]
    screenshot_shortcut: String,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_show_hint_bar")]
    show_hint_bar: bool,
    #[serde(default = "default_locale")]
    locale: String,
    #[serde(default)]
    ai: Option<AiConfig>,
    #[serde(default)]
    report_presets: Option<serde_json::Value>,
    #[serde(default)]
    selected_report_preset: Option<String>,
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
            screenshot_shortcut: default_screenshot_shortcut(),
            theme: default_theme(),
            show_hint_bar: default_show_hint_bar(),
            locale: default_locale(),
            ai: None,
            report_presets: None,
            selected_report_preset: None,
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
    fs::create_dir_all(base.join("screenshots")).map_err(|e| e.to_string())?;
    Ok(())
}

// Shared state for the current shortcut
struct ShortcutState(pub Mutex<String>);

// Shared state for the current screenshot shortcut
struct ScreenshotShortcutState(pub Mutex<String>);

// Captured screen data
#[derive(Debug, Clone)]
struct CapturedScreen {
    image: RgbaImage,
    width: u32,
    height: u32,
}

// Shared state for captured screen
struct CaptureState(pub Mutex<Option<CapturedScreen>>);

// ─── Template (file-based) ───

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TemplateInfo {
    filename: String,
    name: String,
    date_range: Option<String>,
    prompt: String,
}

fn parse_template(raw: &str) -> (String, Option<String>, String) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return (
            String::new(),
            None,
            raw.to_string(),
        );
    }
    let after_first = &trimmed[3..];
    if let Some(end) = after_first.find("\n---") {
        let frontmatter = &after_first[..end];
        let body = after_first[end + 4..].trim_start_matches('\n').trim_start();
        let mut name = String::new();
        let mut date_range: Option<String> = None;
        for line in frontmatter.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("name:") {
                name = val.trim().to_string();
            } else if let Some(val) = line.strip_prefix("dateRange:") {
                date_range = Some(val.trim().to_string());
            }
        }
        (name, date_range, body.to_string())
    } else {
        (String::new(), None, raw.to_string())
    }
}

fn format_template_file(name: &str, date_range: Option<&str>, prompt: &str) -> String {
    let mut content = String::from("---\n");
    content.push_str(&format!("name: {}\n", name));
    if let Some(dr) = date_range {
        content.push_str(&format!("dateRange: {}\n", dr));
    }
    content.push_str("---\n\n");
    content.push_str(prompt);
    content
}

const DEFAULT_TEMPLATES: &[(&str, &str, Option<&str>, &str)] = &[
    ("daily", "日报", Some("today"),
     "按以下格式生成日报：\n1. 今日完成工作（列出具体事项和进度）\n2. 遇到的问题及解决方案\n3. 明日计划\n4. 需要协调的事项（如没有则省略）\n\n要求：简洁明了，每项工作一句话概括，重点突出成果和进度。"),
    ("weekly", "周报", Some("week"),
     "按以下格式生成周报：\n1. 本周工作总结（按项目或任务分类，列出关键成果和进度百分比）\n2. 遇到的问题及解决方案\n3. 下周工作计划\n4. 风险与需协调事项（如没有则省略）\n\n要求：突出重点成果，量化进度，问题部分写明解决方案或所需支持。"),
    ("monthly", "月报", Some("month"),
     "按以下格式生成月报：\n1. 本月工作概述（总体进展和关键里程碑）\n2. 各项目/任务详细进展（按项目分组，含完成情况、数据指标）\n3. 问题与挑战\n4. 下月工作计划与目标\n5. 需要的支持与资源\n\n要求：注重数据支撑和目标达成情况，体现工作价值。"),
    ("quarterly", "季报", Some("month"),
     "按以下格式生成季度报告：\n1. 季度工作概述（总体目标与实际达成对比）\n2. 重点项目进展（含关键指标、里程碑完成情况）\n3. 团队协作与个人成长\n4. 存在的问题与改进措施\n5. 下季度工作规划与目标\n\n要求：战略视角，突出目标完成度和业务价值，有数据支撑。"),
    ("annual", "年报", Some("month"),
     "按以下格式生成年报：\n1. 年度工作总结（年度目标回顾与整体表现）\n2. 核心成果与亮点（按项目/领域分类）\n3. 能力成长与经验总结\n4. 不足与反思\n5. 新年度工作规划\n\n要求：全面总结，体现年度贡献和成长轨迹，为绩效评估提供依据。"),
];

fn ensure_default_templates(storage_path: &str) {
    let templates_dir = PathBuf::from(storage_path).join("templates");
    if !templates_dir.exists() {
        let _ = fs::create_dir_all(&templates_dir);
    }
    // Only create defaults if directory is empty
    if let Ok(entries) = fs::read_dir(&templates_dir) {
        if entries.count() > 0 {
            return;
        }
    }
    for (filename, name, date_range, prompt) in DEFAULT_TEMPLATES {
        let content = format_template_file(name, *date_range, prompt);
        let path = templates_dir.join(format!("{}.md", filename));
        let _ = fs::write(path, content);
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

fn show_screenshot_overlay(app: &tauri::AppHandle) -> Result<(), String> {
    // First capture the screen
    let (image_base64, monitor_width, monitor_height) = capture_screens(app.clone(), app.state())?;
    
    // Get or create the overlay window
    let window = app.get_webview_window("screenshot-overlay");
    
    if window.is_none() {
        // Create overlay window if it doesn't exist
        let overlay_url: tauri::WebviewUrl = if cfg!(debug_assertions) {
            tauri::WebviewUrl::External(
                "http://localhost:1420/screenshot-overlay.html".parse().unwrap(),
            )
        } else {
            tauri::WebviewUrl::App("screenshot-overlay.html".into())
        };
        
        tauri::WebviewWindowBuilder::new(app, "screenshot-overlay", overlay_url)
            .inner_size(monitor_width as f64, monitor_height as f64)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .transparent(true)
            .build()
            .map_err(|e| e.to_string())?;
    }
    
    let overlay = app.get_webview_window("screenshot-overlay").unwrap();
    
    // Show the overlay
    overlay.show().map_err(|e| e.to_string())?;
    overlay.set_focus().map_err(|e| e.to_string())?;
    
    // Send screenshot data to the overlay
    let screenshot_data = serde_json::json!({
        "image_base64": image_base64,
        "monitor_width": monitor_width,
        "monitor_height": monitor_height
    });
    let _ = app.emit("screenshot-overlay-ready", screenshot_data);
    
    Ok(())
}

#[tauri::command]
fn write_log(app: tauri::AppHandle, date: String, content: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let logs_dir = PathBuf::from(&config.storage_path).join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let file_path = logs_dir.join(format!("{}.md", date));

    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_templates(app: tauri::AppHandle) -> Result<Vec<TemplateInfo>, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let templates_dir = PathBuf::from(&config.storage_path).join("templates");

    if !templates_dir.exists() {
        return Ok(Vec::new());
    }

    let mut templates: Vec<TemplateInfo> = fs::read_dir(&templates_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                return None;
            }
            let file_name = name.trim_end_matches(".md").to_string();
            let raw = fs::read_to_string(entry.path()).ok()?;
            let (tmpl_name, date_range, prompt) = parse_template(&raw);
            Some(TemplateInfo {
                filename: file_name.clone(),
                name: if tmpl_name.is_empty() { file_name } else { tmpl_name },
                date_range,
                prompt,
            })
        })
        .collect();

    // Sort by filename for consistent ordering
    templates.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(templates)
}

#[tauri::command]
fn read_template(app: tauri::AppHandle, filename: String) -> Result<TemplateInfo, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("templates")
        .join(format!("{}.md", filename));

    if !file_path.exists() {
        return Err(format!("模板 {} 不存在", filename));
    }

    let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let (tmpl_name, date_range, prompt) = parse_template(&raw);
    Ok(TemplateInfo {
        filename: filename.clone(),
        name: if tmpl_name.is_empty() { filename } else { tmpl_name },
        date_range,
        prompt,
    })
}

#[tauri::command]
fn write_template(
    app: tauri::AppHandle,
    filename: String,
    name: String,
    date_range: Option<String>,
    prompt: String,
) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let templates_dir = PathBuf::from(&config.storage_path).join("templates");
    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;

    let content = format_template_file(
        &name,
        date_range.as_deref(),
        &prompt,
    );
    let file_path = templates_dir.join(format!("{}.md", filename));
    fs::write(&file_path, content).map_err(|e| e.to_string())
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
        Err(format!("模板 {} 不存在", filename))
    }
}

#[tauri::command]
fn capture_screens(
    app: tauri::AppHandle,
    state: tauri::State<CaptureState>,
) -> Result<(String, u32, u32), String> {
    // Get primary monitor (index 0)
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }
    
    let primary_monitor = &monitors[0];
    let width = primary_monitor.width().map_err(|e| e.to_string())?;
    let height = primary_monitor.height().map_err(|e| e.to_string())?;
    
    // Capture the primary monitor
    let image = primary_monitor.capture_image().map_err(|e| e.to_string())?;
    
    // Store in CaptureState
    *state.0.lock().unwrap() = Some(CapturedScreen {
        image: image.clone(),
        width,
        height,
    });
    
    // Convert to PNG base64
    let mut buffer = Vec::new();
    image.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let base64_string = STANDARD.encode(&buffer);
    let data_url = format!("data:image/png;base64,{}", base64_string);
    
    Ok((data_url, width, height))
}

#[tauri::command]
fn crop_and_save_screenshot(
    app: tauri::AppHandle,
    state: tauri::State<CaptureState>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Get captured screen
    let captured = state.0.lock().unwrap().take()
        .ok_or("No captured screen found. Please call capture_screens first.")?;
    
    // Validate coordinates
    let image_width = captured.image.width();
    let image_height = captured.image.height();
    
    if x >= image_width || y >= image_height {
        return Err("Selection coordinates are out of bounds".to_string());
    }
    
    // Clamp coordinates to image bounds
    let x = x.min(image_width - 1);
    let y = y.min(image_height - 1);
    let width = width.min(image_width - x);
    let height = height.min(image_height - y);
    
    // Minimum selection size check (10x10 pixels)
    if width < 10 || height < 10 {
        return Err("Selection is too small (minimum 10x10 pixels)".to_string());
    }
    
    // Crop the image
    let cropped_image = image::imageops::crop_imm(
        &captured.image,
        x, y, width, height
    ).to_image();
    
    // Encode as WebP
    let mut buffer = Vec::new();
    let encoder = image::codecs::webp::WebPEncoder::new_lossless(buffer.as_mut_slice());
    DynamicImage::ImageRgba8(cropped_image)
        .write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::WebP)
        .map_err(|e| e.to_string())?;
    
    // Generate filename: YYYY-MM-DD_HH-mm-ss.webp
    let now = Local::now();
    let filename = format!(
        "{}_{:02}-{:02}-{:02}.webp",
        now.format("%Y-%m-%d"),
        now.hour(),
        now.minute(),
        now.second()
    );
    
    // Save to screenshots directory
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let screenshots_path = PathBuf::from(&config.storage_path).join("screenshots");
    fs::create_dir_all(&screenshots_path).map_err(|e| e.to_string())?;
    
    let file_path = screenshots_path.join(&filename);
    fs::write(&file_path, buffer).map_err(|e| e.to_string())?;
    
    // Return relative path for markdown reference
    let relative_path = format!("../screenshots/{}", filename);
    
    Ok(relative_path)
}

#[tauri::command]
fn save_screenshot_log_entry(
    app: tauri::AppHandle,
    image_path: String,
) -> Result<(), String> {
    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M").to_string();
    
    let content = format!("![Screenshot]({})", image_path);
    save_log(app, date, time, content)
}

#[tauri::command]
fn close_screenshot_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screenshot-overlay") {
        window.close().map_err(|e| e.to_string())?;
    }
    
    // Emit event to refresh main window
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("focusChanged", true);
    }
    
    Ok(())
}

#[tauri::command]
fn cancel_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    // Clear capture state
    let capture_state = app.try_state::<CaptureState>();
    if let Some(state) = capture_state {
        *state.0.lock().unwrap() = None;
    }
    
    // Close overlay
    if let Some(window) = app.get_webview_window("screenshot-overlay") {
        window.close().map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn read_screenshot_as_base64(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    
    // Convert relative path like "../screenshots/xxx.webp" to absolute path
    let absolute_path = if relative_path.starts_with("../") {
        // Go up one directory from logs/ to storage_path/
        PathBuf::from(&config.storage_path).join(&relative_path[3..])
    } else if relative_path.starts_with("screenshots/") {
        PathBuf::from(&config.storage_path).join(&relative_path)
    } else {
        PathBuf::from(&relative_path)
    };
    
    // Read the image file
    let image_data = fs::read(&absolute_path).map_err(|e| e.to_string())?;
    
    // Encode as base64
    let base64_string = STANDARD.encode(&image_data);
    
    // Determine image format from file extension
    let format = if absolute_path.extension().and_then(|s| s.to_str()) == Some("webp") {
        "webp"
    } else if absolute_path.extension().and_then(|s| s.to_str()) == Some("png") {
        "png"
    } else {
        "jpeg" // Default fallback
    };
    
    Ok(format!("data:image/{};base64,{}", format, base64_string))
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
                .with_handler(move |app, _shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    toggle_quick_input_window(app);
                })
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    let _ = show_screenshot_overlay(app);
                })
                .build(),
        )
        .manage(ShortcutState(Mutex::new(default_shortcut())))
        .manage(ScreenshotShortcutState(Mutex::new(default_screenshot_shortcut())))
        .manage(CaptureState(Mutex::new(None)))
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

            // Register screenshot shortcut
            {
                let app_handle = app.handle().clone();
                let config = AppConfig::load_or_default(&app_handle);
                let screenshot_shortcut_str = config.screenshot_shortcut.clone();
                *app.state::<ScreenshotShortcutState>().0.lock().unwrap() = screenshot_shortcut_str.clone();

                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Ok(screenshot_shortcut) = screenshot_shortcut_str.parse::<tauri_plugin_global_shortcut::Shortcut>()
                {
                    match app_handle.global_shortcut().register(screenshot_shortcut) {
                        Ok(_) => eprintln!("[screenshot] Registered: {}", screenshot_shortcut_str),
                        Err(e) => eprintln!("[screenshot] Failed: {} - {}", screenshot_shortcut_str, e),
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
            choose_folder,
            show_quick_input_cmd,
            hide_quick_input,
            list_templates,
            read_template,
            write_template,
            delete_template,
            capture_screens,
            crop_and_save_screenshot,
            save_screenshot_log_entry,
            close_screenshot_overlay,
            cancel_screenshot,
            read_screenshot_as_base64,
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
