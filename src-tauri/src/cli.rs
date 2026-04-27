use chrono::{Datelike, Days, Local, NaiveDate};
use std::env;
use std::fs;
use std::path::PathBuf;

use crate::config::AppConfig;

// ─── Data directory resolution ───

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

// ─── Inspect ───

/// CLI inspect：返回数据目录结构、格式说明、配置摘要。
/// 输出设计为 LLM 可直接理解的 JSON，agent 不需要额外文档即可操作。
pub fn cli_inspect() -> serde_json::Value {
    let data_dir = cli_get_data_dir();
    let data_dir_str = data_dir.to_string_lossy().to_string();

    // Read config if available
    let config_summary = {
        let config_path = AppConfig::config_path();
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                Some(serde_json::json!({
                    "ai_provider": config.ai.as_ref().map(|a| a.provider.as_str()).unwrap_or("未配置"),
                    "ai_model": config.ai.as_ref().map(|a| a.model.as_str()).unwrap_or("未配置"),
                    "report_preset": config.selected_report_preset.unwrap_or_else(|| "未选择".to_string()),
                }))
            } else {
                None
            }
        } else {
            None
        }
    };

    // Count available logs and reports
    let logs_dir = data_dir.join("logs");
    let reports_dir = data_dir.join("reports");
    let templates_dir = data_dir.join("templates");
    let _screenshots_dir = data_dir.join("screenshots");

    let log_count = count_files_with_ext(&logs_dir, ".md");
    let report_count = count_files_with_ext(&reports_dir, ".md");
    let template_count = count_files_with_ext(&templates_dir, ".md");

    // List available templates
    let template_list: Vec<serde_json::Value> = if templates_dir.exists() {
        fs::read_dir(&templates_dir)
            .ok()
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.ends_with(".md") {
                            let raw = fs::read_to_string(e.path()).ok()?;
                            let (tmpl_name, date_range, _) = crate::commands::templates::parse_template(&raw);
                            let stem = name.strip_suffix(".md").unwrap_or(&name).to_string();
                            Some(serde_json::json!({
                                "filename": stem,
                                "name": if tmpl_name.is_empty() { stem.clone() } else { tmpl_name },
                                "date_range": date_range,
                            }))
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    serde_json::json!({
        "data_dir": data_dir_str,
        "version": env!("CARGO_PKG_VERSION"),
        "structure": {
            "logs/": {
                "description": "每日工作日志",
                "naming": "YYYY-MM-DD.md",
                "format": "---\\ndate: YYYY-MM-DD\\n---\\n\\n## HH:mm\\n\\n日志内容",
                "count": log_count,
            },
            "reports/": {
                "description": "生成的报告（由 agent 或用户创建）",
                "naming": "YYYY-MM-DD-TYPE.md",
                "naming_types": {
                    "daily": "YYYY-MM-DD-日报.md",
                    "weekly": "YYYY-MM-DD-周报.md",
                    "monthly": "YYYY-MM-月报.md",
                    "quarterly": "YYYY-QN-季报.md",
                    "annual": "YYYY-年报.md",
                    "custom": "YYYY-MM-DD-自定义名.md",
                },
                "glob_examples": {
                    "all_daily": "*日报.md",
                    "all_weekly": "*周报.md",
                    "date_range": "2026-04-*",
                    "quarterly": "2026-Q*",
                },
                "count": report_count,
            },
            "templates/": {
                "description": "报告模板，定义格式要求和 prompt",
                "naming": "模板名.md",
                "format": "---\\nname: 显示名称\\ndateRange: today|week|month\\n---\\n\\nprompt 内容",
                "count": template_count,
                "templates": template_list,
            },
            "screenshots/": {
                "description": "截图文件（webp/png/jpeg）",
                "naming": "YYYY-MM-DD_HH-mm-ss.webp|.png|.jpeg",
            },
            ".workerbee.config.json": "应用配置文件",
        },
        "config": config_summary,
        "workflow": {
            "1_list_templates": "workerbee templates list",
            "2_read_template": "workerbee templates show <模板名>",
            "3_read_logs": "workerbee logs read-range --from YYYY-MM-DD --to YYYY-MM-DD",
            "4_generate_report": "按模板要求生成 Markdown 报告",
            "5_write_report": "直接写入 {}/reports/YYYY-MM-DD-TYPE.md".replace("{}", &data_dir_str),
        },
    })
}

// ─── Logs ───

/// 列出日志日期，可按范围过滤
pub fn cli_list_logs(from: Option<&str>, to: Option<&str>) -> Result<serde_json::Value, String> {
    let data_dir = cli_get_data_dir();
    let logs_dir = data_dir.join("logs");

    if !logs_dir.exists() {
        return Ok(serde_json::json!({
            "data_dir": data_dir.to_string_lossy(),
            "dates": Vec::<String>::new(),
        }));
    }

    let from_date = from.map(parse_date).transpose()?;
    let to_date = to.map(parse_date).transpose()?;

    let mut dates: Vec<String> = fs::read_dir(&logs_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                return None;
            }
            let date_str = name.strip_suffix(".md").unwrap_or(&name).to_string();

            // Filter by date range
            if let Some(ref from) = from_date {
                if let Ok(d) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                    if d < *from {
                        return None;
                    }
                }
            }
            if let Some(ref to) = to_date {
                if let Ok(d) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                    if d > *to {
                        return None;
                    }
                }
            }

            Some(date_str)
        })
        .collect();

    dates.sort();
    dates.reverse();

    Ok(serde_json::json!({
        "data_dir": data_dir.to_string_lossy(),
        "count": dates.len(),
        "dates": dates,
    }))
}

