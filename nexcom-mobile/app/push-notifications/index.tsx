/**
 * NEXCOM Mobile — Push Notifications Settings Screen
 * Registers/unregisters push token via notifications.registerPushToken.
 */
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function PushNotificationsScreen() {
  const [registering, setRegistering] = useState(false);
  const notifPrefsQ = trpc.preferences.getNotifPrefs.useQuery();
  const utils = trpc.useUtils();
  const registerMut = trpc.notifications.registerPushToken.useMutation({
    onSuccess: () => {
      Alert.alert("Success", "Push notifications enabled for this device.");
      utils.preferences.getNotifPrefs.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const notifPrefs = notifPrefsQ.data as any;

  async function handleRegister() {
    setRegistering(true);
    // In a real app, use expo-notifications to get the push token
    // For now, we simulate with a placeholder token
    const mockToken = `expo-push-token-${Date.now()}`;
    try {
      await registerMut.mutateAsync({ token: mockToken, platform: "expo", deviceName: "Mobile Device" });
    } finally {
      setRegistering(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Push Notifications</Text>
          <Text style={s.subtitle}>Manage how NEXCOM notifies you</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Current Preferences</Text>
          {notifPrefsQ.isLoading ? <ActivityIndicator color={COLORS.primary} /> : (
            <>
              {[
                ["Price Alerts", notifPrefs?.priceAlerts],
                ["Order Updates", notifPrefs?.orderUpdates],
                ["Deposits & Withdrawals", notifPrefs?.depositWithdrawal],
                ["System Announcements", notifPrefs?.systemAnnouncements],
              ].map(([label, value]) => (
                <View key={label} style={s.row}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={[s.value, value ? s.pos : s.neg]}>{value ? "Enabled" : "Disabled"}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Device Registration</Text>
          <Text style={s.body}>Register this device to receive real-time push notifications for trades, price alerts, and account updates.</Text>
          <TouchableOpacity style={s.btn} onPress={handleRegister} disabled={registering || registerMut.isPending}>
            {(registering || registerMut.isPending) ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Register This Device</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 28, color: COLORS.text },
  subtitle: { ...FONTS.body, color: COLORS.textMuted, marginTop: 2 },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { ...FONTS.subheading, fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, fontSize: 13 },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  body: { ...FONTS.body, color: COLORS.textMuted, fontSize: 14, marginBottom: SPACING.md },
  btn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: SPACING.md, alignItems: "center" },
  btnText: { ...FONTS.subheading, color: "#fff", fontSize: 15 },
});
