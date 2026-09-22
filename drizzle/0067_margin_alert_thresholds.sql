-- Migration 0055: Per-user margin alert thresholds
-- Adds marginWarningPct and marginCriticalPct to user_preferences.
-- Defaults match the global constants (80% warning, 95% critical).

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "margin_warning_pct"  integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS "margin_critical_pct" integer NOT NULL DEFAULT 95;
