/**
 * NEXCOM Mobile — Auth / Login Screen
 * Authorization Code + PKCE against Keycloak (public client) via
 * expo-auth-session. The returned Keycloak access token is accepted by the
 * server's Bearer path (server/_core/sdk.ts).
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { COLORS, CONFIG, FONTS, SPACING } from "../../constants/config";
import { useAuthStore } from "../../lib/store";
import { discovery, exchangeCodeForTokens, getRedirectUri } from "../../lib/auth";
import { registerDevicePushToken } from "../../lib/notifications";

// Required so the auth browser session completes back into the app on iOS.
WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const router = useRouter();
  const { isAuthenticated, setToken } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CONFIG.KEYCLOAK_CLIENT_ID,
      scopes: ["openid", "email", "profile"],
      redirectUri: getRedirectUri(),
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery,
  );

  // If already authenticated, go to the app
  useEffect(() => {
    if (isAuthenticated) router.replace("/tabs");
  }, [isAuthenticated]);

  // Handle the authorization response delivered in-process by AuthSession
  useEffect(() => {
    if (response?.type === "success" && request) {
      const code = response.params.code;
      if (!code) {
        setError("Login failed: no authorization code returned.");
        return;
      }
      exchangeCodeForTokens(request, code)
        .then(async (tokens) => {
          setToken(tokens.accessToken);
          // Push token registration is best-effort and must not block login
          registerDevicePushToken().catch(() => {});
          router.replace("/tabs");
        })
        .catch((e) => setError(`Token exchange failed: ${(e as Error).message}`));
    } else if (response?.type === "error") {
      setError(`Login failed: ${response.error?.message ?? "unknown error"}`);
    }
  }, [response, request]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.content}>
        <View style={s.logo}>
          <Text style={s.logoIcon}>📈</Text>
        </View>
        <Text style={s.appName}>NEXCOM Exchange</Text>
        <Text style={s.tagline}>African Commodity Trading Platform</Text>

        <View style={s.features}>
          {[
            ["📈", "Live commodity prices across Africa"],
            ["🏭", "Warehouse receipt financing"],
            ["🔔", "Smart price alerts"],
            ["🌾", "Field agent tools"],
          ].map(([icon, text]) => (
            <View key={text} style={s.featureRow}>
              <Text style={s.featureIcon}>{icon}</Text>
              <Text style={s.featureText}>{text}</Text>
            </View>
          ))}
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.loginBtn, !request && { opacity: 0.6 }]}
          disabled={!request}
          onPress={() => promptAsync()}
        >
          {request ? (
            <Text style={s.loginBtnText}>Sign In with NEXCOM</Text>
          ) : (
            <ActivityIndicator color="#fff" />
          )}
        </TouchableOpacity>
        <Text style={s.hint}>Secure OIDC login (Keycloak PKCE)</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: SPACING.xl, justifyContent: "center" },
  logo: { width: 80, height: 80, borderRadius: 20, backgroundColor: COLORS.primary + "20", alignItems: "center", justifyContent: "center", marginBottom: SPACING.lg, alignSelf: "center" },
  logoIcon: { fontSize: 40 },
  appName: { ...FONTS.heading, fontSize: 28, color: COLORS.text, textAlign: "center" },
  tagline: { ...FONTS.body, color: COLORS.textMuted, textAlign: "center", marginTop: 4, marginBottom: SPACING.xl },
  features: { marginBottom: SPACING.xl },
  featureRow: { flexDirection: "row", alignItems: "center", marginBottom: SPACING.md },
  featureIcon: { fontSize: 20, marginRight: SPACING.md },
  featureText: { ...FONTS.body, color: COLORS.textMuted, flex: 1 },
  loginBtn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: SPACING.lg, alignItems: "center", marginBottom: SPACING.sm },
  loginBtnText: { ...FONTS.heading, color: "#fff", fontSize: 16 },
  hint: { ...FONTS.body, color: COLORS.textDim, textAlign: "center", fontSize: 12 },
  errorBox: { backgroundColor: COLORS.error + "20", borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md },
  errorText: { ...FONTS.body, color: COLORS.error, fontSize: 13 },
});
