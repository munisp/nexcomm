//! Persistence layer for the NEXCOM matching engine.
//! Provides periodic state snapshots to disk (JSON) and optional Redis integration.
//! Ensures engine state survives restarts.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{error, info, warn};

/// Snapshot of critical engine state for persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSnapshot {
    pub timestamp: String,
    pub version: String,
    pub node_id: String,
    pub audit_sequence: u64,
    pub clearing_members: usize,
    pub active_futures: usize,
    pub active_options: usize,
    pub warehouse_count: usize,
    pub surveillance_alerts: usize,
}

/// Write-Ahead Log entry for crash recovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalEntry {
    pub sequence: u64,
    pub operation: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

/// Manages state persistence to disk and optionally Redis.
/// Implements Write-Ahead Log (WAL) for crash recovery.
pub struct PersistenceManager {
    data_dir: PathBuf,
    redis_url: Option<String>,
    running: Arc<AtomicBool>,
    wal_sequence: std::sync::atomic::AtomicU64,
}

impl PersistenceManager {
    /// Create a new persistence manager.
    pub fn new(data_dir: &str, redis_url: Option<String>) -> Self {
        let path = PathBuf::from(data_dir);
        if !path.exists() {
            fs::create_dir_all(&path).unwrap_or_else(|e| {
                warn!("Could not create data dir {}: {}", data_dir, e);
            });
        }

        Self {
            data_dir: path,
            redis_url,
            running: Arc::new(AtomicBool::new(false)),
            wal_sequence: std::sync::atomic::AtomicU64::new(0),
        }
    }

    // ─── WAL (Write-Ahead Log) ───────────────────────────────────────────────

    /// Write an entry to the WAL before applying state changes.
    pub fn wal_write(&self, operation: &str, payload: serde_json::Value) -> Result<u64, String> {
        let seq = self.wal_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let entry = WalEntry {
            sequence: seq,
            operation: operation.to_string(),
            payload,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        let wal_path = self.data_dir.join("wal.jsonl");
        let line = serde_json::to_string(&entry)
            .map_err(|e| format!("Failed to serialize WAL entry: {}", e))?;

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&wal_path)
            .map_err(|e| format!("Failed to open WAL file: {}", e))?;

        writeln!(file, "{}", line)
            .map_err(|e| format!("Failed to write WAL entry: {}", e))?;

        file.sync_all()
            .map_err(|e| format!("Failed to fsync WAL: {}", e))?;

        Ok(seq)
    }

    /// Replay WAL entries for crash recovery. Returns entries in order.
    pub fn wal_replay(&self) -> Vec<WalEntry> {
        let wal_path = self.data_dir.join("wal.jsonl");
        if !wal_path.exists() {
            return Vec::new();
        }

        match fs::read_to_string(&wal_path) {
            Ok(content) => {
                let mut entries: Vec<WalEntry> = content
                    .lines()
                    .filter_map(|line| serde_json::from_str(line).ok())
                    .collect();
                entries.sort_by_key(|e| e.sequence);

                // Update sequence counter to max
                if let Some(max_seq) = entries.last().map(|e| e.sequence) {
                    self.wal_sequence.store(max_seq, Ordering::SeqCst);
                }

                info!("WAL replay: {} entries recovered", entries.len());
                entries
            }
            Err(e) => {
                error!("Failed to read WAL file: {}", e);
                Vec::new()
            }
        }
    }

    /// Truncate WAL after a successful snapshot (checkpoint).
    pub fn wal_checkpoint(&self) -> Result<(), String> {
        let wal_path = self.data_dir.join("wal.jsonl");
        fs::write(&wal_path, "")
            .map_err(|e| format!("Failed to truncate WAL: {}", e))?;
        info!("WAL checkpoint: log truncated");
        Ok(())
    }

    /// Get current WAL sequence number.
    pub fn wal_sequence(&self) -> u64 {
        self.wal_sequence.load(Ordering::Relaxed)
    }

    /// Save an engine snapshot to disk as JSON.
    pub fn save_snapshot(&self, snapshot: &EngineSnapshot) -> Result<(), String> {
        let filename = format!("snapshot-{}.json", snapshot.timestamp.replace(':', "-"));
        let path = self.data_dir.join(&filename);
        let latest_path = self.data_dir.join("latest-snapshot.json");

        let json = serde_json::to_string_pretty(snapshot)
            .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;

        fs::write(&path, &json)
            .map_err(|e| format!("Failed to write snapshot to {:?}: {}", path, e))?;

        // Also write as latest
        fs::write(&latest_path, &json)
            .map_err(|e| format!("Failed to write latest snapshot: {}", e))?;

        info!("Saved engine snapshot to {:?}", path);

        // If Redis URL is configured, also push to Redis
        if let Some(ref url) = self.redis_url {
            self.save_to_redis(url, snapshot);
        }

        Ok(())
    }

