use postgres::{Client, NoTls};
use std::collections::HashSet;

fn get_dsn() -> String {
    std::env::var("NEXCOM_SCHEMA_DSN")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .unwrap_or_else(|_| "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom".to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dsn = if let Some(pos) = args.iter().position(|a| a == "--dsn") {
        args.get(pos + 1).cloned().unwrap_or_else(get_dsn)
    } else { get_dsn() };

    let expected_tables_arg = args.iter().position(|a| a == "--expected-tables")
        .and_then(|p| args.get(p + 1)).cloned();

    println!("NEXCOM Exchange — Schema Drift Validator");

    let mut client = match Client::connect(&dsn, NoTls) {
        Ok(c) => c,
        Err(e) => { eprintln!("ERROR: Failed to connect: {}", e); std::process::exit(1); }
    };

    let tables: Vec<String> = client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name", &[])
        .unwrap_or_default().iter().map(|r| r.get::<_,String>(0)).collect();
    let table_set: HashSet<&str> = tables.iter().map(|s| s.as_str()).collect();

    let col_count: i64 = client.query_one("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'", &[]).map(|r| r.get(0)).unwrap_or(0);
    let con_count: i64 = client.query_one("SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='public'", &[]).map(|r| r.get(0)).unwrap_or(0);
    let idx_count: i64 = client.query_one("SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public'", &[]).map(|r| r.get(0)).unwrap_or(0);
    let enum_count: i64 = client.query_one("SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typtype='e' AND n.nspname='public'", &[]).map(|r| r.get(0)).unwrap_or(0);

    println!("\n=== SCHEMA SUMMARY ===");
    println!("  Tables      : {}", tables.len());
    println!("  Columns     : {}", col_count);
    println!("  Constraints : {}", con_count);
    println!("  Indexes     : {}", idx_count);
    println!("  Enum types  : {}", enum_count);

    let baseline: Vec<&str> = if let Some(ref arg) = expected_tables_arg {
        arg.split(',').collect()
    } else {
        vec!["users","profiles","watchlist","price_alerts","notifications","audit_log",
             "live_prices","orders","trades","settlements","bank_transactions","loans",
             "farms","farmers","warehouses","commodity_grades","instruments","trade_fills","kyc_queue"]
    };

    println!("\n=== BASELINE VALIDATION ===");
    let mut errors = 0; let mut warnings = 0; let mut info_count = 0;
    for expected in &baseline {
        if table_set.contains(*expected) { println!("  [INFO] + {}", expected); info_count += 1; }
        else { println!("  [ERROR] MISSING: {}", expected); errors += 1; }
    }

    let baseline_set: HashSet<&str> = baseline.iter().copied().collect();
    let extra: Vec<&str> = tables.iter().map(|s| s.as_str()).filter(|t| !baseline_set.contains(*t)).collect();
    println!("\n  {} extra tables beyond baseline", extra.len());

    if tables.len() < 50 { println!("  [WARN] Only {} tables (expected >=50)", tables.len()); warnings += 1; }
    if enum_count < 20 { println!("  [WARN] Only {} enums (expected >=20)", enum_count); warnings += 1; }
    if idx_count < 50 { println!("  [WARN] Only {} indexes (expected >=50)", idx_count); warnings += 1; }

    println!("\n=== RESULT ===");
    println!("  {} errors, {} warnings, {} info", errors, warnings, info_count);
    if errors > 0 { println!("  STATUS: SCHEMA_INVALID"); std::process::exit(2); }
    else if warnings > 0 { println!("  STATUS: DRIFT_DETECTED"); std::process::exit(1); }
    else { println!("  STATUS: OK"); }
}
