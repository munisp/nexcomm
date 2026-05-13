-- Migration 0052: PBAC Policies persistence table
-- Allows policy store to survive server restarts

CREATE TABLE IF NOT EXISTS "pbac_policies" (
  "id"          varchar(128) PRIMARY KEY,
  "name"        varchar(200) NOT NULL,
  "description" text,
  "effect"      varchar(8)   NOT NULL CHECK (effect IN ('allow', 'deny')),
  "principals"  jsonb        NOT NULL DEFAULT '[]',
  "resources"   jsonb        NOT NULL DEFAULT '[]',
  "actions"     jsonb        NOT NULL DEFAULT '[]',
  "conditions"  jsonb,
  "priority"    integer      NOT NULL DEFAULT 500,
  "enabled"     boolean      NOT NULL DEFAULT true,
  "created_at"  timestamp    NOT NULL DEFAULT now(),
  "updated_at"  timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pbac_policies_effect_idx"   ON "pbac_policies" ("effect");
CREATE INDEX IF NOT EXISTS "pbac_policies_enabled_idx"  ON "pbac_policies" ("enabled");
CREATE INDEX IF NOT EXISTS "pbac_policies_priority_idx" ON "pbac_policies" ("priority" DESC);
