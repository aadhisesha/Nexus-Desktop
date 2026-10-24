use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct BackendState {
    pub port: Arc<Mutex<Option<u16>>>,
    pub child: Arc<Mutex<Option<CommandChild>>>,
}

#[tauri::command]
fn get_backend_port(state: tauri::State<'_, BackendState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new(&path));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_state = BackendState::default();
    let port_state = backend_state.port.clone();
    let child_state = backend_state.child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![get_backend_port, open_file, reveal_in_folder])
        .setup(move |app| {
            let handle = app.handle().clone();

            match app.shell().sidecar("nexus-backend") {
                Ok(sidecar_command) => match sidecar_command.spawn() {
                    Ok((mut rx, child)) => {
                        if let Ok(mut child_guard) = child_state.lock() {
                            *child_guard = Some(child);
                        }

                        let port_state_clone = port_state.clone();
                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line_bytes) => {
                                        let line = String::from_utf8_lossy(&line_bytes);
                                        for subline in line.lines() {
                                            if let Some(port_str) = subline.strip_prefix("NEXUS_BACKEND_PORT=") {
                                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                                    if let Ok(mut port_guard) = port_state_clone.lock() {
                                                        *port_guard = Some(port);
                                                    }
                                                    println!("[Rust] Backend listening on port: {}", port);
                                                    let _ = handle.emit("backend-ready", port);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    CommandEvent::Terminated(status) => {
                                        eprintln!("[Rust] Backend sidecar terminated: {:?}", status);
                                    }
                                    CommandEvent::Error(err) => {
                                        eprintln!("[Rust] Backend sidecar error: {}", err);
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(err) => {
                        eprintln!("[Rust] Failed to spawn `nexus-backend` sidecar: {}", err);
                    }
                },
                Err(err) => {
                    eprintln!("[Rust] Failed to create `nexus-backend` sidecar command: {}", err);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                let state = window.state::<BackendState>();
                if let Ok(mut child_guard) = state.child.lock() {
                    if let Some(child) = child_guard.take() {
                        println!("[Rust] Killing backend sidecar child process...");
                        let _ = child.kill();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
