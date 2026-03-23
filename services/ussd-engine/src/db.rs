/*!
 * USSD Engine — Database helpers
 * Queries PostgreSQL for prices, portfolios, loans, and PIN management.
 */

use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};

pub type DbPool = PgPool;

pub async fn connect(url: &str) -> Result<DbPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(url)
        .await?;
    Ok(pool)
}

// ─── Price ────────────────────────────────────────────────────────────────────

pub struct LivePrice {
    pub price: f64,
    pub change_pct: f64,
    pub high: f64,
    pub low: f64,
}

pub async fn get_live_price(db: &DbPool, symbol: &str) -> Result<Option<LivePrice>> {
    let row = sqlx::query(
        r#"SELECT price::float8, change_pct::float8, high::float8, low::float8
           FROM live_prices WHERE symbol = $1 LIMIT 1"#,
    )
    .bind(symbol)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| LivePrice {
        price: r.get::<f64, _>("price"),
        change_pct: r.get::<f64, _>("change_pct"),
        high: r.get::<f64, _>("high"),
        low: r.get::<f64, _>("low"),
    }))
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

pub struct PortfolioSummary {
    pub total_value: f64,
    pub total_pnl: f64,
    pub position_count: i64,
    pub open_order_count: i64,
}

pub async fn get_portfolio_summary(db: &DbPool, user_id: i32) -> Result<Option<PortfolioSummary>> {
    // Positions
    let pos_row = sqlx::query(
        r#"SELECT COUNT(*) as cnt,
                  COALESCE(SUM(quantity::float8 * avg_cost::float8), 0) as total_value,
                  COALESCE(SUM(unrealized_pnl::float8), 0) as total_pnl
           FROM positions WHERE user_id = $1"#,
    )
    .bind(user_id)
    .fetch_one(db)
    .await?;

    let open_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE user_id = $1 AND status IN ('PENDING','PARTIAL')",
    )
    .bind(user_id)
    .fetch_one(db)
    .await
    .unwrap_or(0);

    let cnt: i64 = pos_row.get("cnt");
    if cnt == 0 {
        return Ok(None);
    }

    Ok(Some(PortfolioSummary {
        total_value: pos_row.get::<f64, _>("total_value"),
        total_pnl: pos_row.get::<f64, _>("total_pnl"),
        position_count: cnt,
        open_order_count: open_orders,
    }))
}

// ─── Loan ─────────────────────────────────────────────────────────────────────

pub struct LoanSummary {
    pub bank_name: String,
    pub amount: f64,
    pub status: String,
    pub due_date: String,
    pub balance: f64,
}

pub async fn get_loan_summary(db: &DbPool, user_id: i32) -> Result<Option<LoanSummary>> {
    let row = sqlx::query(
        r#"SELECT bank_name, requested_amount_ngn::float8 as amount, status,
                  COALESCE(TO_CHAR(repayment_due_date, 'DD Mon YYYY'), 'N/A') as due_date,
                  COALESCE(approved_amount_ngn::float8, 0) as balance
           FROM bank_financing_applications
           WHERE user_id = $1 AND status NOT IN ('CLOSED','REJECTED','CANCELLED')
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| LoanSummary {
        bank_name: r.get("bank_name"),
        amount: r.get::<f64, _>("amount"),
        status: r.get("status"),
        due_date: r.get("due_date"),
        balance: r.get::<f64, _>("balance"),
    }))
}

// ─── Orders ───────────────────────────────────────────────────────────────────

