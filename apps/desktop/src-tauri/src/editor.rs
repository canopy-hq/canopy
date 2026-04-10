use serde::Serialize;
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
}

const KNOWN_EDITORS: &[EditorDef] = &[
    EditorDef { id: "vscode", display_name: "VS Code", cli: "code" },
    EditorDef { id: "cursor", display_name: "Cursor", cli: "cursor" },
    EditorDef { id: "zed", display_name: "Zed", cli: "zed" },
    EditorDef { id: "windsurf", display_name: "Windsurf", cli: "windsurf" },
    EditorDef { id: "sublime", display_name: "Sublime Text", cli: "subl" },
    EditorDef { id: "webstorm", display_name: "WebStorm", cli: "webstorm" },
    EditorDef { id: "idea", display_name: "IntelliJ IDEA", cli: "idea" },
];

fn resolve_cli(name: &str) -> Option<String> {
    let output = Command::new("which")
        .arg(name)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn detect_editors() -> Result<Vec<DetectedEditor>, String> {
    tokio::task::spawn_blocking(|| {
        KNOWN_EDITORS
            .iter()
            .filter_map(|def| {
                resolve_cli(def.cli).map(|cli_path| DetectedEditor {
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

        let cli_path = resolve_cli(def.cli)
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
