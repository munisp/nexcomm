/**
 * Security Settings Screen — NEXCOM Mobile
 * Biometric auth, PIN change, active sessions, and 2FA management.
 */
import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function SecurityScreen() {
  const utils = trpc.useUtils();
  const [biometric, setBiometric] = useState(true);
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [tradeConfirm, setTradeConfirm] = useState(true);

  const sessionsQuery = trpc.deviceSession.listMySessions.useQuery();
  const revokeAllMutation = trpc.deviceSession.revokeAllOtherSessions.useMutation({
    onSuccess: () => {
      utils.deviceSession.listMySessions.invalidate();
      Alert.alert("Done", "All other sessions have been revoked.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const revokeDeviceMutation = trpc.deviceSession.revokeDevice.useMutation({
    onSuccess: () => utils.deviceSession.listMySessions.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const sessions = sessionsQuery.data ?? [];

  const handleRevokeAll = () => {
    Alert.alert("Revoke Sessions", "All other active sessions will be signed out.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke All", style: "destructive", onPress: () => revokeAllMutation.mutate() },
    ]);
  };

  const handleRevokeDevice = (deviceId: string) => {
    Alert.alert("Revoke Device", "This device will be signed out.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: () => revokeDeviceMutation.mutate({ deviceId }) },
    ]);
  };

  const formatDate = (ts: any) => {
    if (!ts) return "Unknown";
    return new Date(ts).toLocaleDateString();
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Security</Text>
          <Text style={s.sub}>Manage authentication and account security</Text>
        </View>

        {/* Authentication */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Authentication</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Biometric Login</Text>
              <Text style={s.rowSub}>Use Face ID or fingerprint to sign in</Text>
            </View>
            <Switch value={biometric} onValueChange={setBiometric} trackColor={{ true: COLORS.primary }} thumbColor="#fff" />
          </View>
          <TouchableOpacity style={s.row} onPress={() => Alert.alert("Change PIN", "PIN change flow — enter current PIN then set a new one.")}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Change PIN</Text>
              <Text style={s.rowSub}>Update your 6-digit trading PIN</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Notifications */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Security Notifications</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Login Alerts</Text>
              <Text style={s.rowSub}>Get notified on new sign-ins</Text>
            </View>
            <Switch value={loginAlerts} onValueChange={setLoginAlerts} trackColor={{ true: COLORS.primary }} thumbColor="#fff" />
          </View>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Trade Confirmation</Text>
              <Text style={s.rowSub}>Require confirmation for large trades</Text>
            </View>
            <Switch value={tradeConfirm} onValueChange={setTradeConfirm} trackColor={{ true: COLORS.primary }} thumbColor="#fff" />
          </View>
        </View>

        {/* Active Sessions */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Active Sessions</Text>
            <TouchableOpacity
              onPress={handleRevokeAll}
              disabled={revokeAllMutation.isPending}
            >
              <Text style={s.revokeAll}>Revoke All</Text>
            </TouchableOpacity>
          </View>

          {sessionsQuery.isLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 16 }} />
          ) : sessions.length === 0 ? (
            <Text style={s.noSessions}>No active sessions found.</Text>
          ) : (
            sessions.map((session: any) => (
              <View key={session.id} style={s.sessionCard}>
                <View style={s.sessionInfo}>
                  <Text style={s.sessionDevice}>{session.deviceName ?? "Unknown Device"}</Text>
                  <Text style={s.sessionMeta}>
                    {session.platform ?? "Unknown"} · Last seen {formatDate(session.lastSeenAt ?? session.createdAt)}
                  </Text>
                  {session.isCurrent && (
                    <View style={s.currentBadge}>
                      <Text style={s.currentBadgeText}>Current Session</Text>
                    </View>
                  )}
                </View>
                {!session.isCurrent && (
                  <TouchableOpacity
                    style={s.revokeBtn}
                    onPress={() => handleRevokeDevice(session.deviceId)}
                    disabled={revokeDeviceMutation.isPending}
                  >
                    <Text style={s.revokeBtnText}>Revoke</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "700", color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  section: { marginHorizontal: 16, marginBottom: 24 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  rowTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  rowSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  arrow: { fontSize: 20, color: COLORS.textMuted },
  revokeAll: { fontSize: 14, color: COLORS.error, fontWeight: "600" },
  noSessions: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", paddingVertical: 16 },
  sessionCard: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  sessionInfo: { flex: 1 },
  sessionDevice: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  sessionMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  currentBadge: { marginTop: 6, backgroundColor: `${COLORS.success}20`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  currentBadgeText: { fontSize: 11, color: COLORS.success, fontWeight: "700" },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: `${COLORS.error}15`, borderRadius: 8, borderWidth: 1, borderColor: `${COLORS.error}30` },
  revokeBtnText: { fontSize: 13, color: COLORS.error, fontWeight: "700" },
});
