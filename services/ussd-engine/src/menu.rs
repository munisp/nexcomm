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
        "PRICE" | "PRICE_ALERT_STEP1" | "PRICE_ALERT_STEP2" => handle_price(state, session, input).await,
        "PORTFOLIO" => handle_portfolio(state, session, input).await,
        "ORDER_SIDE" => handle_order_side(session, input).await,
        "ORDER_SYM" => handle_order_symbol(session, input).await,
        "ORDER_QTY" => handle_order_qty(session, input).await,
        "ORDER_CONFIRM" => handle_order_confirm(state, session, input).await,
        "LOAN" => handle_loan(state, session, input).await,
        "LOAN_APPLY_TYPE" => handle_loan_apply_type(session, input).await,
        "LOAN_APPLY_AMOUNT" => handle_loan_apply_amount(session, input).await,
        "LOAN_APPLY_TENOR" => handle_loan_apply_tenor(session, input).await,
        "LOAN_APPLY_CONFIRM" => handle_loan_apply_confirm(state, session, input).await,
        "LOAN_APPLY_PIN" => handle_loan_apply_pin(state, session, input).await,
        "LOAN_REPAY_SELECT" => handle_loan_repay_select(state, session, input).await,
        "LOAN_REPAY_AMOUNT" => handle_loan_repay_amount(session, input).await,
        "LOAN_REPAY_PROVIDER" => handle_loan_repay_provider(session, input).await,
        "LOAN_REPAY_CONFIRM" => handle_loan_repay_confirm(session, input).await,
        "LOAN_REPAY_PIN" => handle_loan_repay_pin(state, session, input).await,
        "ACCOUNT" => handle_account(state, session, input).await,
        "ACCOUNT_BALANCE" => handle_account_balance(state, session).await,
        "ACCOUNT_MINI_STMT" => handle_account_mini_stmt(state, session).await,
        "ALERTS_LIST" => handle_alerts_list(state, session, input).await,
        "ALERTS_DELETE" => handle_alerts_delete(state, session, input).await,
        "SET_PIN" => handle_set_pin(session, input).await,
        "SET_PIN_CONFIRM" => handle_set_pin_confirm(state, session, input).await,
        _ => Ok(MenuResponse::End("Invalid session state. Please dial again.".to_string())),
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
        return Ok(MenuResponse::Continue(main_menu_text().to_string()));
    }

    match input {
        "1" => {
            session.current_menu = "PRICE".to_string();
            Ok(MenuResponse::Continue(price_menu_text().to_string()))
        }
        "2" => {
            // Portfolio requires auth
            if session.is_authenticated() {
                session.current_menu = "PORTFOLIO".to_string();
                handle_portfolio(state, session, "").await
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("PORTFOLIO".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:".to_string()))
            }
        }
        "3" => {
            // Order requires auth
            if session.is_authenticated() {
                session.current_menu = "ORDER_SIDE".to_string();
                Ok(MenuResponse::Continue("Place Order:\n1. Buy\n2. Sell\n0. Back".to_string()))
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("ORDER_SIDE".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:".to_string()))
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
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:".to_string()))
            }
        }
        "5" => {
            if session.is_authenticated() {
                session.current_menu = "ACCOUNT".to_string();
                Ok(MenuResponse::Continue(account_menu_text().to_string()))
            } else {
                session.current_menu = "AUTH".to_string();
                session.menu_path.push("ACCOUNT".to_string());
                Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:".to_string()))
            }
        }
        "0" => Ok(MenuResponse::End(
            "Thank you for using NEXCOM Exchange.\nDial *347*99# anytime.".to_string(),
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
        return Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN:".to_string()));
    }

    // Rate limit: max 3 attempts per session
    if session.auth_attempts >= 3 {
        return Ok(MenuResponse::End(
            "Too many failed attempts. Your account is temporarily locked.\nContact support: 0800-NEXCOM".to_string(),
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
                    "Incorrect PIN. Account locked for 30 minutes.\nContact support: 0800-NEXCOM".to_string(),
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
                "No PIN set. Create a 4-digit PIN:\n(You will be asked to confirm it)".to_string(),
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
    // ── Sub-state: PRICE_ALERT_STEP1 — choose ABOVE or BELOW ─────────────────
    if session.current_menu == "PRICE_ALERT_STEP1" {
        return handle_price_alert_step1(state, session, input).await;
    }
    // ── Sub-state: PRICE_ALERT_STEP2 — enter target price ────────────────────
    if session.current_menu == "PRICE_ALERT_STEP2" {
        return handle_price_alert_step2(state, session, input).await;
    }

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
            .map(|(n, _, name)| format!("{}.  {}", n, name))
            .collect::<Vec<_>>()
            .join("\n");
        return Ok(MenuResponse::Continue(format!("Select commodity:\n{}", menu)));
    }

    if input == "0" {
        session.current_menu = "MAIN".to_string();
        return Ok(MenuResponse::Continue(main_menu_text().to_string()));
    }

    let selected = commodities.iter().find(|(n, _, _)| *n == input);
    match selected {
        Some((_, symbol, name)) => {
            match db::get_live_price(&state.db, symbol).await? {
                Some(price) => {
                    let change_sign = if price.change_pct >= 0.0 { "+" } else { "" };
                    // Store context for optional alert creation (option 9)
                    session.pending_price_alert = Some(crate::session::PendingPriceAlert {
                        symbol: symbol.to_string(),
                        name: name.to_string(),
                        current_price: price.price,
                        condition: None,
                        step: 1,
                    });
                    // Show price + option to set alert
                    let auth_suffix = if session.is_authenticated() {
                        "\n9. Set Alert\n0. Back"
                    } else {
                        "\n0. Back"
                    };
                    Ok(MenuResponse::Continue(format!(
                        "{} Price\n₦{:.2}/MT\nChange: {}{}%\nHigh: ₦{:.2}\nLow: ₦{:.2}{}",
                        name,
                        price.price,
                        change_sign,
                        price.change_pct,
                        price.high,
                        price.low,
                        auth_suffix,
                    )))
                }
                None => Ok(MenuResponse::End(format!(
                    "{} price not available.\nDial *347*99# to try again.",
                    name
                ))),
            }
        }
        None => {
            // Check if user pressed 9 (Set Alert) after viewing a price
            if input == "9" {
                if let Some(ref alert) = session.pending_price_alert.clone() {
                    if !session.is_authenticated() {
                        return Ok(MenuResponse::End(
                            "Please log in to set price alerts.\nDial *347*99# to log in.".to_string(),
                        ));
                    }
                    session.current_menu = "PRICE_ALERT_STEP1".to_string();
                    return Ok(MenuResponse::Continue(format!(
                        "Set {} Alert\nCurrent: ₦{:.2}/MT\n\n1. Alert me ABOVE a price\n2. Alert me BELOW a price\n0. Cancel",
                        alert.name, alert.current_price
                    )));
                }
            }
            Ok(MenuResponse::Continue(format!(
                "Invalid option.\nSelect commodity (1-8) or 0 to go back:"
            )))
        }
    }
}

// ─── PRICE ALERT STEP 1: Choose direction ────────────────────────────────────
async fn handle_price_alert_step1(
    _state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input == "0" {
        session.current_menu = "PRICE".to_string();
        session.pending_price_alert = None;
        return Ok(MenuResponse::Continue(price_menu_text().to_string()));
    }
    let condition = match input {
        "1" => "ABOVE",
        "2" => "BELOW",
        _ => {
            return Ok(MenuResponse::Continue(
                "Invalid option.\n1. Alert ABOVE\n2. Alert BELOW\n0. Cancel".to_string(),
            ))
        }
    };
    if let Some(ref mut alert) = session.pending_price_alert {
        alert.condition = Some(condition.to_string());
        alert.step = 2;
        let direction_text = if condition == "ABOVE" { "above" } else { "below" };
        let name = alert.name.clone();
        let current = alert.current_price;
        session.current_menu = "PRICE_ALERT_STEP2".to_string();
        return Ok(MenuResponse::Continue(format!(
            "Alert when {} goes {}\nCurrent: ₦{:.2}/MT\n\nEnter target price (NGN/MT):\n0. Cancel",
            name, direction_text, current
        )));
    }
    // No pending alert context — restart
    session.current_menu = "PRICE".to_string();
    Ok(MenuResponse::Continue(price_menu_text().to_string()))
}

// ─── PRICE ALERT STEP 2: Enter target price ──────────────────────────────────
async fn handle_price_alert_step2(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input == "0" {
        session.current_menu = "PRICE".to_string();
        session.pending_price_alert = None;
        return Ok(MenuResponse::Continue(price_menu_text().to_string()));
    }
    let target: f64 = match input.trim().parse() {
        Ok(v) if v > 0.0 => v,
        _ => {
            return Ok(MenuResponse::Continue(
                "Invalid price. Enter a positive number (e.g. 45000):\n0. Cancel".to_string(),
            ))
        }
    };
    let alert = match session.pending_price_alert.clone() {
        Some(a) => a,
        None => {
            session.current_menu = "PRICE".to_string();
            return Ok(MenuResponse::Continue(price_menu_text().to_string()));
        }
    };
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    let condition = alert.condition.as_deref().unwrap_or("ABOVE");
    match db::create_price_alert(&state.db, user_id, &alert.symbol, condition, target).await {
        Ok(alert_id) => {
            session.pending_price_alert = None;
            session.current_menu = "PRICE".to_string();
            let direction_text = if condition == "ABOVE" { "above" } else { "below" };
            Ok(MenuResponse::End(format!(
                "Alert Set!\n{} {} ₦{:.2}/MT\nAlert ID: {}\n\nYou will be notified via SMS when triggered.",
                alert.name, direction_text, target, alert_id
            )))
        }
        Err(e) => {
            tracing::error!("Failed to create price alert: {:?}", e);
            Ok(MenuResponse::End(
                "Alert could not be saved.\nPlease try again later.".to_string(),
            ))
        }
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
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
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
            "No portfolio found.\nDial *347*99# to start trading.".to_string(),
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
                "Buy Order — Select commodity:\n1. MAIZE\n2. SORGHUM\n3. SOYBEANS\n4. SESAME\n5. COCOA\n0. Back".to_string(),
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
                "Sell Order — Select commodity:\n1. MAIZE\n2. SORGHUM\n3. SOYBEANS\n4. SESAME\n5. COCOA\n0. Back".to_string(),
            ))
        }
        "0" => {
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(main_menu_text().to_string()))
        }
        _ => Ok(MenuResponse::Continue(
            "Place Order:\n1. Buy\n2. Sell\n0. Back".to_string(),
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
            "Place Order:\n1. Buy\n2. Sell\n0. Back".to_string(),
        ));
    }
    let idx: usize = input.parse().unwrap_or(0);
    if idx >= 1 && idx <= symbols.len() {
        if let Some(ref mut order) = session.pending_order {
            order.symbol = Some(symbols[idx - 1].to_string());
        }
        session.current_menu = "ORDER_QTY".to_string();
        Ok(MenuResponse::Continue(
            "Enter quantity in metric tonnes (e.g. 10):".to_string(),
        ))
    } else {
        Ok(MenuResponse::Continue(
            "Invalid option. Select 1-5 or 0 to go back:".to_string(),
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
                "Invalid quantity. Enter a number between 1 and 10,000 MT:".to_string(),
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
                            "Order failed. Please try again or contact support: 0800-NEXCOM".to_string(),
                        ))
                    }
                }
            } else {
                Ok(MenuResponse::End("Session expired. Please dial again.".to_string()))
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
                Ok(MenuResponse::End("Session expired. Please dial again.".to_string()))
            }
        }
    }
}

