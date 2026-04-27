use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Local;
use chrono::Timelike;
use image::{DynamicImage, RgbaImage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use crate::config::AppConfig;
use crate::state::{CaptureState, ScreenshotOverlayDataState, ScreenshotOverlayData};

/// Get cursor position in physical screen coordinates.
#[cfg(target_os = "windows")]
fn get_cursor_physical_pos() -> Result<(i32, i32), String> {
    #[repr(C)]
    struct POINT { x: i32, y: i32 }
    extern "system" {
        fn GetCursorPos(lpPoint: *mut POINT) -> i32;
    }
    let mut point = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut point) == 0 {
            return Err("GetCursorPos failed".to_string());
        }
    }
    Ok((point.x, point.y))
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_physical_pos() -> Result<(i32, i32), String> {
    Ok((0, 0))
}

/// Write an RGBA image as a 24-bit BMP file — ~7ms for 1920×1080.
/// Bypasses the `image` crate's slow encoder (which takes 431ms for the same task).
fn write_bmp_fast(path: &std::path::Path, img: &RgbaImage) -> Result<(), String> {
    let w = img.width() as usize;
    let h = img.height() as usize;
    let src_stride = w * 4; // RGBA
    let dst_stride = (w * 3 + 3) & !3; // BGR rows padded to 4-byte boundary
    let pixel_size = dst_stride * h;
    let file_size = 54 + pixel_size;

    let mut buf = vec![0u8; file_size];
    let raw = img.as_raw();

    // ── BMP file header (14 bytes) ──
    buf[0..2].copy_from_slice(b"BM");
    buf[2..6].copy_from_slice(&(file_size as u32).to_le_bytes());
    // bytes 6..10 reserved (zero)
    buf[10..14].copy_from_slice(&54u32.to_le_bytes());

    // ── DIB header BITMAPINFOHEADER (40 bytes) ──
    buf[14..18].copy_from_slice(&40u32.to_le_bytes());
    buf[18..22].copy_from_slice(&(w as i32).to_le_bytes());
    buf[22..26].copy_from_slice(&(h as i32).to_le_bytes()); // positive = bottom-up
    buf[26] = 1; buf[27] = 0; // color planes = 1
    buf[28] = 24; buf[29] = 0; // bits per pixel = 24
    // bytes 30..54 rest zero (no compression, default DPI, etc.)

    // ── Pixel data: bottom-up rows, BGR order ──
    let pad = dst_stride - w * 3;
    let mut pos = 54;
    for y in (0..h).rev() {
        let row = &raw[y * src_stride..(y + 1) * src_stride];
        for px in row.chunks_exact(4) {
            buf[pos]     = px[2]; // B
            buf[pos + 1] = px[1]; // G
            buf[pos + 2] = px[0]; // R
            pos += 3;
        }
        pos += pad; // row padding (zero-filled by vec init)
    }

    std::fs::write(path, &buf).map_err(|e| format!("BMP write failed: {} (path: {:?})", e, path))
}

