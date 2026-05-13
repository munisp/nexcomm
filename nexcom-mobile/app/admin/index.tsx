/**
 * NEXCOM Mobile — Admin Panel Screen
 * Platform stats and quick admin actions.
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function AdminScreen() {
  const router = useRouter();
  const summaryQ = trpc.analytics.summary.useQuery();
  const pendingKycQ = trpc.marketMakerOnboarding.adminListMarketMakerProfiles.useQuery({ kycStatus: "PENDING" });

  const summary = summaryQ.data as any;
  const pendingKyc: any[] = (pendingKycQ.data as any) ?? [];

  const isLoading = summaryQ.isLoading;

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { summaryQ.refetch(); pendingKycQ.refetch(); }} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={s.header}>
          <Text style={s.title}>Admin Panel</Text>
          <Text style={s.subtitle}>Platform Management</Text>
        </View>

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} /> : (
          <>
            {/* Platform Stats */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Platform Stats</Text>
              {[
                ["Total Users", summary?.totalUsers],
                ["Total Orders", summary?.totalOrders],
                ["Filled Orders", summary?.filledOrders],
                ["Warehouse Receipts", summary?.totalReceipts],
                ["Pending KYC", summary?.pendingKyc],
              ].map(([label, value]) => (
                <View key={label} style={s.row}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={s.value}>{value != null ? Number(value).toLocaleString() : "—"}</Text>
                </View>
              ))}
            </View>

            {/* Pending KYC */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Pending Market Maker KYC ({pendingKyc.length})</Text>
              {pendingKycQ.isLoading ? <ActivityIndicator color={COLORS.primary} /> : pendingKyc.slice(0, 5).map((p: any) => (
                <View key={p.id} style={s.row}>
                  <Text style={s.label}>{p.companyName ?? p.userId}</Text>
                  <Text style={s.value}>{p.kycStatus}</Text>
                </View>
              ))}
              {pendingKyc.length === 0 && !pendingKycQ.isLoading && <Text style={s.muted}>No pending applications</Text>}
              <TouchableOpacity style={s.btn} onPress={() => router.push("/market-maker")}>
                <Text style={s.btnText}>Review Applications</Text>
              </TouchableOpacity>
            </View>

            {/* Quick Links */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Quick Links</Text>
              {[
                { label: "Compliance", path: "/compliance" },
                { label: "Regulatory", path: "/regulatory" },
                { label: "Disputes", path: "/disputes" },
                { label: "Settlement", path: "/settlement" },
              ].map(({ label, path }) => (
                <TouchableOpacity key={path} style={s.row} onPress={() => router.push(path as any)}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={s.chevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
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
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, color: COLORS.text, fontSize: 13 },
  muted: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  chevron: { color: COLORS.textMuted, fontSize: 20 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: SPACING.sm, alignItems: "center", marginTop: SPACING.sm },
  btnText: { ...FONTS.subheading, color: "#fff", fontSize: 14 },
});
