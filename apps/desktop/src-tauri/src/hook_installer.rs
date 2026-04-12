use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

// ── Configuration types ────────────────────────────────────────────────

/// How hook entries are structured in the agent's config file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HookConfigFormat {
    /// Claude Code: `{"hooks": {"Event": [{"matcher": "", "hooks": [{"type": "command", "command": "..."}]}]}}`
    NestedMatcherHooks,
    /// Codex / Mastracode: `{"Event": [{"type": "command", "command": "..."}]}`
    DirectEvents,
    /// Gemini: `{"hooks": {"Event": [{"hooks": [{"type": "command", "command": "..."}]}]}}`
    NestedGroupHooks,
    /// Cursor: `{"version": 1, "hooks": {"Event": [{"command": "..."}]}}`
    VersionedHooks,
}

/// Per-agent hook configuration — defines how to install hooks for one agent CLI.
pub struct AgentHookConfig {
    pub name: &'static str,
    pub config_path: &'static str,
    pub format: HookConfigFormat,
    /// (agent_event_name, canopy_event_type): e.g. ("PostToolUse", "Start")
    pub events: &'static [(&'static str, &'static str)],
}

/// Marker substring used to identify Canopy-owned hook entries.
const CANOPY_MARKER: &str = "/.canopy/bin/canopy-notify";

// ── Agent configurations ───────────────────────────────────────────────

pub static AGENT_CONFIGS: &[AgentHookConfig] = &[
    AgentHookConfig {
        name: "claude",
        config_path: "~/.claude/settings.json",
        format: HookConfigFormat::NestedMatcherHooks,
        events: &[
            ("UserPromptSubmit", "Start"),
            ("PostToolUse", "Start"),
            ("Stop", "Stop"),
            ("Notification", "Permission"),
        ],
    },
    AgentHookConfig {
        name: "codex",
        config_path: "~/.codex/hooks.json",
        format: HookConfigFormat::DirectEvents,
        events: &[
            ("UserPromptSubmit", "Start"),
            ("PostToolUse", "Start"),
            ("Stop", "Stop"),
        ],
    },
    AgentHookConfig {
        name: "gemini",
        config_path: "~/.gemini/settings.json",
        format: HookConfigFormat::NestedGroupHooks,
        events: &[
            ("BeforeAgent", "Start"),
            ("AfterTool", "Start"),
            ("AfterAgent", "Stop"),
        ],
    },
    AgentHookConfig {
        name: "cursor",
        config_path: "~/.cursor/hooks.json",
        format: HookConfigFormat::VersionedHooks,
        events: &[
            ("beforeSubmitPrompt", "Start"),
            ("stop", "Stop"),
        ],
    },
    AgentHookConfig {
        name: "mastracode",
        config_path: "~/.mastracode/hooks.json",
        format: HookConfigFormat::DirectEvents,
        events: &[
            ("UserPromptSubmit", "Start"),
            ("PostToolUse", "Start"),
            ("Stop", "Stop"),
        ],
    },
];

// ── Notify script installation ─────────────────────────────────────────

/// Install the canopy-notify script to ~/.canopy/bin/canopy-notify.
/// Returns the installed path. Skips if content already matches.
pub fn ensure_notify_script(bundled_content: &[u8]) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not determine home directory")?;
    let bin_dir = home.join(".canopy").join("bin");
    let script_path = bin_dir.join("canopy-notify");

    // Skip if content matches
    if script_path.exists() {
        if let Ok(existing) = fs::read(&script_path) {
            if existing == bundled_content {
                return Ok(script_path);
            }
        }
    }

    fs::create_dir_all(&bin_dir).map_err(|e| format!("mkdir ~/.canopy/bin: {e}"))?;
    fs::write(&script_path, bundled_content)
        .map_err(|e| format!("write canopy-notify: {e}"))?;

    // chmod 0o755
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        fs::set_permissions(&script_path, perms)
            .map_err(|e| format!("chmod canopy-notify: {e}"))?;
    }

    eprintln!("[hook] installed canopy-notify to {}", script_path.display());
    Ok(script_path)
}

// ── Hook installation ──────────────────────────────────────────────────