// ─── LOAN STATUS + APPLY ─────────────────────────────────────────────────────

async fn handle_loan(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    // First call — show loan menu
    if input.is_empty() {
        return Ok(MenuResponse::Continue(loan_menu_text().to_string()));
    }
    match input {
        "1" => {
            // View existing loan status
            match db::get_loan_summary(&state.db, user_id).await? {
                Some(loan) => Ok(MenuResponse::Continue(format!(
                    "Loan Status\nBank: {}\nAmount: ₦{:.2}\nStatus: {}\nDue: {}\nBalance: ₦{:.2}\n\n0. Back",
                    loan.bank_name, loan.amount, loan.status, loan.due_date, loan.balance
                ))),
                None => Ok(MenuResponse::Continue(
                    "No active loans found.\n\n2. Apply for Loan\n0. Back".to_string(),
                )),
            }
        }
        "2" => {
            // Start loan application flow
            session.pending_loan = Some(crate::session::PendingLoan {
                input_type: None,
                amount_ngn: None,
                tenor_months: None,
                description: None,
                step: 1,
            });
            session.current_menu = "LOAN_APPLY_TYPE".to_string();
            Ok(MenuResponse::Continue(loan_type_menu_text().to_string()))
        }
        "3" => {
            // Start loan repayment flow
            session.pending_repayment = Some(crate::session::PendingRepayment {
                loan_id: None,
                amount_ngn: None,
                provider: None,
                step: 1,
            });
            session.current_menu = "LOAN_REPAY_SELECT".to_string();
            // Fetch active loans
            let user_id = session.user_id.unwrap_or(0);
            match db::get_active_loans(&state.db, user_id).await {
                Ok(loans) if !loans.is_empty() => {
                    let mut menu = "Select Loan to Repay:\n".to_string();
                    for (i, loan) in loans.iter().enumerate() {
                        menu.push_str(&format!(
                            "{}. {} ₦{:.0} ({})\n",
                            i + 1,
                            loan.bank_name,
                            loan.outstanding,
                            loan.status
                        ));
                    }
                    menu.push_str("0. Back");
                    Ok(MenuResponse::Continue(menu))
                }
                _ => {
                    session.pending_repayment = None;
                    session.current_menu = "LOAN".to_string();
                    Ok(MenuResponse::Continue(
                        "No active loans found.\n\n1. View Status\n2. Apply\n0. Back".to_string()
                    ))
                }
            }
        }
        "0" => {
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(main_menu_text().to_string()))
        }
        _ => Ok(MenuResponse::Continue(format!("Invalid option.\n{}", loan_menu_text()))),
    }
}

