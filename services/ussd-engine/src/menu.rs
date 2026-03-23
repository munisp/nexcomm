/*!
 * USSD Menu State Machine
 * =======================
 * Handles the full menu tree for NEXCOM USSD service (*347*99#).
 *
 * Menu nodes:
 *   MAIN        → root menu
 *   AUTH        → PIN authentication gate (required for portfolio/order/loan)
 *   PRICE       → commodity price check (public, no auth required)
 *   PORTFOLIO   → user's positions summary
 *   ORDER       → place buy/sell order
 *   ORDER_SIDE  → choose BUY or SELL
 *   ORDER_SYM   → choose commodity symbol
 *   ORDER_QTY   → enter quantity
 *   ORDER_CONFIRM → confirm order
 *   LOAN        → active loan status
 *   ACCOUNT     → account management
 *   SET_PIN     → set/change USSD PIN
 *   SET_PIN_CONFIRM → confirm new PIN
 */

use anyhow::Result;
use tracing::info;

use crate::db::{self, DbPool};
use crate::kafka::KafkaProducer;
use crate::pin;
use crate::session::{PendingOrder, PendingPin, SessionStore, UssdSessionState};
use crate::AppState;
use crate::UssdRequest;

pub enum MenuResponse {
    Continue(String),
    End(String),
}

/// Entry point: parse the AT text field and route to the correct menu handler
pub async fn handle_input(state: &AppState, req: &UssdRequest) -> Result<MenuResponse> {
    let mut sessions = state.sessions.clone();

    // Load or create session state
    let mut session = match sessions.get(&req.session_id).await? {
        Some(s) => s,
        None => UssdSessionState::new(&req.session_id, &req.phone_number),
    };
    session.interactions += 1;

    // Parse the current input (last segment of the accumulated text)
    let input = extract_latest_input(&req.text);

    info!(
        session_id = %req.session_id,
        phone = %req.phone_number,
        menu = %session.current_menu,
        input = %input,
        "USSD input"
    );

    let response = route_input(state, &mut session, &input).await?;

    // Persist updated session state (or delete if ended)
    match &response {
        MenuResponse::Continue(_) => sessions.set(&session).await?,
        MenuResponse::End(_) => {
            // Persist completed session to DB
            db::save_session(&state.db, &session).await.ok();
            // Emit Kafka event
            state.kafka.emit_session_completed(&session).await.ok();
            sessions.delete(&req.session_id).await.ok();
        }
    }

    Ok(response)
}

/// Route the current input to the appropriate menu handler
async fn route_input(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    match session.current_menu.as_str() {
        "MAIN" | "" => handle_main(state, session, input).await,
        "AUTH" => handle_auth(state, session, input).await,
        "PRICE" => handle_price(state, session, input).await,
        "PORTFOLIO" => handle_portfolio(state, session, input).await,
        "ORDER_SIDE" => handle_order_side(session, input).await,
        "ORDER_SYM" => handle_order_symbol(session, input).await,
        "ORDER_QTY" => handle_order_qty(session, input).await,
        "ORDER_CONFIRM" => handle_order_confirm(state, session, input).await,
        "LOAN" => handle_loan(state, session, input).await,
        "ACCOUNT" => handle_account(session, input).await,
        "SET_PIN" => handle_set_pin(session, input).await,
        "SET_PIN_CONFIRM" => handle_set_pin_confirm(state, session, input).await,
        _ => Ok(MenuResponse::End("Invalid session state. Please dial again.")),
    }
}

// ─── MAIN MENU ────────────────────────────────────────────────────────────────

