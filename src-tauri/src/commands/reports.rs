use std::fs;
use std::path::PathBuf;
use crate::config::AppConfig;

#[tauri::command]
pub fn list_reports(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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
pub fn read_report(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("reports")
        .join(format!("{}.md", filename));
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_report(app: tauri::AppHandle, filename: String, content: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let reports_dir = PathBuf::from(&config.storage_path).join("reports");
    fs::create_dir_all(&reports_dir).map_err(|e| e.to_string())?;
    let file_path = reports_dir.join(format!("{}.md", filename));
    fs::write(&file_path, content).map_err(|e| e.to_string())
}