// ─── LOAN APPLY — STEP 1: Input Type ─────────────────────────────────────────

async fn handle_loan_apply_type(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let type_str = match input {
        "1" => "SEEDS",
        "2" => "FERTILIZER",
        "3" => "EQUIPMENT",
        "4" => "CASH",
        "5" => "STORAGE",
        "0" => {
            session.current_menu = "LOAN".to_string();
            return Ok(MenuResponse::Continue(loan_menu_text().to_string()));
        }
        _ => return Ok(MenuResponse::Continue(format!("Invalid option.\n{}", loan_type_menu_text()))),
    };
    if let Some(ref mut pl) = session.pending_loan {
        pl.input_type = Some(type_str.to_string());
        pl.step = 2;
    }
    session.current_menu = "LOAN_APPLY_AMOUNT".to_string();
    Ok(MenuResponse::Continue("Enter loan amount (NGN):\nMin: 5,000  Max: 10,000,000\nE.g. 50000".to_string()))
}

// ─── LOAN APPLY — STEP 2: Amount ─────────────────────────────────────────────

async fn handle_loan_apply_amount(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let amount: f64 = match input.trim().parse::<f64>() {
        Ok(v) if v >= 5_000.0 && v <= 10_000_000.0 => v,
        Ok(_) => return Ok(MenuResponse::Continue(
            "Amount must be between \u{20a6}5,000 and \u{20a6}10,000,000.\nEnter loan amount:".to_string()
        )),
        Err(_) => return Ok(MenuResponse::Continue(
            "Invalid amount. Enter numbers only.\nE.g. 50000".to_string()
        )),
    };
    if let Some(ref mut pl) = session.pending_loan {
        pl.amount_ngn = Some(amount);
        pl.step = 3;
    }
    session.current_menu = "LOAN_APPLY_TENOR".to_string();
    Ok(MenuResponse::Continue(
        "Select repayment period:\n1. 3 months\n2. 6 months\n3. 12 months\n4. 18 months\n5. 24 months".to_string()
    ))
}

