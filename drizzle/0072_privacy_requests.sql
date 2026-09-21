-- Migration: 0072_privacy_requests (renumbered from 0066_privacy_requests during integration merge)
-- Audit trail for GDPR-style data-export and erasure requests.
-- Pairs with server/routers/privacyRouter.ts.

CREATE TABLE IF NOT EXISTS privacy_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  request_type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
  tombstone VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS privacy_requests_user_idx ON privacy_requests (user_id);