async fn handle_main(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    // First call — show main menu
    if input.is_empty() {
        return Ok(MenuResponse::Continue(main_menu_text()));
    }

    match input {
        "1" => {
            session.current_menu = "PRICE".to_string();
            Ok(MenuResponse::Continue(price_menu_text()))
        }
        "2" => {
            // Portfolio requires auth
            if session.is_authenticated() {
                session.current_menu = "PORTFOLIO".to_string();
                handle_portfolio(state, session, "").await
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("PORTFOLIO".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:"))
            }
        }
        "3" => {
            // Order requires auth
            if session.is_authenticated() {
                session.current_menu = "ORDER_SIDE".to_string();
                Ok(MenuResponse::Continue("Place Order:\n1. Buy\n2. Sell\n0. Back"))
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("ORDER_SIDE".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:"))
            }
        }
        "4" => {
            // Loan status requires auth
            if session.is_authenticated() {
                session.current_menu = "LOAN".to_string();
                handle_loan(state, session, "").await
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("LOAN".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:"))
            }
        }
        "5" => {
            if session.is_authenticated() {
                session.current_menu = "ACCOUNT".to_string();
                Ok(MenuResponse::Continue(account_menu_text()))
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("ACCOUNT".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:"))
            }
        }
        "0" => Ok(MenuResponse::End(
            "Thank you for using NEXCOM Exchange.\nDial *347*99# anytime.",
        )),
        _ => Ok(MenuResponse::Continue(format!(
            "Invalid option.\n{}",
            main_menu_text()
        ))),
    }
}

// ─── PIN AUTHENTICATION ───────────────────────────────────────────────────────

async fn handle_auth(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input.is_empty() {
        return Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:"));
    }

    // Rate limit: max 3 attempts per session
    if session.auth_attempts >= 3 {
        return Ok(MenuResponse::End(
            "Too many failed attempts. Your account is temporarily locked.\nContact support: 0800-NEXCOM",
        ));
    }

    let phone = session.phone_number.clone();
    match db::verify_pin(&state.db, &phone, input).await {
        Ok(Some(user_id)) => {
            session.user_id = Some(user_id);
            session.auth_attempts = 0;
            // Navigate to the menu that triggered auth
            let next_menu = session.menu_path.pop().unwrap_or_else(|| "MAIN".to_string());
            session.current_menu = next_menu.clone();
            // Immediately render the target menu
            Box::pin(route_input(state, session, "")).await
        }
        Ok(None) => {
            session.auth_attempts += 1;
            let remaining = 3 - session.auth_attempts;
            if remaining == 0 {
                Ok(MenuResponse::End(
                    "Incorrect PIN. Account locked for 30 minutes.\nContact support: 0800-NEXCOM",
                ))
            } else {
                Ok(MenuResponse::Continue(format!(
                    "Incorrect PIN. {} attempt(s) remaining.\nEnter PIN:",
                    remaining
                )))
            }
        }
        Err(_) => {
            // No PIN set yet — prompt to set one
            session.current_menu = "SET_PIN".to_string();
            session.pending_pin = Some(PendingPin { new_pin: None, step: 1 });
            Ok(MenuResponse::Continue(
                "No PIN set. Create a 4-digit PIN:\n(You will be asked to confirm it)",
            ))
        }
    }
}

// ─── PRICE CHECK ─────────────────────────────────────────────────────────────

async fn handle_price(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    // Commodity list
    let commodities = vec![
        ("1", "MAIZE", "Maize"),
        ("2", "SORGHUM", "Sorghum"),
        ("3", "SOYBEANS", "Soybeans"),
        ("4", "SESAME", "Sesame"),
        ("5", "COCOA", "Cocoa"),
        ("6", "COTTON", "Cotton"),
        ("7", "GINGER", "Ginger"),
        ("8", "GROUNDNUT", "Groundnut"),
        ("0", "", "Back"),
    ];

    if input.is_empty() {
        let menu = commodities
            .iter()
            .map(|(n, _, name)| format!("{}. {}", n, name))
            .collect::<Vec<_>>()
            .join("\n");
        return Ok(MenuResponse::Continue(format!("Select commodity:\n{}", menu)));
    }

    if input == "0" {
        session.current_menu = "MAIN".to_string();
        return Ok(MenuResponse::Continue(main_menu_text()));
    }

    let selected = commodities.iter().find(|(n, _, _)| *n == input);
    match selected {
        Some((_, symbol, name)) => {
            match db::get_live_price(&state.db, symbol).await? {
                Some(price) => {
                    let change_sign = if price.change_pct >= 0.0 { "+" } else { "" };
                    Ok(MenuResponse::End(format!(
                        "{} Price\n₦{:.2}/MT\nChange: {}{}%\nHigh: ₦{:.2}\nLow: ₦{:.2}\n\nDial *347*99# to trade",
                        name,
                        price.price,
                        change_sign,
                        price.change_pct,
                        price.high,
                        price.low
                    )))
                }
                None => Ok(MenuResponse::End(format!(
                    "{} price not available.\nDial *347*99# to try again.",
                    name
                ))),
            }
        }
        None => Ok(MenuResponse::Continue(format!(
            "Invalid option.\nSelect commodity (1-8) or 0 to go back:"
        ))),
    }
}

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────

async fn handle_portfolio(
    state: &AppState,
    session: &mut UssdSessionState,
    _input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.")),
    };

    match db::get_portfolio_summary(&state.db, user_id).await? {
        Some(summary) => {
            let pnl_sign = if summary.total_pnl >= 0.0 { "+" } else { "" };
            Ok(MenuResponse::End(format!(
                "My Portfolio\nValue: ₦{:.2}\nP&L: {}₦{:.2}\nPositions: {}\nOpen Orders: {}\n\nDial *347*99# to trade",
                summary.total_value,
                pnl_sign,
                summary.total_pnl,
                summary.position_count,
                summary.open_order_count
            )))
        }
        None => Ok(MenuResponse::End(
            "No portfolio found.\nDial *347*99# to start trading.",
        )),
    }
}

// ─── ORDER PLACEMENT ─────────────────────────────────────────────────────────

async fn handle_order_side(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    match input {
        "1" => {
            session.pending_order = Some(PendingOrder {
                side: "BUY".to_string(),
                symbol: None,
                quantity: None,
            });
            session.current_menu = "ORDER_SYM".to_string();
            Ok(MenuResponse::Continue(
                "Buy Order — Select commodity:\n1. MAIZE\n2. SORGHUM\n3. SOYBEANS\n4. SESAME\n5. COCOA\n0. Back",
            ))
        }
        "2" => {
            session.pending_order = Some(PendingOrder {
                side: "SELL".to_string(),
                symbol: None,
                quantity: None,
            });
            session.current_menu = "ORDER_SYM".to_string();
            Ok(MenuResponse::Continue(
                "Sell Order — Select commodity:\n1. MAIZE\n2. SORGHUM\n3. SOYBEANS\n4. SESAME\n5. COCOA\n0. Back",
            ))
        }
        "0" => {
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(main_menu_text()))
        }
        _ => Ok(MenuResponse::Continue(
            "Place Order:\n1. Buy\n2. Sell\n0. Back",
        )),
    }
}

async fn handle_order_symbol(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let symbols = ["MAIZE", "SORGHUM", "SOYBEANS", "SESAME", "COCOA"];
    if input == "0" {
        session.current_menu = "ORDER_SIDE".to_string();
        return Ok(MenuResponse::Continue(
            "Place Order:\n1. Buy\n2. Sell\n0. Back",
        ));
    }
    let idx: usize = input.parse().unwrap_or(0);
    if idx >= 1 && idx <= symbols.len() {
        if let Some(ref mut order) = session.pending_order {
            order.symbol = Some(symbols[idx - 1].to_string());
        }
        session.current_menu = "ORDER_QTY".to_string();
        Ok(MenuResponse::Continue(
            "Enter quantity in metric tonnes (e.g. 10):",
        ))
    } else {
        Ok(MenuResponse::Continue(
            "Invalid option. Select 1-5 or 0 to go back:",
        ))
    }
}

async fn handle_order_qty(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let qty: f64 = match input.parse() {
        Ok(q) if q > 0.0 && q <= 10_000.0 => q,
        _ => {
            return Ok(MenuResponse::Continue(
                "Invalid quantity. Enter a number between 1 and 10,000 MT:",
            ))
        }
    };

    if let Some(ref mut order) = session.pending_order {
        order.quantity = Some(qty);
    }
    session.current_menu = "ORDER_CONFIRM".to_string();

    let order = session.pending_order.as_ref().unwrap();
    Ok(MenuResponse::Continue(format!(
        "Confirm Order:\n{} {} {}MT\n\n1. Confirm\n2. Cancel",
        order.side,
        order.symbol.as_deref().unwrap_or("?"),
        qty
    )))
}

async fn handle_order_confirm(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    match input {
        "1" => {
            let user_id = session.user_id.unwrap_or(0);
            let order = session.pending_order.take();
            if let Some(o) = order {
                match db::place_ussd_order(
                    &state.db,
                    user_id,
                    &o.side,
                    o.symbol.as_deref().unwrap_or(""),
                    o.quantity.unwrap_or(0.0),
                )
                .await
                {
                    Ok(order_id) => {
                        state.kafka.emit_order_placed(user_id, &o.side, o.symbol.as_deref().unwrap_or(""), o.quantity.unwrap_or(0.0), order_id).await.ok();
                        session.current_menu = "MAIN".to_string();
                        Ok(MenuResponse::End(format!(
                            "Order placed!\nRef: #{}\n{} {} {}MT\n\nYou will receive an SMS confirmation.\nDial *347*99# to check status.",
                            order_id,
                            o.side,
                            o.symbol.as_deref().unwrap_or(""),
                            o.quantity.unwrap_or(0.0)
                        )))
                    }
                    Err(e) => {
                        tracing::error!("Order placement failed: {}", e);
                        Ok(MenuResponse::End(
                            "Order failed. Please try again or contact support: 0800-NEXCOM",
                        ))
                    }
                }
            } else {
                Ok(MenuResponse::End("Session expired. Please dial again."))
            }
        }
        "2" => {
            session.pending_order = None;
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(format!(
                "Order cancelled.\n{}",
                main_menu_text()
            )))
        }
        _ => {
            let order = session.pending_order.as_ref();
            if let Some(o) = order {
                Ok(MenuResponse::Continue(format!(
                    "Confirm Order:\n{} {} {}MT\n\n1. Confirm\n2. Cancel",
                    o.side,
                    o.symbol.as_deref().unwrap_or("?"),
                    o.quantity.unwrap_or(0.0)
                )))
            } else {
                Ok(MenuResponse::End("Session expired. Please dial again."))
            }
        }
    }
}

// ─── LOAN STATUS ─────────────────────────────────────────────────────────────

async fn handle_loan(
    state: &AppState,
    session: &mut UssdSessionState,
    _input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.")),
    };

    match db::get_loan_summary(&state.db, user_id).await? {
        Some(loan) => Ok(MenuResponse::End(format!(
            "Loan Status\nBank: {}\nAmount: ₦{:.2}\nStatus: {}\nDue: {}\nBalance: ₦{:.2}\n\nDial *347*99# for more",
            loan.bank_name,
            loan.amount,
            loan.status,
            loan.due_date,
            loan.balance
        ))),
        None => Ok(MenuResponse::End(
            "No active loans found.\nVisit nexcom.exchange to apply for financing.",
        )),
    }
}

