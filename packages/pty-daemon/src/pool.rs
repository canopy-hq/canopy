use std::collections::VecDeque;

const POOL_SIZE: usize = 2;

#[derive(Debug, Clone, PartialEq)]
pub enum WarmStatus {
    Warming,
    Ready,
}

#[derive(Debug)]
pub struct PoolEntry {
    pub temp_pane_id: String,
    pub pid: u32,
    pub status: WarmStatus,
}

pub struct Pool {
    entries: VecDeque<PoolEntry>,
    next_id: usize,
}

impl Pool {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            next_id: 0,
        }
    }

    /// Generate the next temp pane ID.
    pub fn next_temp_id(&mut self) -> String {
        let id = format!("__pool_{}", self.next_id);
        self.next_id += 1;
        id
    }

    /// Add a new warming entry to the pool.
    pub fn add_entry(&mut self, temp_pane_id: String, pid: u32) {
        self.entries.push_back(PoolEntry {
            temp_pane_id,
            pid,
            status: WarmStatus::Warming,
        });
    }

    /// Mark a warm session as ready (called when first output byte received).
    pub fn mark_ready(&mut self, temp_pane_id: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.temp_pane_id == temp_pane_id) {
            entry.status = WarmStatus::Ready;
        }
    }

    /// Claim a ready session. Returns (temp_pane_id, pid) or None if pool empty.
    pub fn claim(&mut self) -> Option<(String, u32)> {
        let idx = self.entries.iter().position(|e| e.status == WarmStatus::Ready)?;
        let entry = self.entries.remove(idx)?;
        Some((entry.temp_pane_id, entry.pid))
    }

    /// Remove a dead entry by temp_pane_id.
    pub fn remove_dead(&mut self, temp_pane_id: &str) {
        self.entries.retain(|e| e.temp_pane_id != temp_pane_id);
    }

    /// How many sessions are in each status.
    pub fn status(&self) -> (usize, usize) {
        let ready = self.entries.iter().filter(|e| e.status == WarmStatus::Ready).count();
        let warming = self.entries.iter().filter(|e| e.status == WarmStatus::Warming).count();
        (ready, warming)
    }

    /// How many more sessions need to be spawned to reach target.
    pub fn deficit(&self) -> usize {
        POOL_SIZE.saturating_sub(self.entries.len())
    }

    /// Get all temp pane IDs (for shutdown cleanup).
    pub fn all_pane_ids(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.temp_pane_id.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pool_with_entries(statuses: &[WarmStatus]) -> Pool {
        let mut pool = Pool::new();
        for (i, status) in statuses.iter().enumerate() {
            pool.entries.push_back(PoolEntry {
                temp_pane_id: format!("__pool_{i}"),
                pid: 100 + i as u32,
                status: status.clone(),
            });
        }
        pool
    }

    #[test]
    fn new_pool_is_empty() {
        let pool = Pool::new();
        assert_eq!(pool.status(), (0, 0));
        assert_eq!(pool.deficit(), POOL_SIZE);
    }

    #[test]
    fn claim_returns_ready_entry() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Ready, WarmStatus::Warming]);
        let result = pool.claim();
        assert!(result.is_some());
        let (pane_id, pid) = result.unwrap();
        assert_eq!(pane_id, "__pool_0");
        assert_eq!(pid, 100);
        assert_eq!(pool.status(), (0, 1));
    }

    #[test]
    fn claim_returns_none_when_only_warming() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Warming]);
        assert!(pool.claim().is_none());
    }

    #[test]
    fn claim_returns_none_when_empty() {
        let mut pool = Pool::new();
        assert!(pool.claim().is_none());
    }

    #[test]
    fn mark_ready_transitions_status() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Warming]);
        pool.mark_ready("__pool_0");
        assert_eq!(pool.status(), (1, 0));
    }

    #[test]
    fn remove_dead_drops_entry() {
        let mut pool = make_pool_with_entries(&[WarmStatus::Ready, WarmStatus::Ready]);
        pool.remove_dead("__pool_0");
        assert_eq!(pool.status(), (1, 0));
    }

    #[test]
    fn deficit_counts_missing() {
        let pool = make_pool_with_entries(&[WarmStatus::Ready]);
        assert_eq!(pool.deficit(), POOL_SIZE - 1);
    }

    #[test]
    fn all_pane_ids_lists_entries() {
        let pool = make_pool_with_entries(&[WarmStatus::Ready, WarmStatus::Warming]);
        let ids = pool.all_pane_ids();
        assert_eq!(ids, vec!["__pool_0", "__pool_1"]);
    }
}