/// Resolve `~` prefix to the user's home directory.
fn expand_tilde(path: &str) -> Result<PathBuf, String> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or("could not determine home directory")?;
        Ok(home.join(rest))
    } else {
        Ok(PathBuf::from(path))
    }
}

/// Install hooks for a single agent. Preserves user-defined hooks.
pub fn install_hooks(config: &AgentHookConfig, notify_path: &Path) -> Result<(), String> {
    let config_path = expand_tilde(config.config_path)?;
    let notify_str = notify_path.to_string_lossy();

    // Create parent directory if needed
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Acquire advisory lock (flock)
    let lock_path = config_path.with_extension("canopy-lock");
    let lock_file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&lock_path)
        .map_err(|e| format!("lock {}: {e}", lock_path.display()))?;
    flock_exclusive(&lock_file)?;

    let result = install_hooks_inner(config, &config_path, &notify_str);

    // Release lock (drop closes the file, releasing flock)
    drop(lock_file);
    let _ = fs::remove_file(&lock_path);

    result
}

fn install_hooks_inner(
    config: &AgentHookConfig,
    config_path: &Path,
    notify_str: &str,
) -> Result<(), String> {
    // Read existing config (or empty object)
    let mut root: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(config_path)
            .map_err(|e| format!("read {}: {e}", config_path.display()))?;
        match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => {
                eprintln!(
                    "[hook] {} is invalid JSON, skipping {}",
                    config_path.display(),
                    config.name
                );
                return Ok(());
            }
        }
    } else {
        serde_json::json!({})
    };


    // Get or create the hooks container
    let hooks_obj = match config.format {
        HookConfigFormat::NestedMatcherHooks | HookConfigFormat::NestedGroupHooks => {
            if root.get("hooks").is_none() {
                root["hooks"] = serde_json::json!({});
            }
            root.get_mut("hooks").unwrap()
        }
        HookConfigFormat::VersionedHooks => {
            if root.get("version").is_none() {
                root["version"] = serde_json::json!(1);
            }
            if root.get("hooks").is_none() {
                root["hooks"] = serde_json::json!({});
            }
            root.get_mut("hooks").unwrap()
        }
        HookConfigFormat::DirectEvents => &mut root,
    };

    // For each event, remove stale Canopy entries and append fresh ones
    for &(agent_event, canopy_event) in config.events {
        let command = format!(
            "CANOPY_HOOK_EVENT={canopy_event} CANOPY_AGENT={} '{notify_str}'",
            config.name
        );

        let event_arr = hooks_obj
            .get_mut(agent_event)
            .and_then(|v| v.as_array_mut());

        if let Some(arr) = event_arr {
            // Remove existing Canopy entries
            arr.retain(|entry| !entry_contains_marker(entry, config.format));
        } else {
            hooks_obj[agent_event] = serde_json::json!([]);
        }

        let arr = hooks_obj[agent_event].as_array_mut().unwrap();

        // Append fresh Canopy entry in the correct format
        let entry = build_entry(config.format, &command);
        arr.push(entry);
    }

    // Write atomically: write to .tmp, then rename
    let tmp_path = config_path.with_extension("canopy-tmp");
    let content = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("serialize: {e}"))?;
    let mut f = fs::File::create(&tmp_path)
        .map_err(|e| format!("create tmp: {e}"))?;
    f.write_all(content.as_bytes())
        .map_err(|e| format!("write tmp: {e}"))?;
    f.write_all(b"\n")
        .map_err(|e| format!("write newline: {e}"))?;
    f.flush().map_err(|e| format!("flush: {e}"))?;
    f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    drop(f);
    fs::rename(&tmp_path, config_path)
        .map_err(|e| format!("rename: {e}"))?;

    eprintln!("[hook] installed hooks for {} at {}", config.name, config_path.display());
    Ok(())
}

