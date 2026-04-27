use chrono::Local;
use std::env;
use std::fs;
use std::path::PathBuf;

use crate::config::AppConfig;

/// 定位数据目录，优先级：环境变量 > 配置文件 > 默认值
pub fn cli_get_data_dir() -> PathBuf {
    // 1. 环境变量
    if let Ok(dir) = env::var("WORKERBEE_DATA_DIR") {
        return PathBuf::from(dir);
    }

    // 2. 配置文件
    let config_path = AppConfig::config_path();
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
