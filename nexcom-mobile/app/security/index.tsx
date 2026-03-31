/**
 * Security Settings Screen — NEXCOM Mobile
 * Biometric auth, PIN change, active sessions, and 2FA management.
 */
import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../constants/config";

export default function SecurityScreen() {
  const [biometric, setBiometric] = useState(true);
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [tradeConfirm, setTradeConfirm] = useState(true);

  const handleChangePin = () => Alert.alert("Change PIN", "PIN change flow — enter current PIN then set a new one.");
  const handleRevokeSessions = () => Alert.alert("Revoke Sessions", "All other active sessions will be signed out.", [
    { text: "Cancel", style: "cancel" },
    { text: "Revoke All", style: "destructive", onPress: () => Alert.alert("Done", "All other sessions revoked.") },
  ]);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Security</Text>
          <Text style={s.sub}>Manage authentication and account security</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Authentication</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Biometric Login</Text>
              <Text style={s.rowSub}>Use Face ID or fingerprint to sign in</Text>
            </View>
            <Switch value={biometric} onValueChange={setBiometric} trackColor={{ true: COLORS.primary }} thumbColor="#fff" />
          </View>
          <TouchableOpacity style={s.row} onPress={handleChangePin}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Change PIN</Text>
              <Text style={s.rowSub}>Update your 6-digit transaction PIN</Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Alerts</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Login Alerts</Text>
              <Text style={s.rowSub}>Notify me of new sign-ins</Text>
            </View>
            <Switch value={loginAlerts} onValueChange={setLoginAlerts} trackColor={{ true: COLORS.primary }} thumbColor="#fff" />
          </View>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Trade Confirmation</Text>
              <Text style={s.rowSub}>Require PIN before placing orders</Text>
            </View>
            <Switch value={tradeConfirm} onValueChange={setTradeConfirm} trackColor={{ true: COLORS.primary }} thumbColor="#fff" />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Sessions</Text>
          <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={handleRevokeSessions}>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowTitle, { color: COLORS.error }]}>Revoke All Other Sessions</Text>
              <Text style={s.rowSub}>Sign out from all other devices</Text>
            </View>
            <Text style={[s.arrow, { color: COLORS.error }]}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d1117" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#e6edf3" },
  sub: { fontSize: 14, color: "#8b949e", marginTop: 4 },
  section: { marginHorizontal: 16, marginTop: 20, backgroundColor: "#161b22", borderRadius: 12, borderWidth: 1, borderColor: "#30363d", overflow: "hidden" },
  sectionTitle: { fontSize: 12, fontWeight: "600", color: "#8b949e", textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#21262d" },
  rowTitle: { fontSize: 15, color: "#e6edf3", fontWeight: "500" },
  rowSub: { fontSize: 12, color: "#8b949e", marginTop: 2 },
  arrow: { fontSize: 20, color: "#8b949e" },
});
