/**
 * NEXCOM Mobile — Auth / Login Screen
 * Initiates Manus OAuth flow via external browser.
 */
import React, { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";
import { CONFIG } from "../../constants/config";

const OAUTH_URL = `${CONFIG.BASE_URL}/api/oauth/login?returnPath=/`;

export default function AuthScreen() {
  const router = useRouter();
  const meQ = trpc.auth.me.useQuery(undefined, { retry: false });

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (meQ.data) {
      router.replace("/dashboard");
    }
  }, [meQ.data]);

  function handleLogin() {
    Linking.openURL(OAUTH_URL);
  }

  if (meQ.isLoading) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }

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

        <TouchableOpacity style={s.loginBtn} onPress={handleLogin}>
          <Text style={s.loginBtnText}>Sign In with NEXCOM</Text>
        </TouchableOpacity>
        <Text style={s.hint}>Secure login via Manus OAuth</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { justifyContent: "center", alignItems: "center" },
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
});
