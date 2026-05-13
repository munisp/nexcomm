/**
 * NEXCOM Mobile — Profile Screen
 * Shows user profile from profile.get with KYC status.
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function ProfileScreen() {
  const router = useRouter();
  const profileQ = trpc.profile.get.useQuery();
  const kycQ = trpc.onboarding.getStatus.useQuery();
  const profile = profileQ.data as any;
  const kyc = kycQ.data as any;

  const isLoading = profileQ.isLoading || kycQ.isLoading;

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { profileQ.refetch(); kycQ.refetch(); }} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={s.header}>
          <Text style={s.title}>Profile</Text>
        </View>
        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Avatar + name */}
            <View style={s.avatarCard}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{(profile?.fullName ?? profile?.name ?? "U").charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={s.name}>{profile?.fullName ?? profile?.name ?? "—"}</Text>
              <Text style={s.email}>{profile?.email ?? "—"}</Text>
              <View style={[s.badge, profile?.role === "admin" ? s.badgeAmber : s.badgeGreen]}>
                <Text style={s.badgeText}>{(profile?.role ?? "user").toUpperCase()}</Text>
              </View>
            </View>

            {/* KYC Status */}
            <View style={s.card}>
              <Text style={s.cardTitle}>KYC Status</Text>
              <View style={s.row}>
                <Text style={s.label}>Status</Text>
                <Text style={[s.value, kyc?.kycStatus === "APPROVED" ? s.pos : kyc?.kycStatus === "REJECTED" ? s.neg : s.warn]}>
                  {kyc?.kycStatus ?? "NOT_SUBMITTED"}
                </Text>
              </View>
              {kyc?.kycStatus !== "APPROVED" && (
                <TouchableOpacity style={s.btn} onPress={() => router.push("/kyc")}>
                  <Text style={s.btnText}>{kyc?.kycStatus === "PENDING" ? "Check KYC Status" : "Submit KYC"}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Profile details */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Details</Text>
              {[
                ["Phone", profile?.phone],
                ["Country", profile?.country],
                ["City", profile?.city],
                ["Account Type", profile?.accountType],
                ["Member Since", profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : null],
              ].map(([label, value]) => (
                <View key={label} style={s.row}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={s.value}>{value ?? "—"}</Text>
                </View>
              ))}
            </View>

            {/* Settings link */}
            <TouchableOpacity style={s.settingsBtn} onPress={() => router.push("/settings")}>
              <Text style={s.settingsBtnText}>Settings & Preferences</Text>
            </TouchableOpacity>
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
  avatarCard: { alignItems: "center", padding: SPACING.xl, backgroundColor: COLORS.surface, marginHorizontal: SPACING.lg, borderRadius: 12, marginBottom: SPACING.md },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primary + "30", alignItems: "center", justifyContent: "center", marginBottom: SPACING.sm },
  avatarText: { ...FONTS.heading, fontSize: 32, color: COLORS.primary },
  name: { ...FONTS.heading, fontSize: 20, color: COLORS.text },
  email: { ...FONTS.body, color: COLORS.textMuted, fontSize: 14, marginTop: 2 },
  badge: { marginTop: SPACING.sm, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 3 },
  badgeGreen: { backgroundColor: "#10b98130" },
  badgeAmber: { backgroundColor: "#f59e0b30" },
  badgeText: { fontSize: 11, fontWeight: "700" as const, color: COLORS.text },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { ...FONTS.subheading, fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, color: COLORS.text, fontSize: 13 },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  warn: { color: COLORS.warning },
  btn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: SPACING.sm, alignItems: "center", marginTop: SPACING.sm },
  btnText: { ...FONTS.subheading, color: "#fff", fontSize: 14 },
  settingsBtn: { marginHorizontal: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: SPACING.md, alignItems: "center" },
  settingsBtnText: { ...FONTS.subheading, color: COLORS.text, fontSize: 15 },
});
