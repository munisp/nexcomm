/**
 * NEXCOM Mobile — Settings Screen
 * Preferences, notifications, security, and sign-out via live API.
 */
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function SettingsScreen() {
  const router = useRouter();
  const [savingBio, setSavingBio] = useState(false);
  const utils = trpc.useUtils();

  const prefsQ = trpc.preferences.get.useQuery();
  const notifQ = trpc.preferences.getNotifPrefs.useQuery();
  const bioQ = trpc.security.getBiometricPreference.useQuery();
  const meQ = trpc.auth.me.useQuery();

  const updatePrefsMut = trpc.preferences.update.useMutation({ onSuccess: () => utils.preferences.get.invalidate() });
  const updateNotifMut = trpc.preferences.updateNotifPrefs.useMutation({ onSuccess: () => utils.preferences.getNotifPrefs.invalidate() });
  const setBioMut = trpc.security.setBiometricPreference.useMutation({ onSuccess: () => utils.security.getBiometricPreference.invalidate() });
  const logoutMut = trpc.auth.logout.useMutation({ onSuccess: () => router.replace("/auth") });

  const prefs = prefsQ.data as any;
  const notif = notifQ.data as any;
  const bio = bioQ.data as any;
  const me = meQ.data as any;

  const isDark = (prefs?.theme ?? "dark") === "dark";

  async function toggleBio(v: boolean) {
    setSavingBio(true);
    try { await setBioMut.mutateAsync({ enabled: v }); } catch (e: any) { Alert.alert("Error", e.message); } finally { setSavingBio(false); }
  }

  function handleLogout() {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logoutMut.mutate() },
    ]);
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Settings</Text>
          {me && <Text style={s.subtitle}>{me.name ?? me.email}</Text>}
        </View>

        {/* Notifications */}
        <Text style={s.sectionHeader}>NOTIFICATIONS</Text>
        {notifQ.isLoading ? <ActivityIndicator color={COLORS.primary} style={{ margin: SPACING.lg }} /> : (
          <>
            {[
              { key: "priceAlerts", label: "Price Alerts" },
              { key: "orderUpdates", label: "Order Updates" },
              { key: "depositWithdrawal", label: "Deposits & Withdrawals" },
              { key: "systemAnnouncements", label: "System Announcements" },
            ].map(({ key, label }) => (
              <View key={key} style={s.row}>
                <Text style={s.rowLabel}>{label}</Text>
                <Switch
                  value={(notif?.[key] as boolean) ?? true}
                  onValueChange={(v) => updateNotifMut.mutate({ [key]: v })}
                  trackColor={{ true: COLORS.primary }}
                />
              </View>
            ))}
          </>
        )}

        {/* Security */}
        <Text style={s.sectionHeader}>SECURITY</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>Biometric Login</Text>
          {savingBio ? <ActivityIndicator color={COLORS.primary} /> : (
            <Switch value={(bio?.enabled as boolean) ?? false} onValueChange={toggleBio} trackColor={{ true: COLORS.primary }} />
          )}
        </View>
        <TouchableOpacity style={s.row} onPress={() => router.push("/totp")}>
          <Text style={s.rowLabel}>Two-Factor Authentication</Text>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.row} onPress={() => router.push("/security")}>
          <Text style={s.rowLabel}>Active Sessions</Text>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>

        {/* Display */}
        <Text style={s.sectionHeader}>DISPLAY</Text>
        {prefsQ.isLoading ? <ActivityIndicator color={COLORS.primary} style={{ margin: SPACING.lg }} /> : (
          <View style={s.row}>
            <Text style={s.rowLabel}>Dark Mode</Text>
            <Switch value={isDark} onValueChange={(v) => updatePrefsMut.mutate({ theme: v ? "dark" : "light" })} trackColor={{ true: COLORS.primary }} />
          </View>
        )}

        {/* About */}
        <Text style={s.sectionHeader}>ABOUT</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>Version</Text>
          <Text style={s.rowValue}>1.0.0</Text>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} disabled={logoutMut.isPending}>
          {logoutMut.isPending ? <ActivityIndicator color={COLORS.error} /> : <Text style={s.logoutText}>Sign Out</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 28, color: COLORS.text },
  subtitle: { ...FONTS.body, color: COLORS.textMuted, marginTop: 2 },
  sectionHeader: { ...FONTS.subheading, fontSize: 11, color: COLORS.textMuted, letterSpacing: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
  rowLabel: { ...FONTS.body, color: COLORS.text, fontSize: 15 },
  rowValue: { ...FONTS.body, color: COLORS.textMuted, fontSize: 15 },
  chevron: { color: COLORS.textMuted, fontSize: 20 },
  logoutBtn: { margin: SPACING.lg, borderWidth: 1, borderColor: COLORS.error, borderRadius: 8, padding: SPACING.md, alignItems: "center" },
  logoutText: { ...FONTS.subheading, color: COLORS.error, fontSize: 15 },
});