    /// Load the latest snapshot from disk.
    pub fn load_latest_snapshot(&self) -> Option<EngineSnapshot> {
        let latest_path = self.data_dir.join("latest-snapshot.json");
        if !latest_path.exists() {
            info!("No previous snapshot found at {:?}", latest_path);
            return None;
        }

        match fs::read_to_string(&latest_path) {
            Ok(json) => match serde_json::from_str::<EngineSnapshot>(&json) {
                Ok(snapshot) => {
                    info!(
                        "Loaded snapshot from {:?} (timestamp={})",
                        latest_path, snapshot.timestamp
                    );
                    Some(snapshot)
                }
                Err(e) => {
                    error!("Failed to parse snapshot: {}", e);
                    None
                }
            },
            Err(e) => {
                error!("Failed to read snapshot file: {}", e);
                None
            }
        }
    }

    /// List all available snapshots.
    pub fn list_snapshots(&self) -> Vec<String> {
        let mut snapshots = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.data_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("snapshot-") && name.ends_with(".json") {
                    snapshots.push(name);
                }
            }
        }
        snapshots.sort();
        snapshots
    }

    /// Clean up old snapshots, keeping only the N most recent.
    pub fn cleanup_old_snapshots(&self, keep: usize) {
        let mut snapshots = self.list_snapshots();
        if snapshots.len() <= keep {
            return;
        }
        snapshots.sort();
        let to_remove = snapshots.len() - keep;
        for name in snapshots.iter().take(to_remove) {
            let path = self.data_dir.join(name);
            if let Err(e) = fs::remove_file(&path) {
                warn!("Failed to remove old snapshot {:?}: {}", path, e);
            } else {
                info!("Removed old snapshot: {}", name);
            }
        }
    }

    /// Check if the persistence manager is running periodic snapshots.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Stop periodic snapshots.
    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }

    /// Save snapshot to Redis using proper RESP protocol client.
    fn save_to_redis(&self, url: &str, snapshot: &EngineSnapshot) {
        let json = match serde_json::to_string(snapshot) {
            Ok(j) => j,
            Err(e) => {
                warn!("Failed to serialize for Redis: {}", e);
                return;
            }
        };

        let addr = url
            .strip_prefix("redis://")
            .unwrap_or(url)
            .trim_end_matches('/');

        match std::net::TcpStream::connect_timeout(
            &addr.parse().unwrap_or_else(|_| "127.0.0.1:6379".parse().unwrap()),
            std::time::Duration::from_secs(2),
        ) {
            Ok(mut stream) => {
                // RESP protocol: SET key value with proper framing
                let key = "nexcom:engine:snapshot";
                let cmd = format!(
                    "*3\r\n$3\r\nSET\r\n${}\r\n{}\r\n${}\r\n{}\r\n",
                    key.len(), key, json.len(), json
                );
                if let Err(e) = stream.write_all(cmd.as_bytes()) {
                    warn!("Failed to write to Redis at {}: {}", addr, e);
                    return;
                }

                // Read response to verify success
                use std::io::Read;
                let mut buf = [0u8; 64];
                match stream.read(&mut buf) {
                    Ok(n) => {
                        let response = String::from_utf8_lossy(&buf[..n]);
                        if response.starts_with("+OK") {
                            info!("Saved snapshot to Redis at {}", addr);
                        } else {
                            warn!("Redis unexpected response: {}", response.trim());
                        }
                    }
                    Err(e) => {
                        warn!("Failed to read Redis response: {}", e);
                    }
                }

                // Also store WAL sequence for crash recovery coordination
                let wal_seq = self.wal_sequence.load(Ordering::Relaxed);
                let wal_cmd = format!(
                    "*3\r\n$3\r\nSET\r\n$24\r\nnexcom:engine:wal_seq\r\n${}\r\n{}\r\n",
                    wal_seq.to_string().len(), wal_seq
                );
                let _ = stream.write_all(wal_cmd.as_bytes());
            }
            Err(e) => {
                warn!("Could not connect to Redis at {}: {} (snapshot saved to disk only)", addr, e);
            }
        }
    }

    // ─── Orderbook Snapshot Persistence ───────────────────────────────────────

    /// Save orderbook snapshots to disk.
    pub fn save_orderbook_snapshot(&self, orders: &[(String, Vec<serde_json::Value>)]) -> Result<(), String> {
        let path = self.data_dir.join("orderbook-snapshot.json");
        let json = serde_json::to_string_pretty(orders)
            .map_err(|e| format!("Failed to serialize orderbook snapshot: {}", e))?;
        fs::write(&path, &json)
            .map_err(|e| format!("Failed to write orderbook snapshot: {}", e))?;
        info!("Saved orderbook snapshot ({} symbols)", orders.len());
        Ok(())
    }

    /// Load orderbook snapshots from disk.
    pub fn load_orderbook_snapshot(&self) -> Option<Vec<(String, Vec<serde_json::Value>)>> {
        let path = self.data_dir.join("orderbook-snapshot.json");
        if !path.exists() {
            return None;
        }
        match fs::read_to_string(&path) {
            Ok(json) => match serde_json::from_str(&json) {
                Ok(data) => {
                    info!("Loaded orderbook snapshot from {:?}", path);
                    Some(data)
                }
                Err(e) => {
                    error!("Failed to parse orderbook snapshot: {}", e);
                    None
                }
            },
            Err(e) => {
                error!("Failed to read orderbook snapshot: {}", e);
                None
            }
        }
    }

    // ─── NGX Module Persistence (Gap 4) ──────────────────────────────────────

    /// Generic save for any serializable NGX module data to a named JSON file.
    pub fn save_module_data<T: Serialize + ?Sized>(&self, module_name: &str, data: &T) -> Result<(), String> {
        let path = self.data_dir.join(format!("{}.json", module_name));
        let json = serde_json::to_string_pretty(data)
            .map_err(|e| format!("Failed to serialize {} data: {}", module_name, e))?;
        fs::write(&path, &json)
            .map_err(|e| format!("Failed to write {} data: {}", module_name, e))?;

        // WAL entry for crash recovery
        let _ = self.wal_write(
            &format!("SAVE_{}", module_name.to_uppercase()),
            serde_json::json!({"module": module_name, "timestamp": chrono::Utc::now().to_rfc3339()}),
        );

        info!("Persisted {} module data to {:?}", module_name, path);
        Ok(())
    }

    /// Generic load for any deserializable NGX module data from a named JSON file.
    pub fn load_module_data<T: for<'de> Deserialize<'de> + Sized>(&self, module_name: &str) -> Option<T> {
        let path = self.data_dir.join(format!("{}.json", module_name));
        if !path.exists() {
            info!("No persisted data found for module {}", module_name);
            return None;
        }
        match fs::read_to_string(&path) {
            Ok(json) => match serde_json::from_str::<T>(&json) {
                Ok(data) => {
                    info!("Loaded {} module data from {:?}", module_name, path);
                    Some(data)
                }
                Err(e) => {
                    error!("Failed to parse {} module data: {}", module_name, e);
                    None
                }
            },
            Err(e) => {
                error!("Failed to read {} module data: {}", module_name, e);
                None
            }
        }
    }

    /// Persist all NGX module data (market makers, indices, corporate actions, brokers).
    pub fn save_all_modules(
        &self,
        market_makers: &[serde_json::Value],
        indices: &[serde_json::Value],
        corporate_actions: &[serde_json::Value],
        brokers: &[serde_json::Value],
    ) -> Result<(), String> {
        self.save_module_data("market-makers", market_makers)?;
        self.save_module_data("indices", indices)?;
        self.save_module_data("corporate-actions", corporate_actions)?;
        self.save_module_data("brokers", brokers)?;
        info!("All NGX modules persisted successfully");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn test_snapshot() -> EngineSnapshot {
        EngineSnapshot {
            timestamp: "2026-02-27T06-00-00Z".to_string(),
            version: "0.1.0".to_string(),
            node_id: "test-node".to_string(),
            audit_sequence: 42,
            clearing_members: 3,
            active_futures: 86,
            active_options: 12,
            warehouse_count: 9,
            surveillance_alerts: 0,
        }
    }

    #[test]
    fn test_save_and_load_snapshot() {
        let dir = env::temp_dir().join("nexcom-test-persistence");
        let _ = fs::remove_dir_all(&dir);
        let mgr = PersistenceManager::new(dir.to_str().unwrap(), None);

        let snapshot = test_snapshot();
        mgr.save_snapshot(&snapshot).unwrap();

        let loaded = mgr.load_latest_snapshot().unwrap();
        assert_eq!(loaded.node_id, "test-node");
        assert_eq!(loaded.audit_sequence, 42);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_list_and_cleanup_snapshots() {
        let dir = env::temp_dir().join("nexcom-test-cleanup");
        let _ = fs::remove_dir_all(&dir);
        let mgr = PersistenceManager::new(dir.to_str().unwrap(), None);

        for i in 0..5 {
            let mut s = test_snapshot();
            s.timestamp = format!("2026-02-27T0{}-00-00Z", i);
            mgr.save_snapshot(&s).unwrap();
        }

        assert_eq!(mgr.list_snapshots().len(), 5);
        mgr.cleanup_old_snapshots(2);
        assert_eq!(mgr.list_snapshots().len(), 2);

        let _ = fs::remove_dir_all(&dir);
    }
}
