use std::fs;
use std::path::PathBuf;
use crate::config::AppConfig;

#[tauri::command]
pub fn save_log(
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
pub fn read_log(app: tauri::AppHandle, date: String) -> Result<String, String> {
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
pub fn write_log(app: tauri::AppHandle, date: String, content: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let logs_dir = PathBuf::from(&config.storage_path).join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let file_path = logs_dir.join(format!("{}.md", date));

    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_logs(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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