/// 读取单日日志
pub fn cli_read_log(date: &str) -> Result<serde_json::Value, String> {
    let _ = parse_date(date)?;

    let data_dir = cli_get_data_dir();
    let file_path = data_dir.join("logs").join(format!("{}.md", date));

    if !file_path.exists() {
        return Err(format!("日志 {} 不存在", date));
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "date": date,
        "file": file_path.to_string_lossy(),
        "content": content,
    }))
}

/// 读取日期范围内的日志（拼接输出）
pub fn cli_read_range(from: &str, to: &str) -> Result<serde_json::Value, String> {
    let from_date = parse_date(from)?;
    let to_date = parse_date(to)?;

    if from_date > to_date {
        return Err(format!("起始日期 {} 晚于结束日期 {}", from, to));
    }

    let data_dir = cli_get_data_dir();
    let logs_dir = data_dir.join("logs");

    let mut entries: Vec<(NaiveDate, String)> = Vec::new();
    let mut current = from_date;
    let mut iterations = 0;
    let max_days = (to_date - from_date).num_days() as usize + 1;

    while current <= to_date && iterations < max_days {
        iterations += 1;
        let date_str = current.format("%Y-%m-%d").to_string();
        let file_path = logs_dir.join(format!("{}.md", date_str));

        if file_path.exists() {
            if let Ok(content) = fs::read_to_string(&file_path) {
                entries.push((current, content));
            }
        }

        current = match current.checked_add_days(Days::new(1)) {
            Some(next) => next,
            None => break,
        };
    }

    let count = entries.len();
    let combined: String = entries
        .iter()
        .map(|(date, content)| {
            format!(
                "# ═══════════ {} ═══════════\n\n{}",
                date.format("%Y-%m-%d"),
                content.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(serde_json::json!({
        "from": from,
        "to": to,
        "files_found": count,
        "content": combined,
    }))
}

/// 追加日志条目到今日文件
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

// ─── Config ───

/// 读取配置摘要
pub fn cli_config_get() -> Result<serde_json::Value, String> {
    let config_path = AppConfig::config_path();
    let raw = fs::read_to_string(&config_path).map_err(|e| format!("配置文件读取失败: {}", e))?;
    let config: AppConfig =
        serde_json::from_str(&raw).map_err(|e| format!("配置解析失败: {}", e))?;

    Ok(serde_json::json!({
        "data_dir": config.storage_path,
        "theme": config.theme,
        "locale": config.locale,
        "ai": config.ai.map(|a| serde_json::json!({
            "provider": a.provider,
            "model": a.model,
            "api_base_url": a.api_base_url,
            "has_api_key": !a.api_key.is_empty(),
        })).unwrap_or(serde_json::json!(null)),
        "report_preset": config.selected_report_preset,
        "screenshot_format": config.screenshot_format,
    }))
}

// ─── Templates ───

/// 列出可用模板
pub fn cli_list_templates() -> Result<serde_json::Value, String> {
    let data_dir = cli_get_data_dir();
    let templates_dir = data_dir.join("templates");

    if !templates_dir.exists() {
        return Ok(serde_json::json!({
            "data_dir": data_dir.to_string_lossy(),
            "templates": Vec::<serde_json::Value>::new(),
        }));
    }

    let mut templates: Vec<serde_json::Value> = fs::read_dir(&templates_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") { return None; }
            let stem = name.strip_suffix(".md").unwrap_or(&name).to_string();
            Some(serde_json::json!({ "filename": stem }))
        })
        .collect();

    templates.sort_by(|a, b| {
        a.get("filename").and_then(|v| v.as_str()).unwrap_or("")
            .cmp(b.get("filename").and_then(|v| v.as_str()).unwrap_or(""))
    });

    Ok(serde_json::json!({
        "data_dir": data_dir.to_string_lossy(),
        "count": templates.len(),
        "templates": templates,
    }))
}

/// 读取模板内容（agent 生成报告前必须先读模板）
pub fn cli_show_template(name: &str) -> Result<serde_json::Value, String> {
    let data_dir = cli_get_data_dir();
    let file_path = data_dir.join("templates").join(format!("{}.md", name));

    if !file_path.exists() {
        return Err(format!("模板 '{}' 不存在。运行 workerbee templates list 查看可用模板。", name));
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let (tmpl_name, date_range, prompt) = crate::commands::templates::parse_template(&content);

    Ok(serde_json::json!({
        "filename": name,
        "name": if tmpl_name.is_empty() { name.to_string() } else { tmpl_name },
        "date_range": date_range,
        "content": content.trim(),
        "prompt": prompt,
    }))
}

// ─── Reports ───

/// 列出报告文件
pub fn cli_list_reports() -> Result<serde_json::Value, String> {
    let data_dir = cli_get_data_dir();
    let reports_dir = data_dir.join("reports");

    if !reports_dir.exists() {
        return Ok(serde_json::json!({
            "data_dir": data_dir.to_string_lossy(),
            "reports": Vec::<serde_json::Value>::new(),
        }));
    }

    let mut reports: Vec<serde_json::Value> = fs::read_dir(&reports_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let stem = name.strip_suffix(".md").unwrap_or(&name);
            Some(serde_json::json!({
                "filename": stem,
                "size_bytes": metadata.len(),
            }))
        })
        .collect();

    reports.sort_by(|a, b| {
        b.get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .cmp(a.get("filename").and_then(|v| v.as_str()).unwrap_or(""))
    });

    Ok(serde_json::json!({
        "data_dir": data_dir.to_string_lossy(),
        "count": reports.len(),
        "reports": reports,
    }))
}

// ─── Reports: Generate ───

/// 报告类型 → 模板名称映射
fn report_type_to_template(report_type: &str) -> Option<String> {
    match report_type {
        "daily" | "日报" => Some("日报".to_string()),
        "weekly" | "周报" => Some("周报".to_string()),
        "monthly" | "月报" => Some("月报".to_string()),
        "quarterly" | "季报" => Some("季报".to_string()),
        "annual" | "年报" => Some("年报".to_string()),
        _ => None,
    }
}

/// 报告类型 + 日期 → 输出文件名（不含 .md 后缀）
fn report_type_to_filename(report_type: &str, from: &str) -> Result<String, String> {
    let from_date = parse_date(from)?;
    match report_type {
        "daily" | "日报" => Ok(format!("{}-日报", from)),
        "weekly" | "周报" => Ok(format!("{}-周报", from)),
        "monthly" | "月报" => Ok(format!("{}-月报", from_date.format("%Y-%m"))),
        "quarterly" | "季报" => {
            let month = from_date.month();
            let q = (month - 1) / 3 + 1;
            Ok(format!("{}-Q{}-季报", from_date.format("%Y"), q))
        }
        "annual" | "年报" => Ok(format!("{}-年报", from_date.format("%Y"))),
        _ => Ok(format!("{}-{}", from, report_type)),
    }
}

/// 生成报告：检查模板 → 收集日志 → 返回生成所需全部信息。
///
/// - 有模板时 `status: "ready"`，附带模板内容 + 日志
/// - 无模板且未跳过时 `status: "template_required"`，附带创建建议
/// - `skip_template: true` 时跳过模板检查，直接收集日志
pub fn cli_generate_report(
    report_type: &str,
    from: &str,
    to: &str,
    skip_template: bool,
) -> Result<serde_json::Value, String> {
    let data_dir = cli_get_data_dir();

    // 1. 查找匹配模板
    let template_name = report_type_to_template(report_type);
    let template = if !skip_template {
        if let Some(ref tmpl_name) = template_name {
            let template_path = data_dir.join("templates").join(format!("{}.md", tmpl_name));
            if template_path.exists() {
                let content = fs::read_to_string(&template_path).map_err(|e| e.to_string())?;
                let (name, date_range, prompt) =
                    crate::commands::templates::parse_template(&content);
                Some(serde_json::json!({
                    "filename": tmpl_name,
                    "name": if name.is_empty() { tmpl_name.clone() } else { name },
                    "date_range": date_range,
                    "prompt": prompt,
                }))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // 2. 无模板 → 返回 template_required，引导创建
    if template.is_none() && !skip_template {
        let tmpl = template_name.unwrap_or_else(|| report_type.to_string());
        return Ok(serde_json::json!({
            "status": "template_required",
            "message": format!("未找到「{}」类型的报告模板。建议先创建模板以获得更好的生成效果。", tmpl),
            "suggestion": {
                "create_template": format!("workerbee templates create {} --date-range month --prompt \"模板内容\"", tmpl),
                "skip_template": format!("workerbee reports generate --type {} --from {} --to {} --skip-template", report_type, from, to),
                "list_templates": "workerbee templates list",
            },
            "template_name": tmpl,
        }));
    }

    // 3. 收集日志
    let logs = cli_read_range(from, to)?;
    let filename = report_type_to_filename(report_type, from)?;
    let output_path = data_dir
        .join("reports")
        .join(format!("{}.md", filename));

    Ok(serde_json::json!({
        "status": "ready",
        "report_type": report_type,
        "filename": filename,
        "output_path": output_path.to_string_lossy(),
        "template": template,
        "logs": logs,
    }))
}

// ─── Templates: Create ───

/// 创建报告模板
pub fn cli_create_template(
    name: &str,
    date_range: Option<&str>,
    prompt: &str,
) -> Result<serde_json::Value, String> {
    let data_dir = cli_get_data_dir();
    let templates_dir = data_dir.join("templates");
    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;

    let file_path = templates_dir.join(format!("{}.md", name));

    if file_path.exists() {
        return Err(format!(
            "模板 '{}' 已存在。请先删除旧模板或使用其他名称。",
            name
        ));
    }

    let mut content = String::from("---\n");
    content.push_str(&format!("name: {}\n", name));
    if let Some(dr) = date_range {
        content.push_str(&format!("dateRange: {}\n", dr));
    }
    content.push_str("---\n\n");
    content.push_str(prompt.trim());
    content.push('\n');

    fs::write(&file_path, &content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "file": file_path.to_string_lossy(),
        "name": name,
        "date_range": date_range,
    }))
}

// ─── Helpers ───

fn parse_date(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| {
        format!(
            "无效日期格式 '{}', 请使用 YYYY-MM-DD（如 2026-04-24）",
            s
        )
    })
}



fn count_files_with_ext(dir: &PathBuf, ext: &str) -> usize {
    if !dir.exists() {
        return 0;
    }
    fs::read_dir(dir)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .ends_with(ext)
                })
                .count()
        })
        .unwrap_or(0)
}