// ─── LOAN APPLY — STEP 3: Tenor ──────────────────────────────────────────────

async fn handle_loan_apply_tenor(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let tenor: i32 = match input {
        "1" => 3,
        "2" => 6,
        "3" => 12,
        "4" => 18,
        "5" => 24,
        _ => return Ok(MenuResponse::Continue(
            "Invalid option.\nSelect period:\n1. 3mo  2. 6mo  3. 12mo  4. 18mo  5. 24mo".to_string()
        )),
    };
    if let Some(ref mut pl) = session.pending_loan {
        pl.tenor_months = Some(tenor);
        let desc = format!(
            "USSD loan application for {} — tenor {} months",
            pl.input_type.as_deref().unwrap_or("CASH"), tenor
        );
        pl.description = Some(desc);
        pl.step = 4;
    }
    session.current_menu = "LOAN_APPLY_CONFIRM".to_string();
    let summary = if let Some(ref pl) = session.pending_loan {
        format!(
            "Confirm Loan Application:\nType: {}\nAmount: ₦{:.2}\nTenor: {} months\nRepayment: Harvest Deduction\n\n1. Confirm\n2. Cancel",
            pl.input_type.as_deref().unwrap_or("-"),
            pl.amount_ngn.unwrap_or(0.0),
            pl.tenor_months.unwrap_or(6)
        )
    } else {
        "Session error. Please dial again.".to_string()
    };
    Ok(MenuResponse::Continue(summary))
}