// ─── ACCOUNT MANAGEMENT ──────────────────────────────────────────────────────

async fn handle_account(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input.is_empty() {
        return Ok(MenuResponse::Continue(account_menu_text()));
    }
    match input {
        "1" => Ok(MenuResponse::End(
            "Visit nexcom.exchange/banking to view your full account balance.",
        )),
        "2" => {
            session.current_menu = "SET_PIN".to_string();
            session.pending_pin = Some(PendingPin { new_pin: None, step: 1 });
            Ok(MenuResponse::Continue("Enter new 4-digit PIN:"))
        }
        "3" => Ok(MenuResponse::End(
            "USSD alerts disabled.\nRe-enable at nexcom.exchange/settings",
        )),
        "0" => {
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(main_menu_text()))
        }
        _ => Ok(MenuResponse::Continue(format!(
            "Invalid option.\n{}",
            account_menu_text()
        ))),
    }
}

// ─── PIN MANAGEMENT ──────────────────────────────────────────────────────────

async fn handle_set_pin(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input.len() != 4 || input.chars().any(|c| !c.is_ascii_digit()) {
        return Ok(MenuResponse::Continue(
            "PIN must be exactly 4 digits.\nEnter new PIN:",
        ));
    }
    if let Some(ref mut pp) = session.pending_pin {
        pp.new_pin = Some(input.to_string());
        pp.step = 2;
    }
    session.current_menu = "SET_PIN_CONFIRM".to_string();
    Ok(MenuResponse::Continue("Confirm new PIN:"))
}

