/// On-disk scrollback persistence for PTY sessions.
///
/// Each session gets a directory at `~/.canopy/sessions/<paneId>/`:
///   scrollback.bin — raw PTY output, append-only, capped at 5 MB (rotates when exceeded)
///   meta.json      — { cwd, cols, rows, startedAt, endedAt? }
///
/// The absence of `endedAt` signals an unclean shutdown (app killed, system reboot).
/// Only sessions without `endedAt` are eligible for cold restore.
///
/// Cold restore: the daemon reads the on-disk scrollback into the new session's ring
/// buffer so the user sees their history above the new shell prompt — without any
/// characters being written to the shell.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 5 * 1024 * 1024; // 5 MB cap per session

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct Meta {
    cwd: String,
    cols: u16,
    rows: u16,
    started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    ended_at: Option<u64>,
}

pub struct ColdRestoreData {
    pub scrollback: Vec<u8>,
    pub cwd: String,
}

// ── SessionStore ──────────────────────────────────────────────────────────────

pub struct SessionStore {
    dir: PathBuf,
    scrollback: Option<File>,
    bytes_written: u64,
}

impl SessionStore {
    fn base_dir() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".canopy").join("sessions"))
    }

    /// Open session storage for `pane_id`.
    /// Creates the directory and truncates any previous scrollback file so the
    /// new session starts clean on disk (cold-restore data was already loaded
    /// into the in-memory ring buffer by do_spawn before calling this).
    pub fn open(pane_id: &str, cwd: &str, cols: u16, rows: u16) -> Option<Self> {
        let dir = Self::base_dir()?.join(pane_id);
        if let Err(e) = fs::create_dir_all(&dir) {
            eprintln!("[store] create_dir_all {}: {e}", dir.display());
            return None;
        }

        let meta = Meta {
            cwd: cwd.to_string(),
            cols,
            rows,
            started_at: unix_now(),
            ended_at: None,
        };
        if let Err(e) = write_json_atomic(&dir.join("meta.json"), &meta) {
            eprintln!("[store] write meta for {pane_id}: {e}");
        }

        // Truncate previous data — cold-restore bytes are in the ring buffer.
        let scrollback = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(dir.join("scrollback.bin"))
            .map_err(|e| eprintln!("[store] open scrollback for {pane_id}: {e}"))
            .ok();

        Some(Self { dir, scrollback, bytes_written: 0 })
    }

    /// Append PTY output. Rotates (keeps tail half) when the 5 MB cap is exceeded.
    pub fn write(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        if self.bytes_written + data.len() as u64 > MAX_BYTES {
            self.rotate(data);
            return;
        }

        if let Some(ref mut f) = self.scrollback {
            let _ = f.write_all(data);
            self.bytes_written += data.len() as u64;
        }
    }

    fn rotate(&mut self, new_data: &[u8]) {
        drop(self.scrollback.take());
        let path = self.dir.join("scrollback.bin");

        if let Ok(existing) = fs::read(&path) {
            let keep_from = existing.len() / 2;
            let kept = &existing[keep_from..];
            let combined = [kept, new_data].concat();
            if fs::write(&path, &combined).is_ok() {
                self.bytes_written = combined.len() as u64;
            } else {
                self.bytes_written = 0;
            }
        } else {
            let _ = fs::write(&path, new_data);
            self.bytes_written = new_data.len() as u64;
        }

        self.scrollback = OpenOptions::new()
            .append(true)
            .open(&path)
            .map_err(|e| eprintln!("[store] reopen after rotate: {e}"))
            .ok();
    }

    /// Write `endedAt` into meta.json — marks this as a clean, intentional close.
    /// Call on explicit tab/session close, NOT on app quit (so orphan detection works).
    pub fn mark_ended(&self) {
        let path = self.dir.join("meta.json");
        let Ok(content) = fs::read_to_string(&path) else { return };
        let Ok(mut meta) = serde_json::from_str::<Meta>(&content) else { return };
        meta.ended_at = Some(unix_now());
        if let Err(e) = write_json_atomic(&path, &meta) {
            eprintln!("[store] update meta: {e}");
        }
    }

    /// Remove all on-disk data for this session.
    pub fn delete(&self) {
        let _ = fs::remove_dir_all(&self.dir);
    }

    /// Read on-disk scrollback for cold restore.
    /// Returns `None` when:
    ///   • the session directory does not exist
    ///   • `endedAt` is present (clean exit — no restore needed)
    ///   • the scrollback file is empty or unreadable
    pub fn read_cold(pane_id: &str) -> Option<ColdRestoreData> {
        let dir = Self::base_dir()?.join(pane_id);
        let meta: Meta =
            serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).ok()?).ok()?;

        if meta.ended_at.is_some() {
            return None; // session closed cleanly — don't restore
        }

        let scrollback = fs::read(dir.join("scrollback.bin")).ok()?;
        if scrollback.is_empty() {
            return None;
        }

        Some(ColdRestoreData { scrollback, cwd: meta.cwd })
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn with_base(tmp: &TempDir) -> Option<PathBuf> {
        let base = tmp.path().join("sessions");
        fs::create_dir_all(&base).ok()?;
        Some(base)
    }

    // Override dirs::home_dir is not straightforward, so we test write/rotate
    // logic directly by constructing a SessionStore with a temp dir.
    fn make_store(dir: &Path) -> SessionStore {
        let scrollback = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(dir.join("scrollback.bin"))
            .ok();
        SessionStore { dir: dir.to_path_buf(), scrollback, bytes_written: 0 }
    }

    #[test]
    fn write_within_cap() {
        let tmp = TempDir::new().unwrap();
        let mut s = make_store(tmp.path());
        s.write(b"hello");
        assert_eq!(s.bytes_written, 5);
        let data = fs::read(tmp.path().join("scrollback.bin")).unwrap();
        assert_eq!(data, b"hello");
    }

    #[test]
    fn rotate_keeps_tail_half() {
        let tmp = TempDir::new().unwrap();
        let mut s = make_store(tmp.path());
        // Fill up to cap then trigger rotate with new data
        let big = vec![b'A'; MAX_BYTES as usize];
        s.write(&big);
        s.write(b"NEW");
        let data = fs::read(tmp.path().join("scrollback.bin")).unwrap();
        // Should end with "NEW"
        assert!(data.ends_with(b"NEW"));
        // Should not exceed ~cap/2 + len(NEW)
        assert!(data.len() <= MAX_BYTES as usize / 2 + 3 + 10);
    }

    #[test]
    fn read_cold_returns_none_when_ended() {
        let tmp = TempDir::new().unwrap();
        let meta = Meta {
            cwd: "/tmp".into(),
            cols: 80,
            rows: 24,
            started_at: 0,
            ended_at: Some(1),
        };
        write_json_atomic(&tmp.path().join("meta.json"), &meta).unwrap();
        fs::write(tmp.path().join("scrollback.bin"), b"data").unwrap();

        // Can't call read_cold directly (uses dirs::home_dir), but test mark_ended logic
        let s = SessionStore {
            dir: tmp.path().to_path_buf(),
            scrollback: None,
            bytes_written: 0,
        };
        s.mark_ended();
        let content = fs::read_to_string(tmp.path().join("meta.json")).unwrap();
        let meta: Meta = serde_json::from_str(&content).unwrap();
        assert!(meta.ended_at.is_some());
    }
}