pub async fn place_ussd_order(
    db: &DbPool,
    user_id: i32,
    side: &str,
    symbol: &str,
    quantity: f64,
) -> Result<i64> {
    // Get current price for the symbol
    let price = get_live_price(db, symbol)
        .await?
        .map(|p| p.price)
        .unwrap_or(0.0);

    let row = sqlx::query(
        r#"INSERT INTO orders (user_id, symbol, side, order_type, quantity, price, status, source, created_at, updated_at)
           VALUES ($1, $2, $3, 'MARKET', $4, $5, 'PENDING', 'USSD', NOW(), NOW())
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(symbol)
    .bind(side)
    .bind(quantity)
    .bind(price)
    .fetch_one(db)
    .await?;

    Ok(row.get::<i64, _>("id"))
}

// ─── PIN Management ──────────────────────────────────────────────────────────

pub async fn verify_pin(db: &DbPool, phone: &str, input_pin: &str) -> Result<Option<i32>> {
    // Find user by phone number
    let user_row = sqlx::query("SELECT id FROM users WHERE phone = $1 LIMIT 1")
        .bind(phone)
        .fetch_optional(db)
        .await?;

    let user_id: i32 = match user_row {
        Some(r) => r.get("id"),
        None => return Err(anyhow::anyhow!("No user found for phone")),
    };

    // Get PIN hash
    let pin_row = sqlx::query(
        "SELECT pin_hash, locked_until FROM ussd_pins WHERE user_id = $1 LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    match pin_row {
        None => Err(anyhow::anyhow!("No PIN set")),
        Some(r) => {
            let locked_until: Option<chrono::NaiveDateTime> = r.get("locked_until");
            if let Some(locked) = locked_until {
                if locked > chrono::Utc::now().naive_utc() {
                    return Ok(None); // Still locked
                }
            }
            let hash: String = r.get("pin_hash");
            if crate::pin::verify(input_pin, &hash) {
                // Reset failed attempts
                sqlx::query("UPDATE ussd_pins SET failed_attempts=0, locked_until=NULL WHERE user_id=$1")
                    .bind(user_id)
                    .execute(db)
                    .await?;
                Ok(Some(user_id))
            } else {
                // Increment failed attempts
                sqlx::query(
                    r#"UPDATE ussd_pins SET failed_attempts = failed_attempts + 1,
                       locked_until = CASE WHEN failed_attempts + 1 >= 3
                           THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
                       WHERE user_id = $1"#,
                )
                .bind(user_id)
                .execute(db)
                .await?;
                Ok(None)
            }
        }
    }
}

pub async fn set_pin(db: &DbPool, phone: &str, user_id: Option<i32>, pin: &str) -> Result<i32> {
    // Resolve user_id from phone if not provided
    let uid = match user_id {
        Some(id) => id,
        None => {
            let row = sqlx::query("SELECT id FROM users WHERE phone = $1 LIMIT 1")
                .bind(phone)
                .fetch_optional(db)
                .await?;
            match row {
                Some(r) => r.get("id"),
                None => {
                    return Err(anyhow::anyhow!("No user found for phone {}", phone))
                }
            }
        }
    };

    let hash = crate::pin::hash(pin)?;
    sqlx::query(
        r#"INSERT INTO ussd_pins (user_id, pin_hash, failed_attempts, created_at, updated_at)
           VALUES ($1, $2, 0, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET pin_hash=$2, failed_attempts=0, locked_until=NULL, updated_at=NOW()"#,
    )
    .bind(uid)
    .bind(hash)
    .execute(db)
    .await?;

    Ok(uid)
}

// ─── Session Persistence ─────────────────────────────────────────────────────

pub async fn save_session(
    db: &DbPool,
    session: &crate::session::UssdSessionState,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO ussd_sessions
           (session_id, phone_number, user_id, service_code, menu_path, current_menu,
            last_input, status, total_interactions, started_at, last_activity_at, ended_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, NOW(), NOW(), NOW())
           ON CONFLICT (session_id) DO UPDATE SET
           status='COMPLETED', total_interactions=$8, ended_at=NOW()"#,
    )
    .bind(&session.session_id)
    .bind(&session.phone_number)
    .bind(session.user_id)
    .bind("*347*99#")
    .bind(session.menu_path.join(">"))
    .bind(&session.current_menu)
    .bind(session.menu_path.last().map(|s| s.as_str()))
    .bind(session.interactions as i32)
    .execute(db)
    .await?;
    Ok(())
}

// ─── Loan Application ─────────────────────────────────────────────────────────

/// Apply for an input financing loan via USSD.
/// Inserts into input_financing_loans and creates a notification.
/// Returns the new loan ID on success.
pub async fn apply_loan(
    db: &DbPool,
    user_id: i32,
    input_type: &str,
    amount_ngn: f64,
    tenor_months: i32,
    description: &str,
) -> Result<i64> {
    // Resolve farmer_id: use farmer_profiles.id if exists, else fall back to user_id
    let farmer_row = sqlx::query(
        "SELECT id FROM farmer_profiles WHERE user_id = $1 LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    let farmer_id: i32 = farmer_row
        .map(|r| r.get::<i32, _>("id"))
        .unwrap_or(user_id);

    let row = sqlx::query(
        r#"INSERT INTO input_financing_loans
           (farmer_id, input_type, input_description, requested_value_ngn,
            tenor_months, repayment_method, status, created_at, updated_at)
           VALUES ($1, $2::input_type, $3, $4, $5, 'HARVEST_DEDUCTION', 'APPLIED', NOW(), NOW())
           RETURNING id"#,
    )
    .bind(farmer_id)
    .bind(input_type)
    .bind(description)
    .bind(amount_ngn)
    .bind(tenor_months)
    .fetch_one(db)
    .await?;

    let loan_id: i64 = row.get("id");

    // Insert a system notification for the user
    let _ = sqlx::query(
        r#"INSERT INTO notifications (user_id, type, title, message, read, created_at)
           VALUES ($1, 'SYSTEM', 'Loan Application Received', $2, false, NOW())"#,
    )
    .bind(user_id)
    .bind(format!(
        "Your {} loan application for ₦{:.2} (ID: {}) has been received and is under review.",
        input_type, amount_ngn, loan_id
    ))
    .execute(db)
    .await;

    Ok(loan_id)
}