// ─── LOAN APPLY — STEP 4: Confirm ────────────────────────────────────────────

async fn handle_loan_apply_confirm(
    _state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    match input {
        "1" => {
            session.current_menu = "LOAN_APPLY_PIN".to_string();
            Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN to confirm:".to_string()))
        }
        "2" => {
            session.pending_loan = None;
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(format!("Loan application cancelled.\n{}", main_menu_text())))
        }
        _ => Ok(MenuResponse::Continue("Invalid option.\n1. Confirm\n2. Cancel".to_string())),
    }
}

// ─── LOAN APPLY — STEP 5: PIN Verify + Submit ────────────────────────────────

async fn handle_loan_apply_pin(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    match db::verify_pin(&state.db, &session.phone_number.clone(), input).await {
        Ok(Some(_)) => {
            let loan = match session.pending_loan.take() {
                Some(l) => l,
                None => return Ok(MenuResponse::End("Session error. Please dial again.".to_string())),
            };
            let input_type = loan.input_type.as_deref().unwrap_or("CASH").to_string();
            let amount = loan.amount_ngn.unwrap_or(0.0);
            let tenor = loan.tenor_months.unwrap_or(6);
            let desc = loan.description.as_deref().unwrap_or("USSD loan application").to_string();
            match db::apply_loan(&state.db, user_id, &input_type, amount, tenor, &desc).await {
                Ok(loan_id) => {
                    let _ = state.kafka.send(
                        "loan.applied",
                        &serde_json::json!({
                            "loan_id": loan_id,
                            "user_id": user_id,
                            "input_type": input_type,
                            "amount_ngn": amount,
                            "tenor_months": tenor,
                            "source": "USSD"
                        }).to_string(),
                    ).await;
                    session.current_menu = "MAIN".to_string();
                    Ok(MenuResponse::End(format!(
                        "Loan Application Submitted!\nRef: LOAN-{}\nAmount: ₦{:.2}\nType: {}\nStatus: Under Review\n\nYou will be notified via SMS.",
                        loan_id, amount, input_type
                    )))
                }
                Err(e) => {
                    tracing::error!("USSD apply_loan failed: {}", e);
                    Ok(MenuResponse::End(
                        "Loan application failed. Please try again or visit nexcom.exchange".to_string()
                    ))
                }
            }
        }
        Ok(None) => {
            session.auth_attempts += 1;
            if session.auth_attempts >= 3 {
                session.pending_loan = None;
                Ok(MenuResponse::End("Too many incorrect PINs. Application cancelled.".to_string()))
            } else {
                Ok(MenuResponse::Continue(format!(
                    "Incorrect PIN. {} attempt(s) remaining.\nEnter PIN:",
                    3 - session.auth_attempts
                )))
            }
        }
        Err(_) => Ok(MenuResponse::End(
            "PIN verification failed. Please set your PIN first via Account menu.".to_string()
        )),
    }
}

// ─── ACCOUNT MANAGEMENT ──────────────────────────────────────────────────────

async fn handle_account(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input.is_empty() {
        return Ok(MenuResponse::Continue(account_menu_text().to_string()));
    }
    match input {
        "1" => {
            session.current_menu = "ACCOUNT_BALANCE".to_string();
            handle_account_balance(state, session).await
        }
        "2" => {
            session.current_menu = "ACCOUNT_MINI_STMT".to_string();
            handle_account_mini_stmt(state, session).await
        }
        "3" => {
            session.current_menu = "SET_PIN".to_string();
            session.pending_pin = Some(PendingPin { new_pin: None, step: 1 });
            Ok(MenuResponse::Continue("Enter new 4-digit PIN:".to_string()))
        }
        "4" => Ok(MenuResponse::End(
            "USSD alerts disabled.\nRe-enable at nexcom.exchange/settings".to_string(),
        )),
        "5" => {
            session.current_menu = "ALERTS_LIST".to_string();
            handle_alerts_list(state, session, "").await
        }
        "0" => {
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(main_menu_text().to_string()))
        }
        _ => Ok(MenuResponse::Continue(format!(
            "Invalid option.\n{}",
            account_menu_text()
        ))),
    }
}

