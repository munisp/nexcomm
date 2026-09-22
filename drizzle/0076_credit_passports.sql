-- Migration: 0076_credit_passports
-- INNOVATION 4: CREDIT PASSPORT — verifiable credit-score passport issuance.
-- Pairs with server/routers/creditPassportRouter.ts and
-- drizzle/schema-credit-passport.ts (re-export from schema.ts to activate).

CREATE TABLE IF NOT EXISTS credit_passports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 300 AND 900),
  band VARCHAR(16) NOT NULL CHECK (band IN ('prime', 'good', 'fair', 'subprime', 'cold_start')),
  issued_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  verification_code VARCHAR(64) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS credit_passports_user_idx ON credit_passports (user_id);
CREATE INDEX IF NOT EXISTS credit_passports_code_idx ON credit_passports (verification_code);
