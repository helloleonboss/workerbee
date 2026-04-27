use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub fn default_shortcut() -> String {
    "CommandOrControl+Shift+Space".to_string()
}

pub fn default_screenshot_shortcut() -> String {
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

fn default_screenshot_format() -> String {
    "webp".to_string()
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
pub struct AiConfig {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_api_base_url")]
    pub api_base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub storage_path: String,
    #[serde(default = "default_shortcut")]
    pub shortcut: String,
    #[serde(default = "default_screenshot_shortcut")]
    pub screenshot_shortcut: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_show_hint_bar")]
    pub show_hint_bar: bool,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub ai: Option<AiConfig>,
    #[serde(default)]
    pub report_presets: Option<serde_json::Value>,
    #[serde(default)]
    pub selected_report_preset: Option<String>,
    #[serde(default = "default_screenshot_format")]
    pub screenshot_format: String,
}

impl AppConfig {
    pub fn config_path() -> PathBuf {
        dirs::home_dir()
            .map(|p| p.join(".workerbee").join(".workerbee.config.json"))
            .unwrap_or_else(|| PathBuf::from(".workerbee/.workerbee.config.json"))
    }

    pub fn load(_app: &tauri::AppHandle) -> Option<Self> {
        let path = Self::config_path();
        if path.exists() {
            let content = fs::read_to_string(&path).ok()?;
            serde_json::from_str(&content).ok()
        } else {
            None
        }
    }

    pub fn save(&self, _app: &tauri::AppHandle) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn load_or_default(app: &tauri::AppHandle) -> Self {
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
            screenshot_format: default_screenshot_format(),
        })
    }
}

pub fn default_storage_path() -> String {
    dirs::home_dir()
        .map(|p| p.join(".workerbee").to_string_lossy().to_string())
        .unwrap_or_else(|| ".workerbee".to_string())
}

pub fn ensure_dirs(storage_path: &str) -> Result<(), String> {
    let base = PathBuf::from(storage_path);
    fs::create_dir_all(base.join("logs")).map_err(|e| e.to_string())?;
    fs::create_dir_all(base.join("reports")).map_err(|e| e.to_string())?;
    fs::create_dir_all(base.join("templates")).map_err(|e| e.to_string())?;
    fs::create_dir_all(base.join("screenshots")).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_default_templates(storage_path: &str) {
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
    for (filename, name, date_range, prompt) in crate::commands::templates::DEFAULT_TEMPLATES {
        let content = crate::commands::templates::format_template_file(name, *date_range, prompt);
        let path = templates_dir.join(format!("{}.md", filename));
        let _ = fs::write(path, content);
    }
}