async fn handle_account_balance(
    state: &AppState,
    session: &mut UssdSessionState,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    let bal = db::get_wallet_balance(&state.db, user_id).await
        .unwrap_or(db::WalletBalance {
            cash_balance: 0.0,
            portfolio_value: 0.0,
            active_loans: 0,
            outstanding_loan_balance: 0.0,
        });
    session.current_menu = "ACCOUNT".to_string();
    Ok(MenuResponse::Continue(format!(
        "Account Balance\nCash: ₦{:.2}\nPortfolio: ₦{:.2}\nActive Loans: {}\nLoan Balance: ₦{:.2}\n\n0. Back",
        bal.cash_balance, bal.portfolio_value, bal.active_loans, bal.outstanding_loan_balance
    )))
}

async fn handle_account_mini_stmt(
    state: &AppState,
    session: &mut UssdSessionState,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    let lines = db::get_mini_statement(&state.db, user_id).await
        .unwrap_or_default();
    session.current_menu = "ACCOUNT".to_string();
    if lines.is_empty() {
        return Ok(MenuResponse::Continue(
            "No recent transactions found.\n\n0. Back".to_string(),
        ));
    }
    let mut msg = String::from("Mini-Statement (last 5):\n");
    for l in &lines {
        msg.push_str(&format!(
            "{} {} ₦{:.0} {}\n",
            l.date, l.description, l.amount, l.direction
        ));
    }
    msg.push_str("\n0. Back");
    Ok(MenuResponse::Continue(msg))
}

// ─── PIN MANAGEMENT ──────────────────────────────────────────────────────────

async fn handle_set_pin(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input.len() != 4 || input.chars().any(|c| !c.is_ascii_digit()) {
        return Ok(MenuResponse::Continue(
            "PIN must be exactly 4 digits.\nEnter new PIN:".to_string(),
        ));
    }
    if let Some(ref mut pp) = session.pending_pin {
        pp.new_pin = Some(input.to_string());
        pp.step = 2;
    }
    session.current_menu = "SET_PIN_CONFIRM".to_string();
    Ok(MenuResponse::Continue("Confirm new PIN:".to_string()))
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
                        "Failed to set PIN. Please try again later.".to_string(),
                    ))
                }
            }
        } else {
            session.pending_pin = Some(PendingPin { new_pin: pp.new_pin, step: 2 });
            session.current_menu = "SET_PIN".to_string();
            Ok(MenuResponse::Continue("PINs do not match.\nEnter new PIN:".to_string()))
        }
    } else {
        Ok(MenuResponse::End("Session expired. Please dial again.".to_string()))
    }
}

// ─── LOAN REPAYMENT — STEP 1: Select Loan ────────────────────────────────────

async fn handle_loan_repay_select(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input == "0" {
        session.pending_repayment = None;
        session.current_menu = "LOAN".to_string();
        return Ok(MenuResponse::Continue(loan_menu_text().to_string()));
    }
    let user_id = session.user_id.unwrap_or(0);
    let loans = db::get_active_loans(&state.db, user_id).await.unwrap_or_default();
    let idx: usize = match input.parse::<usize>() {
        Ok(n) if n >= 1 && n <= loans.len() => n - 1,
        _ => {
            return Ok(MenuResponse::Continue(
                "Invalid selection. Enter the loan number or 0 to go back.".to_string()
            ));
        }
    };
    let loan = &loans[idx];
    if let Some(ref mut pr) = session.pending_repayment {
        pr.loan_id = Some(loan.id);
        pr.step = 2;
    }
    session.current_menu = "LOAN_REPAY_AMOUNT".to_string();
    Ok(MenuResponse::Continue(format!(
        "Loan #{}: {}\nOutstanding: ₦{:.2}\nDue: {}\n\nEnter repayment amount (NGN):",
        loan.id, loan.bank_name, loan.outstanding, loan.due_date
    )))
}

// ─── LOAN REPAYMENT — STEP 2: Enter Amount ───────────────────────────────────

async fn handle_loan_repay_amount(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let amount: f64 = match input.trim().parse::<f64>() {
        Ok(v) if v >= 100.0 => v,
        Ok(_) => return Ok(MenuResponse::Continue(
            "Minimum repayment is \u{20a6}100.\nEnter amount:".to_string()
        )),
        Err(_) => return Ok(MenuResponse::Continue(
            "Invalid amount. Enter numbers only.\nE.g. 5000".to_string()
        )),
    };
    if let Some(ref mut pr) = session.pending_repayment {
        pr.amount_ngn = Some(amount);
        pr.step = 3;
    }
    session.current_menu = "LOAN_REPAY_PROVIDER".to_string();
    Ok(MenuResponse::Continue(
        "Select Mobile Money Provider:\n1. MTN MoMo\n2. Airtel Money\n3. Glo Pay\n4. 9Mobile\n0. Cancel".to_string()
    ))
}

