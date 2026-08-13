-- Keycloak uses a dedicated schema in the NEXCOM PostgreSQL database for local/staging Compose.
-- This script is executed only during initial PostgreSQL data-directory creation.
CREATE SCHEMA IF NOT EXISTS keycloak AUTHORIZATION nexcom;