async fn handle_set_pin_confirm(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let pending = session.pending_pin.take();
    if let Some(pp) = pending {
        if pp.new_pin.as_deref() == Some(input) {
            let phone = session.phone_number.clone();
            let user_id = session.user_id;
            match db::set_pin(&state.db, &phone, user_id, input).await {
                Ok(uid) => {
                    session.user_id = Some(uid);
                    session.current_menu = "MAIN".to_string();
                    Ok(MenuResponse::Continue(format!(
                        "PIN set successfully!\n{}",
                        main_menu_text()
                    )))
                }
                Err(e) => {
                    tracing::error!("PIN set failed: {}", e);
                    Ok(MenuResponse::End(
                        "Failed to set PIN. Please try again later.",
                    ))
                }
            }
        } else {
            session.pending_pin = Some(PendingPin { new_pin: pp.new_pin, step: 2 });
            session.current_menu = "SET_PIN".to_string();
            Ok(MenuResponse::Continue("PINs do not match.\nEnter new PIN:"))
        }
    } else {
        Ok(MenuResponse::End("Session expired. Please dial again."))
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn main_menu_text() -> &'static str {
    "NEXCOM Exchange\n1. Price Check\n2. My Portfolio\n3. Place Order\n4. Loan Status\n5. Account\n0. Exit"
}

fn price_menu_text() -> &'static str {
    "Price Check:\n1. Maize\n2. Sorghum\n3. Soybeans\n4. Sesame\n5. Cocoa\n6. Cotton\n7. Ginger\n8. Groundnut\n0. Back"
}

fn account_menu_text() -> &'static str {
    "Account:\n1. Balance\n2. Change PIN\n3. Disable Alerts\n0. Back"
}

/// Extract the latest user input from the accumulated AT text field
/// AT sends cumulative input separated by '*' (e.g. "1*2*500")
fn extract_latest_input(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    text.split('*').last().unwrap_or("").trim().to_string()
}