/// Clean up temporary BMP files used for overlay display.
/// Removes all files matching `workerbee_capture*.bmp` in the temp directory,
/// handling both the current session and any leftover files from crashes.
pub fn cleanup_temp_bmp() {
    let temp_dir = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("workerbee_capture") && name_str.ends_with(".bmp") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Pre-create the screenshot overlay window (hidden) at app startup.
/// This eliminates the 300-500ms WebView2 creation + JS loading delay.
pub fn precreate_screenshot_overlay(app: &tauri::AppHandle) {
    if app.get_webview_window("screenshot-overlay").is_some() {
        return; // Already exists
    }
    let overlay_url: tauri::WebviewUrl = if cfg!(debug_assertions) {
        tauri::WebviewUrl::External(
            "http://localhost:1420/screenshot-overlay.html".parse().unwrap(),
        )
    } else {
        tauri::WebviewUrl::App("screenshot-overlay.html".into())
    };
    let result = tauri::WebviewWindowBuilder::new(app, "screenshot-overlay", overlay_url)
        .inner_size(1.0, 1.0)
        .visible(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .transparent(true)
        .build();
    match result {
        Ok(_) => eprintln!("[screenshot] Overlay window pre-created"),
        Err(e) => eprintln!("[screenshot] Failed to pre-create overlay: {}", e),
    }
}

pub fn show_screenshot_overlay(app: &tauri::AppHandle) -> Result<(), String> {
    eprintln!("[screenshot] Starting capture...");
    let t0 = std::time::Instant::now();

    // Clean up old temp file from previous screenshot (e.g., app crashed)
    cleanup_temp_bmp();

    // 1. Detect which monitor the cursor is on (fast, ~1ms)
    let monitors = xcap::Monitor::all().map_err(|e| format!("Monitor list failed: {}", e))?;
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let (cursor_x, cursor_y) = get_cursor_physical_pos()?;

    let target_idx = monitors.iter().position(|m| {
        let mx = m.x().unwrap_or(0);
        let my = m.y().unwrap_or(0);
        let mw = m.width().unwrap_or(0) as i32;
        let mh = m.height().unwrap_or(0) as i32;
        cursor_x >= mx && cursor_x < mx + mw && cursor_y >= my && cursor_y < my + mh
    }).unwrap_or(0);

    let mon_x = monitors[target_idx].x().map_err(|e| format!("Monitor X failed: {}", e))?;
    let mon_y = monitors[target_idx].y().map_err(|e| format!("Monitor Y failed: {}", e))?;
    let width = monitors[target_idx].width().map_err(|e| format!("Width failed: {}", e))?;
    let height = monitors[target_idx].height().map_err(|e| format!("Height failed: {}", e))?;
    eprintln!("[screenshot] Monitor: {}x{} at ({},{}) [{:.1}ms]", width, height, mon_x, mon_y, t0.elapsed().as_secs_f64() * 1000.0);

    // 2. Reset frontend state (clear old screenshot)
    let _ = app.emit("screenshot-reset", ());

    // 3. Capture in background — overlay stays hidden so xcap captures the real desktop.
    //    xcap::Monitor is !Send (contains HMANAGER), so re-fetch in the thread.
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let monitors = xcap::Monitor::all()
                .map_err(|e| format!("Monitor list failed: {}", e))?;
            if monitors.is_empty() {
                return Err("No monitors found".to_string());
            }
            let idx = if target_idx < monitors.len() { target_idx } else { 0 };
            let image = monitors[idx].capture_image()
                .map_err(|e| format!("Capture failed: {}", e))?;
            eprintln!("[screenshot] xcap captured {}x{} [{:.1}ms]", image.width(), image.height(), t0.elapsed().as_secs_f64() * 1000.0);

            // Store raw image for later cropping (with monitor offsets for coordinate validation)
            let capture_state = app_clone.state::<CaptureState>();
            *capture_state.0.lock().unwrap() = Some(crate::state::CapturedScreen {
                image,
                width,
                height,
                monitor_offset_x: mon_x,
                monitor_offset_y: mon_y,
            });

            // Save as BMP for overlay display (unique timestamp to avoid collision)
            let temp_dir = std::env::temp_dir();
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let temp_path = temp_dir.join(format!("workerbee_capture_{}.bmp", timestamp));
            {
                let guard = capture_state.0.lock().unwrap();
                let captured = guard.as_ref().unwrap();
                write_bmp_fast(&temp_path, &captured.image)?;
            }
            eprintln!("[screenshot] BMP saved [{:.1}ms]", t0.elapsed().as_secs_f64() * 1000.0);

            // Store overlay data
            let overlay_data_state = app_clone.state::<ScreenshotOverlayDataState>();
            *overlay_data_state.0.lock().unwrap() = Some(ScreenshotOverlayData {
                image_path: temp_path.to_string_lossy().to_string(),
                monitor_x: mon_x,
                monitor_y: mon_y,
                monitor_width: width,
                monitor_height: height,
            });

            Ok(())
        })();

        match result {
            Ok(()) => {
                // Emit data BEFORE showing overlay so React renders image while window is hidden
                let _ = app_clone.emit("screenshot-data-ready", ());

                // Give WebView a tick to process the event and render
                std::thread::sleep(std::time::Duration::from_millis(30));

                // Show — React already has the image rendered, same transparency as before show
                if let Some(overlay) = app_clone.get_webview_window("screenshot-overlay") {
                    let _ = overlay.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(mon_x, mon_y)
                    ));
                    let _ = overlay.set_size(tauri::Size::Physical(
                        tauri::PhysicalSize::new(width, height)
                    ));
                    let _ = overlay.show();
                    let _ = overlay.set_focus();
                }
                eprintln!("[screenshot] Overlay shown [{:.1}ms total]", t0.elapsed().as_secs_f64() * 1000.0);
            }
            Err(e) => {
                eprintln!("[screenshot] Capture failed: {}", e);
                cleanup_temp_bmp();
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn crop_and_save_screenshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, CaptureState>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Coordinate system: The overlay window is positioned at (mon_x, mon_y) on the physical screen
    // and sized exactly (monitor_width, monitor_height). Frontend clientX/Y are relative to the
    // overlay window's top-left corner, which equals coordinates relative to the captured monitor.
    // If frontend sends virtual-screen coordinates by mistake, subtract monitor offsets to correct.

    // Get captured screen
    let captured = state.0.lock().unwrap().clone()
        .ok_or("No captured screen found. Please use the screenshot overlay first.")?;
    
    // Adjust coordinates: if x/y look like virtual-screen coords (larger than monitor), subtract offset
    let image_width = captured.image.width();
    let image_height = captured.image.height();
    
    let x = if x as i32 >= captured.monitor_offset_x && (x as i32 - captured.monitor_offset_x) >= 0 {
        // x might be virtual-screen coordinate — check if subtracting offset makes it fit
        let adjusted = (x as i32 - captured.monitor_offset_x) as u32;
        if adjusted < image_width { adjusted } else { x }
    } else {
        x
    };
    let y = if y as i32 >= captured.monitor_offset_y && (y as i32 - captured.monitor_offset_y) >= 0 {
        let adjusted = (y as i32 - captured.monitor_offset_y) as u32;
        if adjusted < image_height { adjusted } else { y }
    } else {
        y
    };
    
    // Validate coordinates
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
    
    // Determine format from config
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let format_str = config.screenshot_format.to_lowercase();
    let (format, extension) = match format_str.as_str() {
        "png" => (image::ImageFormat::Png, "png"),
        "jpeg" | "jpg" => (image::ImageFormat::Jpeg, "jpeg"),
        _ => (image::ImageFormat::WebP, "webp"), // default to webp
    };
    
    // Encode in chosen format
    let mut buffer = Vec::new();
    DynamicImage::ImageRgba8(cropped_image)
        .write_to(&mut std::io::Cursor::new(&mut buffer), format)
        .map_err(|e| e.to_string())?;
    
    // Generate filename: YYYY-MM-DD_HH-mm-ss.ext
    let now = Local::now();
    let filename = format!(
        "{}_{:02}-{:02}-{:02}.{}",
        now.format("%Y-%m-%d"),
        now.hour(),
        now.minute(),
        now.second(),
        extension
    );
    
    // Save to screenshots directory
    let screenshots_path = PathBuf::from(&config.storage_path).join("screenshots");
    fs::create_dir_all(&screenshots_path).map_err(|e| e.to_string())?;
    
    let file_path = screenshots_path.join(&filename);
    fs::write(&file_path, buffer).map_err(|e| e.to_string())?;
    
    // Return relative path for markdown reference
    let relative_path = format!("../screenshots/{}", filename);
    
    Ok(relative_path)
}

