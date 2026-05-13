/**
 * NEXCOM Mobile — TOTP / 2FA Screen
 * Setup and verify TOTP via security.setupTotp and security.verifyTotp.
 */
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function TotpScreen() {
  const [code, setCode] = useState("");
  const utils = trpc.useUtils();

  const statusQ = trpc.security.getTotpStatus.useQuery();
  const setupMut = trpc.security.setupTotp.useMutation({
    onError: (e) => Alert.alert("Error", e.message),
  });
  const verifyMut = trpc.security.verifyTotp.useMutation({
    onSuccess: () => { Alert.alert("Success", "2FA enabled!"); utils.security.getTotpStatus.invalidate(); setCode(""); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const disableMut = trpc.security.disableTotp.useMutation({
    onSuccess: () => { Alert.alert("Disabled", "2FA has been disabled."); utils.security.getTotpStatus.invalidate(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const status = statusQ.data as any;
  const setup = setupMut.data as any;

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Two-Factor Auth</Text>
          <Text style={s.subtitle}>Protect your account with TOTP</Text>
        </View>

        {statusQ.isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} /> : (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Status</Text>
              <View style={s.row}>
                <Text style={s.label}>2FA Enabled</Text>
                <Text style={[s.value, status?.totpEnabled ? s.pos : s.neg]}>{status?.totpEnabled ? "Yes" : "No"}</Text>
              </View>
            </View>

            {!status?.totpEnabled && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Setup 2FA</Text>
                {!setup ? (
                  <TouchableOpacity style={s.btn} onPress={() => setupMut.mutate()} disabled={setupMut.isPending}>
                    {setupMut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Generate QR Code</Text>}
                  </TouchableOpacity>
                ) : (
                  <>
                    <Text style={s.body}>Scan this secret in your authenticator app:</Text>
                    <Text style={s.secret}>{setup.secret}</Text>
                    <Text style={s.body}>Then enter the 6-digit code to verify:</Text>
                    <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor={COLORS.textDim} keyboardType="numeric" maxLength={6} />
                    <TouchableOpacity style={s.btn} onPress={() => verifyMut.mutate({ code })} disabled={verifyMut.isPending || code.length < 6}>
                      {verifyMut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify & Enable</Text>}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {status?.totpEnabled && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Disable 2FA</Text>
                <Text style={s.body}>Enter your current TOTP code to disable 2FA:</Text>
                <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor={COLORS.textDim} keyboardType="numeric" maxLength={6} />
                <TouchableOpacity style={[s.btn, s.btnDanger]} onPress={() => disableMut.mutate({ code })} disabled={disableMut.isPending || code.length < 6}>
                  {disableMut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Disable 2FA</Text>}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
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
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, fontSize: 13 },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  body: { ...FONTS.body, color: COLORS.textMuted, fontSize: 14, marginBottom: SPACING.sm },
  secret: { ...FONTS.mono, color: COLORS.primary, fontSize: 13, backgroundColor: COLORS.surfaceAlt, padding: SPACING.sm, borderRadius: 6, marginBottom: SPACING.sm },
  input: { backgroundColor: COLORS.surfaceAlt, borderRadius: 8, padding: SPACING.sm, color: COLORS.text, ...FONTS.body, fontSize: 18, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, textAlign: "center", letterSpacing: 8 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: SPACING.md, alignItems: "center" },
  btnDanger: { backgroundColor: COLORS.error },
  btnText: { ...FONTS.subheading, color: "#fff", fontSize: 15 },
});