/// Check if a hook entry contains the Canopy marker.
fn entry_contains_marker(entry: &serde_json::Value, format: HookConfigFormat) -> bool {
    match format {
        // Both nested formats share the same structure: entry["hooks"][*]["command"]
        HookConfigFormat::NestedMatcherHooks | HookConfigFormat::NestedGroupHooks => {
            entry["hooks"]
                .as_array()
                .map(|hooks| hooks.iter().any(|h| {
                    h["command"].as_str().map_or(false, |c| c.contains(CANOPY_MARKER))
                }))
                .unwrap_or(false)
        }
        // Both flat formats check entry["command"] directly
        HookConfigFormat::DirectEvents | HookConfigFormat::VersionedHooks => {
            entry["command"].as_str().map_or(false, |c| c.contains(CANOPY_MARKER))
        }
    }
}

/// Build a hook entry in the agent's format.
fn build_entry(format: HookConfigFormat, command: &str) -> serde_json::Value {
    match format {
        HookConfigFormat::NestedMatcherHooks => serde_json::json!({
            "matcher": "",
            "hooks": [{"type": "command", "command": command}]
        }),
        HookConfigFormat::NestedGroupHooks => serde_json::json!({
            "hooks": [{"type": "command", "command": command}]
        }),
        HookConfigFormat::DirectEvents => serde_json::json!({
            "type": "command",
            "command": command
        }),
        HookConfigFormat::VersionedHooks => serde_json::json!({
            "command": command
        }),
    }
}