#[tauri::command]
pub fn save_screenshot_log_entry(
    app: tauri::AppHandle,
    image_path: String,
    description: Option<String>,
) -> Result<(), String> {
    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M").to_string();
    
    let content = match description {
        Some(desc) if !desc.trim().is_empty() => {
            format!("{}\n\n![Screenshot]({})", desc.trim(), image_path)
        }
        _ => format!("![Screenshot]({})", image_path),
    };
    crate::commands::logs::save_log(app, date, time, content)
}

#[tauri::command]
pub fn close_screenshot_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Notify frontend to reset state (prevents flash of old content on next show)
    let _ = app.emit("screenshot-reset", ());
    cleanup_temp_bmp();

    // Hide instead of close — keep the pre-created window alive for next use
    if let Some(window) = app.get_webview_window("screenshot-overlay") {
        let _ = window.hide();
    }
    
    // Emit event to refresh main window
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("focusChanged", true);
    }
    
    Ok(())
}

#[tauri::command]
pub fn get_screenshot_overlay_data(
    app: tauri::AppHandle,
) -> Result<ScreenshotOverlayData, String> {
    let state = app.state::<ScreenshotOverlayDataState>();
    let data = state.0.lock().unwrap().clone();
    data.ok_or("No screenshot data available".to_string())
}

