use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::config::AppConfig;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateInfo {
    pub filename: String,
    pub name: String,
    pub date_range: Option<String>,
    pub prompt: String,
}

pub fn parse_template(raw: &str) -> (String, Option<String>, String) {
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

pub fn format_template_file(name: &str, date_range: Option<&str>, prompt: &str) -> String {
    let mut content = String::from("---\n");
    content.push_str(&format!("name: {}\n", name));
    if let Some(dr) = date_range {
        content.push_str(&format!("dateRange: {}\n", dr));
    }
    content.push_str("---\n\n");
    content.push_str(prompt);
    content
}

pub const DEFAULT_TEMPLATES: &[(&str, &str, Option<&str>, &str)] = &[
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

#[tauri::command]
pub fn list_templates(app: tauri::AppHandle) -> Result<Vec<TemplateInfo>, String> {
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
pub fn read_template(app: tauri::AppHandle, filename: String) -> Result<TemplateInfo, String> {
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
pub fn write_template(
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
pub fn delete_template(app: tauri::AppHandle, filename: String) -> Result<(), String> {
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
