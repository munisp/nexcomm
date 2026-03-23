/*!
 * USSD PIN hashing and verification using bcrypt.
 * Cost factor 10 is appropriate for a 4-digit PIN (fast enough for USSD latency).
 */

use anyhow::Result;

pub fn hash(pin: &str) -> Result<String> {
    let hashed = bcrypt::hash(pin, 10)?;
    Ok(hashed)
}

pub fn verify(pin: &str, hash: &str) -> bool {
    bcrypt::verify(pin, hash).unwrap_or(false)
}
