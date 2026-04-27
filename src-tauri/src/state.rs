use std::sync::Mutex;
use image::RgbaImage;

// Shared state for the current shortcut
pub struct ShortcutState(pub Mutex<String>);

// Shared state for the current screenshot shortcut
pub struct ScreenshotShortcutState(pub Mutex<String>);

// Captured screen data
#[derive(Debug, Clone)]
pub struct CapturedScreen {
    pub image: RgbaImage,
    #[allow(dead_code)]
    pub width: u32,
    #[allow(dead_code)]
    pub height: u32,
    pub monitor_offset_x: i32,
    pub monitor_offset_y: i32,
}

// Shared state for captured screen
pub struct CaptureState(pub Mutex<Option<CapturedScreen>>);

// Data for the screenshot overlay
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ScreenshotOverlayData {
    pub image_path: String,
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_width: u32,
    pub monitor_height: u32,
}

pub struct ScreenshotOverlayDataState(pub Mutex<Option<ScreenshotOverlayData>>);

// OpenCode server state
pub struct OpenCodeServer {
    pub port: u16,
    pub child: std::process::Child,
}

impl Drop for OpenCodeServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct OpenCodeServerState(pub Mutex<Option<OpenCodeServer>>);
