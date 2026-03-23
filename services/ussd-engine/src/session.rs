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
 *   - pending_loan: partial loan application being built
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
    /// Partial loan application flow
    pub pending_loan: Option<PendingLoan>,
    /// Partial loan repayment flow
    pub pending_repayment: Option<PendingRepayment>,
    /// Total interactions in this session
    pub interactions: u32,
    /// Partial price alert being set from the price check menu
    pub pending_price_alert: Option<PendingPriceAlert>,
    /// Alert id pending deletion confirmation in the My Alerts menu
    pub pending_delete_alert_id: Option<i64>,
    /// Watchlist entry id pending deletion confirmation in the My Watchlist menu
    pub pending_delete_watchlist_id: Option<i64>,
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

/// Partial loan repayment being built across multiple USSD inputs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingRepayment {
    /// The loan application ID being repaid
    pub loan_id: Option<i64>,
    /// Amount to repay in NGN
    pub amount_ngn: Option<f64>,
    /// Mobile money provider: 1=MTN 2=Airtel 3=Glo 4=9Mobile
    pub provider: Option<String>,
    /// Step: 1=select_loan, 2=enter_amount, 3=select_provider, 4=confirm, 5=pin_verify
    pub step: u8,
}

/// Partial loan application being built across multiple USSD inputs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingLoan {
    /// Loan input type: 1=SEEDS 2=FERTILIZER 3=EQUIPMENT 4=CASH 5=STORAGE
    pub input_type: Option<String>,
    /// Requested amount in NGN
    pub amount_ngn: Option<f64>,
    /// Repayment tenor in months (default 6)
    pub tenor_months: Option<i32>,
    /// Free-text purpose / description (auto-generated from input_type if blank)
    pub description: Option<String>,
    /// Step: 1=type, 2=amount, 3=tenor, 4=confirm, 5=pin_verify
    pub step: u8,
}

/// Partial price alert being set from the price check shortcut
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingPriceAlert {
    /// Commodity symbol, e.g. "MAIZE"
    pub symbol: String,
    /// Human-readable commodity name, e.g. "Maize"
    pub name: String,
    /// Current market price shown to the user
    pub current_price: f64,
    /// Direction chosen: "ABOVE" | "BELOW" (None until step 2)
    pub condition: Option<String>,
    /// Step: 1 = choose direction, 2 = enter target price
    pub step: u8,
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
            pending_loan: None,
            pending_repayment: None,
            pending_price_alert: None,
            pending_delete_alert_id: None,
            pending_delete_watchlist_id: None,
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
            .set_ex::<_, _, ()>(Self::key(&state.session_id), raw, SESSION_TTL_SECS)
            .await?;
        Ok(())
    }

    pub async fn delete(&mut self, session_id: &str) -> Result<()> {
        self.conn.del::<_, ()>(Self::key(session_id)).await?;
        Ok(())
    }

    /// Increment a counter for rate limiting (e.g. failed PIN attempts)
    pub async fn incr_with_ttl(&mut self, key: &str, ttl: u64) -> Result<i64> {
        let full_key = format!("nexcom:ussd:rl:{}", key);
        let count: i64 = self.conn.incr(&full_key, 1).await?;
        if count == 1 {
            self.conn.expire::<_, ()>(&full_key, ttl as i64).await?;
        }
        Ok(count)
    }
}