/// Advisory file lock (flock) — blocks until exclusive lock acquired.
#[cfg(unix)]
fn flock_exclusive(file: &fs::File) -> Result<(), String> {
    use std::os::unix::io::AsRawFd;
    let ret = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if ret != 0 {
        Err(format!("flock: {}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(not(unix))]
fn flock_exclusive(_file: &fs::File) -> Result<(), String> {
    Ok(()) // no-op on non-unix
}

/// Install hooks for all known agents. Returns per-agent results.
pub fn install_all_hooks(notify_path: &Path) -> Vec<(&'static str, Result<(), String>)> {
    AGENT_CONFIGS
        .iter()
        .map(|config| (config.name, install_hooks(config, notify_path)))
        .collect()
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(format: HookConfigFormat) -> AgentHookConfig {
        AgentHookConfig {
            name: "test-agent",
            config_path: "unused",
            format,
            events: &[("Start", "Start"), ("Stop", "Stop")],
        }
    }

    fn write_config(dir: &Path, content: &str) -> PathBuf {
        let path = dir.join("hooks.json");
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn test_creates_config_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("hooks.json");
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = AgentHookConfig {
            name: "test",
            config_path: "unused",
            format: HookConfigFormat::DirectEvents,
            events: &[("Start", "Start")],
        };

        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert!(content["Start"].is_array());
        assert_eq!(content["Start"].as_array().unwrap().len(), 1);
        let cmd = content["Start"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("canopy-notify"));
    }

    #[test]
    fn test_preserves_user_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = write_config(
            dir.path(),
            r#"{"Start": [{"type": "command", "command": "my-custom-hook.sh"}]}"#,
        );
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = test_config(HookConfigFormat::DirectEvents);
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        let arr = content["Start"].as_array().unwrap();
        // User hook + Canopy hook
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["command"].as_str().unwrap(), "my-custom-hook.sh");
        assert!(arr[1]["command"].as_str().unwrap().contains("canopy-notify"));
    }

    #[test]
    fn test_idempotency() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("hooks.json");
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = test_config(HookConfigFormat::DirectEvents);
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        // Should have exactly 1 Canopy entry per event, not duplicates
        assert_eq!(content["Start"].as_array().unwrap().len(), 1);
        assert_eq!(content["Stop"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_replaces_stale_canopy_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = write_config(
            dir.path(),
            r#"{"Start": [
                {"type": "command", "command": "my-hook.sh"},
                {"type": "command", "command": "CANOPY_HOOK_EVENT=Start CANOPY_AGENT=old /old/.canopy/bin/canopy-notify"}
            ]}"#,
        );
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = test_config(HookConfigFormat::DirectEvents);
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        let arr = content["Start"].as_array().unwrap();
        assert_eq!(arr.len(), 2); // user + fresh canopy
        assert_eq!(arr[0]["command"].as_str().unwrap(), "my-hook.sh");
        assert!(arr[1]["command"].as_str().unwrap().contains("/home/test/.canopy/bin/canopy-notify"));
    }

    #[test]
    fn test_invalid_json_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = write_config(dir.path(), "not valid json {{{");
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = test_config(HookConfigFormat::DirectEvents);
        let result = install_hooks_inner(&config, &config_path, &notify.to_string_lossy());
        assert!(result.is_ok()); // should not error — just skip

        // File should be unchanged
        let content = fs::read_to_string(&config_path).unwrap();
        assert_eq!(content, "not valid json {{{");
    }

    #[test]
    fn test_nested_matcher_hooks_format() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("settings.json");
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = AgentHookConfig {
            name: "claude",
            config_path: "unused",
            format: HookConfigFormat::NestedMatcherHooks,
            events: &[("Stop", "Stop")],
        };
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        let entry = &content["hooks"]["Stop"][0];
        assert_eq!(entry["matcher"].as_str().unwrap(), "");
        assert!(entry["hooks"][0]["command"].as_str().unwrap().contains("canopy-notify"));
    }

    #[test]
    fn test_versioned_hooks_format() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("hooks.json");
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = AgentHookConfig {
            name: "cursor",
            config_path: "unused",
            format: HookConfigFormat::VersionedHooks,
            events: &[("stop", "Stop")],
        };
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(content["version"], 1);
        let entry = &content["hooks"]["stop"][0];
        assert!(entry["command"].as_str().unwrap().contains("canopy-notify"));
    }

    #[test]
    fn test_nested_group_hooks_format() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("settings.json");
        let notify = PathBuf::from("/home/test/.canopy/bin/canopy-notify");

        let config = AgentHookConfig {
            name: "gemini",
            config_path: "unused",
            format: HookConfigFormat::NestedGroupHooks,
            events: &[("AfterAgent", "Stop")],
        };
        install_hooks_inner(&config, &config_path, &notify.to_string_lossy()).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        let entry = &content["hooks"]["AfterAgent"][0];
        assert!(entry["hooks"][0]["command"].as_str().unwrap().contains("canopy-notify"));
    }

    #[test]
    fn test_ensure_notify_script() {
        let dir = tempfile::tempdir().unwrap();
        let script_content = b"#!/bin/sh\necho test\n";

        // Override home for test
        let bin_dir = dir.path().join(".canopy").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let script_path = bin_dir.join("canopy-notify");

        // First write
        fs::write(&script_path, script_content).unwrap();

        // Same content — should skip
        let existing = fs::read(&script_path).unwrap();
        assert_eq!(existing, script_content);

        // Different content — should update
        fs::write(&script_path, b"old content").unwrap();
        fs::write(&script_path, script_content).unwrap();
        let updated = fs::read(&script_path).unwrap();
        assert_eq!(updated, script_content);
    }

    #[test]
    fn test_build_entry_formats() {
        let cmd = "test-command";

        let nm = build_entry(HookConfigFormat::NestedMatcherHooks, cmd);
        assert_eq!(nm["matcher"], "");
        assert_eq!(nm["hooks"][0]["type"], "command");
        assert_eq!(nm["hooks"][0]["command"], cmd);

        let ng = build_entry(HookConfigFormat::NestedGroupHooks, cmd);
        assert_eq!(ng["hooks"][0]["type"], "command");

        let de = build_entry(HookConfigFormat::DirectEvents, cmd);
        assert_eq!(de["type"], "command");
        assert_eq!(de["command"], cmd);

        let vh = build_entry(HookConfigFormat::VersionedHooks, cmd);
        assert_eq!(vh["command"], cmd);
        assert!(vh.get("type").is_none());
    }

    #[test]
    fn test_entry_contains_marker() {
        let with_marker = serde_json::json!({"type": "command", "command": "CANOPY_HOOK_EVENT=Start /home/.canopy/bin/canopy-notify"});
        let without = serde_json::json!({"type": "command", "command": "my-hook.sh"});

        assert!(entry_contains_marker(&with_marker, HookConfigFormat::DirectEvents));
        assert!(!entry_contains_marker(&without, HookConfigFormat::DirectEvents));

        let nested = serde_json::json!({"matcher": "", "hooks": [{"type": "command", "command": "/x/.canopy/bin/canopy-notify"}]});
        assert!(entry_contains_marker(&nested, HookConfigFormat::NestedMatcherHooks));
    }
}
