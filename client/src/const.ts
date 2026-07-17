export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Generate the login URL at runtime.
 *
 * Redirects to the self-hosted /api/auth/login endpoint, which then
 * redirects the user to Keycloak (or any configured OIDC provider).
 * No Manus OAuth portal dependency.
 */
export const getLoginUrl = (returnPath?: string) => {
  const callbackUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(callbackUri);
  const url = new URL(`${window.location.origin}/api/auth/login`);
  url.searchParams.set("redirectUri", callbackUri);
  url.searchParams.set("state", state);
  if (returnPath) url.searchParams.set("returnPath", returnPath);
  return url.toString();
};