#[tauri::command]
pub fn cancel_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    // Clear capture state
    let capture_state = app.try_state::<CaptureState>();
    if let Some(state) = capture_state {
        *state.0.lock().unwrap() = None;
    }
    
    // Clear overlay data
    let overlay_data_state = app.try_state::<ScreenshotOverlayDataState>();
    if let Some(state) = overlay_data_state {
        *state.0.lock().unwrap() = None;
    }
    
    // Notify frontend to reset state
    let _ = app.emit("screenshot-reset", ());
    cleanup_temp_bmp();

    // Hide overlay (keep alive for next use)
    if let Some(window) = app.get_webview_window("screenshot-overlay") {
        let _ = window.hide();
    }
    
    Ok(())
}

#[tauri::command]
pub fn read_screenshot_as_base64(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
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

// ─── Screenshot History ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenshotInfo {
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: Option<String>,
}

#[tauri::command]
pub fn list_screenshots(app: tauri::AppHandle) -> Result<Vec<ScreenshotInfo>, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let screenshots_dir = PathBuf::from(&config.storage_path).join("screenshots");

    if !screenshots_dir.exists() {
        return Ok(Vec::new());
    }

    let mut screenshots: Vec<ScreenshotInfo> = fs::read_dir(&screenshots_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            // Only include image files
            if !name.ends_with(".webp") && !name.ends_with(".png") && !name.ends_with(".jpeg") && !name.ends_with(".jpg") {
                return None;
            }
            // Try to parse created_at from filename pattern: YYYY-MM-DD_HH-mm-ss.ext
            let created_at = if name.len() >= 21 {
                // Try parsing "2026-04-22_14-30-00.webp" → "2026-04-22 14:30:00"
                let stem = name.split('.').next().unwrap_or(&name);
                if let Some(date_part) = stem.get(0..10) {
                    if let Some(time_part) = stem.get(11..19) {
                        let time_str = time_part.replace("-", ":");
                        Some(format!("{} {}", date_part, time_str))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };
            Some(ScreenshotInfo {
                filename: name,
                size_bytes: metadata.len(),
                created_at,
            })
        })
        .collect();

    // Sort by modification time descending (most recent first)
    screenshots.sort_by(|a, b| {
        // Use created_at for sorting if available, otherwise filename
        b.created_at.cmp(&a.created_at)
    });
    Ok(screenshots)
}

#[tauri::command]
pub fn delete_screenshot(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;
    let file_path = PathBuf::from(&config.storage_path)
        .join("screenshots")
        .join(&filename);

    // Security: ensure the filename doesn't escape the screenshots directory
    let screenshots_dir = PathBuf::from(&config.storage_path).join("screenshots");
    if !file_path.starts_with(&screenshots_dir) {
        return Err("Invalid filename: path traversal detected".to_string());
    }

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())
    } else {
        Err(format!("截图文件 {} 不存在", filename))
    }
}

/// Save a pasted image (base64-encoded) from clipboard to the screenshots directory.
/// Returns the relative path for markdown reference, e.g. "../screenshots/xxx.webp".
#[tauri::command]
pub fn save_pasted_image(
    app: tauri::AppHandle,
    base64_data: String,
    format: String,
) -> Result<String, String> {
    let config = AppConfig::load(&app).ok_or("请先选择存储文件夹")?;

    // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
    let raw_base64 = if let Some(idx) = base64_data.find(",") {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let image_bytes = STANDARD.decode(raw_base64).map_err(|e| format!("Invalid base64: {}", e))?;

    // Determine format and extension
    let (ext, _image_format) = match format.to_lowercase().as_str() {
        "png" => ("png", image::ImageFormat::Png),
        "jpeg" | "jpg" => ("jpeg", image::ImageFormat::Jpeg),
        _ => ("webp", image::ImageFormat::WebP),
    };

    // Generate filename: paste_YYYY-MM-DD_HH-mm-ss.ext
    let now = Local::now();
    let filename = format!(
        "paste_{}_{}-{}-{}.{}",
        now.format("%Y-%m-%d"),
        now.hour(),
        now.minute(),
        now.second(),
        ext
    );

    let screenshots_dir = PathBuf::from(&config.storage_path).join("screenshots");
    fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    let file_path = screenshots_dir.join(&filename);
    fs::write(&file_path, image_bytes).map_err(|e| e.to_string())?;

    let relative_path = format!("../screenshots/{}", filename);
    Ok(relative_path)
}
