export const COOKIE_NAME = "app_session_id";
export const REFRESH_TOKEN_COOKIE = "app_refresh_id";
/** Legacy constant — kept for backwards-compat; do NOT use for new sessions */
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** Access token TTL: 8 hours (financial platform security standard) */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
/** Refresh token TTL: 7 days */
export const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
