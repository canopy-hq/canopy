use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    pub id: String,
    pub display_name: String,
    pub cli_path: String,
}

struct EditorDef {
    id: &'static str,
    display_name: &'static str,
    cli: &'static str,
    /// Absolute path to the CLI embedded inside the macOS `.app` bundle.
    /// Checked as a last resort when `which` and common bin dirs fail
    /// (e.g. release builds launched from Finder with a minimal PATH).
    app_cli_path: &'static str,
}

const KNOWN_EDITORS: &[EditorDef] = &[
    EditorDef {
        id: "vscode",
        display_name: "VS Code",
        cli: "code",
        app_cli_path: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    },
    EditorDef {
        id: "cursor",
        display_name: "Cursor",
        cli: "cursor",
        app_cli_path: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    },
    EditorDef {
        id: "zed",
        display_name: "Zed",
        cli: "zed",
        app_cli_path: "/Applications/Zed.app/Contents/MacOS/cli",
    },
    EditorDef {
        id: "windsurf",
        display_name: "Windsurf",
        cli: "windsurf",
        app_cli_path: "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
    },
    EditorDef {
        id: "sublime",
        display_name: "Sublime Text",
        cli: "subl",
        app_cli_path: "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
    },
    EditorDef {
        id: "webstorm",
        display_name: "WebStorm",
        cli: "webstorm",
        app_cli_path: "/Applications/WebStorm.app/Contents/MacOS/webstorm",
    },
    EditorDef {
        id: "idea",
        display_name: "IntelliJ IDEA",
        cli: "idea",
        app_cli_path: "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
    },
];

/// Common bin directories where editor CLI symlinks are typically installed.
/// Checked after `which` fails (covers release builds with minimal PATH).
const COMMON_BIN_DIRS: &[&str] = &["/usr/local/bin", "/opt/homebrew/bin"];

fn which_cli(name: &str) -> Option<String> {
    let output = Command::new("which").arg(name).output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn resolve_cli(cli: &str, app_cli_path: &str) -> Option<String> {
    // 1. Try `which` — works when launched from a terminal (dev mode)
    if let Some(path) = which_cli(cli) {
        return Some(path);
    }
    // 2. Check common bin dirs (auto-generated from CLI name)
    for dir in COMMON_BIN_DIRS {
        let path = format!("{dir}/{cli}");
        if Path::new(&path).exists() {
            return Some(path);
        }
    }
    // 3. Check the .app bundle path (unique per editor)
    if !app_cli_path.is_empty() && Path::new(app_cli_path).exists() {
        return Some(app_cli_path.to_string());
    }
    None
}

#[tauri::command]
pub async fn detect_editors() -> Result<Vec<DetectedEditor>, String> {
    tokio::task::spawn_blocking(|| {
        KNOWN_EDITORS
            .iter()
            .filter_map(|def| {
                resolve_cli(def.cli, def.app_cli_path).map(|cli_path| DetectedEditor {
                    id: def.id.to_string(),
                    display_name: def.display_name.to_string(),
                    cli_path,
                })
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_editor(editor_id: String, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let def = KNOWN_EDITORS
            .iter()
            .find(|d| d.id == editor_id)
            .ok_or_else(|| format!("Unknown editor: {editor_id}"))?;

        let cli_path = resolve_cli(def.cli, def.app_cli_path)
            .ok_or_else(|| format!("{} CLI not found", def.display_name))?;

        Command::new(&cli_path)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to launch {}: {e}", def.display_name))?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// `resolve_cli` finds CLI via `.app` bundle fallback when `which` fails.
    #[test]
    fn resolve_cli_finds_app_bundle_fallback() {
        let tmp = TempDir::new().unwrap();
        let fake_bin = tmp.path().join("my-editor");
        fs::write(&fake_bin, "").unwrap();

        let result = resolve_cli("nonexistent-editor-xyz", fake_bin.to_str().unwrap());
        assert_eq!(result, Some(fake_bin.to_str().unwrap().to_string()));
    }

    /// `resolve_cli` returns `None` when nothing exists.
    #[test]
    fn resolve_cli_returns_none_when_not_found() {
        let result = resolve_cli("nonexistent-editor-xyz", "/nonexistent/path/editor");
        assert_eq!(result, None);
    }

    /// `resolve_cli` prefers `which` result over fallback paths.
    #[test]
    fn resolve_cli_prefers_which_over_fallback() {
        // `ls` always exists on PATH — use it as a known CLI
        let result = resolve_cli("ls", "/nonexistent/path/ls");
        assert!(result.is_some());
        // Should be the `which` result, not the fallback
        assert_ne!(result.unwrap(), "/nonexistent/path/ls");
    }
}
