/**
 * NEXCOM Mobile — OAuth deep-link callback route (nexcom://auth/callback).
 *
 * Primary path: expo-auth-session delivers the authorization response
 * in-process to the login screen (app/auth/index.tsx), so this route normally
 * never renders. It exists because the redirect URI must resolve to a real
 * expo-router route, and it covers the fallback path where the OS delivers the
 * redirect as a plain deep link (e.g. browser hand-off edge cases).
 */
import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";

export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const [message, setMessage] = useState("Completing sign-in…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // If Keycloak returned an error in the redirect, surface it honestly.
    if (params.error) {
      setFailed(true);
      setMessage(params.error_description ?? `Login failed: ${params.error}`);
      return;
    }
    // A bare ?code= arriving here means the in-process AuthSession flow did
    // not consume it (e.g. cold start from the browser). We cannot exchange
    // the code without the PKCE verifier held by the login screen's request
    // object, so send the user back to login to restart the flow.
    if (params.code) {
      setFailed(true);
      setMessage("Sign-in session expired. Please start login again.");
      return;
    }
    // No params at all — nothing to do here.
    const t = setTimeout(() => router.replace("/auth"), 1500);
    return () => clearTimeout(t);
  }, [params]);

  return (
    <View style={s.container}>
      {!failed && <ActivityIndicator color={COLORS.primary} size="large" />}
      <Text style={[s.text, failed && { color: COLORS.error }]}>{message}</Text>
      {failed && (
        <TouchableOpacity style={s.btn} onPress={() => router.replace("/auth")}>
          <Text style={s.btnText}>Back to Sign In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  text: { ...FONTS.body, color: COLORS.textMuted, marginTop: SPACING.lg, textAlign: "center" },
  btn: { marginTop: SPACING.xl, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md },
  btnText: { ...FONTS.heading, color: "#fff", fontSize: 15 },
});