// ─── LOAN REPAYMENT — STEP 3: Select Provider ────────────────────────────────

async fn handle_loan_repay_provider(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    if input == "0" {
        session.pending_repayment = None;
        session.current_menu = "MAIN".to_string();
        return Ok(MenuResponse::Continue(format!("Repayment cancelled.\n{}", main_menu_text())));
    }
    let provider = match input {
        "1" => "MTN MoMo",
        "2" => "Airtel Money",
        "3" => "Glo Pay",
        "4" => "9Mobile",
        _ => return Ok(MenuResponse::Continue(
            "Invalid option.\n1. MTN  2. Airtel  3. Glo  4. 9Mobile  0. Cancel".to_string()
        )),
    };
    if let Some(ref mut pr) = session.pending_repayment {
        pr.provider = Some(provider.to_string());
        pr.step = 4;
    }
    session.current_menu = "LOAN_REPAY_CONFIRM".to_string();
    let summary = if let Some(ref pr) = session.pending_repayment {
        format!(
            "Confirm Repayment:\nLoan ID: #{}\nAmount: ₦{:.2}\nProvider: {}\n\n1. Confirm & Enter PIN\n2. Cancel",
            pr.loan_id.unwrap_or(0),
            pr.amount_ngn.unwrap_or(0.0),
            pr.provider.as_deref().unwrap_or("-")
        )
    } else {
        "Session error. Please dial again.".to_string()
    };
    Ok(MenuResponse::Continue(summary))
}

// ─── LOAN REPAYMENT — STEP 4: Confirm ────────────────────────────────────────

async fn handle_loan_repay_confirm(
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    match input {
        "1" => {
            session.current_menu = "LOAN_REPAY_PIN".to_string();
            Ok(MenuResponse::Continue("Enter your 4-digit USSD PIN to authorise payment:".to_string()))
        }
        "2" => {
            session.pending_repayment = None;
            session.current_menu = "MAIN".to_string();
            Ok(MenuResponse::Continue(format!("Repayment cancelled.\n{}", main_menu_text())))
        }
        _ => Ok(MenuResponse::Continue("Invalid option.\n1. Confirm & Enter PIN\n2. Cancel".to_string())),
    }
}

// ─── LOAN REPAYMENT — STEP 5: PIN Verify + Submit ────────────────────────────

async fn handle_loan_repay_pin(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    match db::verify_pin(&state.db, &session.phone_number.clone(), input).await {
        Ok(Some(_)) => {
            let pr = match session.pending_repayment.take() {
                Some(p) => p,
                None => return Ok(MenuResponse::End("Session error. Please dial again.".to_string())),
            };
            let loan_id = pr.loan_id.unwrap_or(0);
            let amount = pr.amount_ngn.unwrap_or(0.0);
            let provider = pr.provider.as_deref().unwrap_or("MTN MoMo");
            let phone = session.phone_number.clone();
            match db::make_repayment(&state.db, user_id, loan_id, amount, provider, &phone).await {
                Ok(reference) => {
                    let _ = state.kafka.send(
                        "loan.repayment",
                        &serde_json::json!({
                            "loan_id": loan_id,
                            "user_id": user_id,
                            "amount_ngn": amount,
                            "provider": provider,
                            "reference": reference,
                            "source": "USSD"
                        }).to_string(),
                    ).await;
                    session.current_menu = "MAIN".to_string();
                    Ok(MenuResponse::End(format!(
                        "Repayment Initiated!\nRef: {}\nAmount: ₦{:.2}\nProvider: {}\n\nYou will receive an SMS confirmation shortly.",
                        reference, amount, provider
                    )))
                }
                Err(e) => {
                    tracing::error!("USSD make_repayment failed: {}", e);
                    Ok(MenuResponse::End(
                        "Repayment failed. Please try again or visit nexcom.exchange".to_string()
                    ))
                }
            }
        }
        Ok(None) => {
            session.auth_attempts += 1;
            if session.auth_attempts >= 3 {
                session.pending_repayment = None;
                Ok(MenuResponse::End("Too many incorrect PINs. Repayment cancelled.".to_string()))
            } else {
                Ok(MenuResponse::Continue(format!(
                    "Incorrect PIN. {} attempt(s) remaining.\nEnter PIN:",
                    3 - session.auth_attempts
                )))
            }
        }
        Err(_) => Ok(MenuResponse::End(
            "PIN verification failed. Please set your PIN first via Account menu.".to_string()
        )),
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn main_menu_text() -> &'static str {
    "NEXCOM Exchange\n1. Price Check\n2. My Portfolio\n3. Place Order\n4. Loans\n5. Account\n0. Exit"
}

fn loan_menu_text() -> &'static str {
    "Loans:\n1. View Loan Status\n2. Apply for Loan\n3. Make Repayment\n0. Back"
}

