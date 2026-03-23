/*!
 * USSD Session Store — Redis-backed session state
 *
 * Each session is stored as a JSON blob in Redis with a 300-second TTL
 * (Africa's Talking sessions time out after 5 minutes of inactivity).
 *
 * Session state tracks:
 *   - current_menu: which menu node the user is on
 *   - menu_path: breadcrumb of inputs (e.g. "1>2>500")
 *   - user_id: resolved after PIN authentication
 *   - pending_order: partial order being built
 *   - auth_attempts: failed PIN attempts in this session
 */

use anyhow::Result;
use redis::{aio::ConnectionManager, AsyncCommands, Client};
use serde::{Deserialize, Serialize};

const SESSION_TTL_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UssdSessionState {
    pub session_id: String,
    pub phone_number: String,
    pub current_menu: String,
    pub menu_path: Vec<String>,
    /// Resolved user ID after PIN auth (None = unauthenticated)
    pub user_id: Option<i32>,
    /// Number of failed PIN attempts in this session
    pub auth_attempts: u8,
    /// Partial order being built across multiple inputs
    pub pending_order: Option<PendingOrder>,
    /// Partial PIN-set flow
    pub pending_pin: Option<PendingPin>,
    /// Total interactions in this session
    pub interactions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingOrder {
    pub side: String,     // "BUY" | "SELL"
    pub symbol: Option<String>,
    pub quantity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingPin {
    pub new_pin: Option<String>,
    pub step: u8,   // 1 = enter new PIN, 2 = confirm new PIN
}

impl UssdSessionState {
    pub fn new(session_id: &str, phone_number: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            phone_number: phone_number.to_string(),
            current_menu: "MAIN".to_string(),
            menu_path: vec![],
            user_id: None,
            auth_attempts: 0,
            pending_order: None,
            pending_pin: None,
            interactions: 0,
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.user_id.is_some()
    }
}

#[derive(Clone)]
pub struct SessionStore {
    conn: ConnectionManager,
}

impl SessionStore {
    pub async fn new(redis_url: &str) -> Result<Self> {
        let client = Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await
            .map_err(|e| anyhow::anyhow!("Redis connection failed: {}", e))?;
        Ok(Self { conn })
    }

    fn key(session_id: &str) -> String {
        format!("nexcom:ussd:session:{}", session_id)
    }

    pub async fn get(&mut self, session_id: &str) -> Result<Option<UssdSessionState>> {
        let raw: Option<String> = self.conn.get(Self::key(session_id)).await?;
        match raw {
            Some(s) => Ok(Some(serde_json::from_str(&s)?)),
            None => Ok(None),
        }
    }

    pub async fn set(&mut self, state: &UssdSessionState) -> Result<()> {
        let raw = serde_json::to_string(state)?;
        self.conn
            .set_ex(Self::key(&state.session_id), raw, SESSION_TTL_SECS)
            .await?;
        Ok(())
    }

    pub async fn delete(&mut self, session_id: &str) -> Result<()> {
        self.conn.del(Self::key(session_id)).await?;
        Ok(())
    }

    /// Increment a counter for rate limiting (e.g. failed PIN attempts)
    pub async fn incr_with_ttl(&mut self, key: &str, ttl: u64) -> Result<i64> {
        let full_key = format!("nexcom:ussd:rl:{}", key);
        let count: i64 = self.conn.incr(&full_key, 1).await?;
        if count == 1 {
            self.conn.expire(&full_key, ttl as i64).await?;
        }
        Ok(count)
    }
}
