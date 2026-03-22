#!/bin/bash
##############################################################################
# NEXCOM Exchange - PostgreSQL Multiple Database Initialization
# Creates separate databases for each service domain
##############################################################################
set -e
set -u

function create_user_and_database() {
    local database=$1
    local user=$2
    local password=$3
    echo "Creating user '$user' and database '$database'"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
        CREATE USER $user WITH PASSWORD '$password';
        CREATE DATABASE $database;
        GRANT ALL PRIVILEGES ON DATABASE $database TO $user;
        ALTER DATABASE $database OWNER TO $user;
EOSQL
}

# Core application database (owned by main user)
echo "Configuring nexcom database..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE nexcom TO nexcom;
EOSQL

# Keycloak database
create_user_and_database "keycloak" "keycloak" "${KEYCLOAK_DB_PASSWORD:-keycloak}"

# Temporal database
create_user_and_database "temporal" "temporal" "${TEMPORAL_DB_PASSWORD:-temporal}"
create_user_and_database "temporal_visibility" "temporal" "${TEMPORAL_DB_PASSWORD:-temporal}"

echo "All databases initialized successfully."
