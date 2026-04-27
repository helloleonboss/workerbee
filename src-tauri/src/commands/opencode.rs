use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::State;

use crate::state::OpenCodeServerState;

const OPENCODE_PORT: u16 = 4096;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Build a `Command` that runs `opencode <args...>`.
/// On Windows, npm installs `opencode.cmd` which `Command::new("opencode")`
/// cannot find directly (CreateProcess doesn't resolve PATHEXT).
/// We route through `cmd /C` so the shell handles the resolution.
fn opencode_command() -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("opencode");
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("opencode")
    }
}

/// Check if `opencode` CLI is installed and on PATH.
#[tauri::command]
pub fn check_opencode_installed() -> bool {
    let mut cmd = opencode_command();
    cmd.arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// Check if the OpenCode server is reachable on the expected port.
fn is_server_running() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{OPENCODE_PORT}").parse().unwrap(),
        Duration::from_secs(2),
    )
    .is_ok()
}

/// Start `opencode serve` in the background, wait for it to become healthy.
fn start_opencode_server(
    state: &State<'_, OpenCodeServerState>,
    storage_path: &str,
) -> Result<(), String> {
    // Already running — nothing to do.
    if is_server_running() {
        return Ok(());
    }

    let mut cmd = opencode_command();
    cmd.args(["serve", "--port", &OPENCODE_PORT.to_string()])
        .current_dir(storage_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn opencode: {e}"))?;

    *state.0.lock().unwrap() = Some(crate::state::OpenCodeServer {
        port: OPENCODE_PORT,
        child,
    });

    // Poll until the server is ready (max 10 s).
    let start = Instant::now();
    let timeout = Duration::from_secs(10);
    loop {
        if is_server_running() {
            return Ok(());
        }
        if start.elapsed() >= timeout {
            return Err("OpenCode server failed to start within 10 seconds".into());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// Start opencode serve and return when ready.
/// The frontend opens the UI in an embedded iframe.
#[tauri::command]
pub fn start_opencode(
    state: State<'_, OpenCodeServerState>,
    storage_path: String,
) -> Result<(), String> {
    start_opencode_server(&state, &storage_path)
}

/// Check if the OpenCode server is currently reachable.
#[tauri::command]
pub fn is_opencode_running() -> bool {
    is_server_running()
}