fn loan_type_menu_text() -> &'static str {
    "Select Loan Type:\n1. Seeds\n2. Fertilizer\n3. Equipment\n4. Cash\n5. Storage\n0. Back"
}

fn price_menu_text() -> &'static str {
    "Price Check:\n1. Maize\n2. Sorghum\n3. Soybeans\n4. Sesame\n5. Cocoa\n6. Cotton\n7. Ginger\n8. Groundnut\n0. Back"
}

fn account_menu_text() -> &'static str {
    "Account:\n1. Balance\n2. Mini-Statement\n3. Change PIN\n4. Disable Alerts\n5. My Alerts\n0. Back"
}

// ─── MY ALERTS ───────────────────────────────────────────────────────────────

async fn handle_alerts_list(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };

    if input == "0" {
        session.current_menu = "ACCOUNT".to_string();
        return Ok(MenuResponse::Continue(account_menu_text().to_string()));
    }

    // If user enters a number, treat it as "select alert at position N to delete"
    if !input.is_empty() {
        if let Ok(pos) = input.parse::<usize>() {
            let alerts = db::list_price_alerts(&state.db, user_id).await.unwrap_or_default();
            if pos >= 1 && pos <= alerts.len() {
                let alert = &alerts[pos - 1];
                session.pending_delete_alert_id = Some(alert.id);
                session.current_menu = "ALERTS_DELETE".to_string();
                let cond = if alert.condition == "ABOVE" { "above" } else { "below" };
                return Ok(MenuResponse::Continue(format!(
                    "Delete alert #{}?\n{} {} ₦{:.0}/MT\n\n1. Confirm\n0. Cancel",
                    alert.id, alert.symbol, cond, alert.target_price
                )));
            }
        }
    }

    let alerts = db::list_price_alerts(&state.db, user_id).await.unwrap_or_default();
    if alerts.is_empty() {
        session.current_menu = "ACCOUNT".to_string();
        return Ok(MenuResponse::Continue(
            "No active price alerts.\nSet one from the Price menu (option 9).\n\n0. Back".to_string(),
        ));
    }

    let mut msg = String::from("My Alerts (tap to delete):\n");
    for (i, a) in alerts.iter().enumerate() {
        let cond = if a.condition == "ABOVE" { "\u{2191}" } else { "\u{2193}" };
        msg.push_str(&format!(
            "{}. {} {} ₦{:.0}\n",
            i + 1, a.symbol, cond, a.target_price
        ));
    }
    msg.push_str("0. Back");
    session.current_menu = "ALERTS_LIST".to_string();
    Ok(MenuResponse::Continue(msg))
}

async fn handle_alerts_delete(
    state: &AppState,
    session: &mut UssdSessionState,
    input: &str,
) -> Result<MenuResponse> {
    let user_id = match session.user_id {
        Some(id) => id,
        None => return Ok(MenuResponse::End("Session expired. Please dial again.".to_string())),
    };
    let alert_id = match session.pending_delete_alert_id {
        Some(id) => id,
        None => {
            session.current_menu = "ALERTS_LIST".to_string();
            return handle_alerts_list(state, session, "").await;
        }
    };

    match input {
        "1" => {
            let deleted = db::delete_price_alert(&state.db, user_id, alert_id)
                .await
                .unwrap_or(false);
            session.pending_delete_alert_id = None;
            session.current_menu = "ALERTS_LIST".to_string();
            let msg = if deleted {
                format!("Alert #{} deleted.\n\n0. Back", alert_id)
            } else {
                format!("Alert #{} not found.\n\n0. Back", alert_id)
            };
            Ok(MenuResponse::Continue(msg))
        }
        _ => {
            // Cancel or invalid — go back to list
            session.pending_delete_alert_id = None;
            session.current_menu = "ALERTS_LIST".to_string();
            handle_alerts_list(state, session, "").await
        }
    }
}

/// Extract the latest user input from the accumulated AT text field
/// AT sends cumulative input separated by '*' (e.g. "1*2*500")
fn extract_latest_input(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    text.split('*').last().unwrap_or("").trim().to_string()
}
