/**
 * NEXCOM Mobile — Warehouse Receipts Screen
 * Lists the user's EWRs from receipts.list.
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function WarehouseScreen() {
  const router = useRouter();
  const receiptsQ = trpc.receipts.list.useQuery();
  const receipts: any[] = (receiptsQ.data as any) ?? [];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={receiptsQ.isFetching} onRefresh={() => receiptsQ.refetch()} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={s.header}>
          <Text style={s.title}>Warehouse Receipts</Text>
          <Text style={s.subtitle}>{receipts.length} receipt{receipts.length !== 1 ? "s" : ""}</Text>
        </View>
        {receiptsQ.isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : receipts.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyText}>No warehouse receipts found</Text></View>
        ) : (
          receipts.map((r: any) => (
            <TouchableOpacity key={r.id} style={s.card} onPress={() => router.push({ pathname: "/warehouse/[id]", params: { id: String(r.id) } })}>
              <View style={s.cardHeader}>
                <Text style={s.ewrId}>EWR-{String(r.id).padStart(6, "0")}</Text>
                <View style={[s.badge, r.status === "ACTIVE" ? s.badgeGreen : r.status === "PLEDGED" ? s.badgeAmber : s.badgeGray]}>
                  <Text style={s.badgeText}>{r.status}</Text>
                </View>
              </View>
              <Text style={s.commodity}>{r.commodityName ?? r.commodityCode ?? "Unknown"}</Text>
              <View style={s.row}>
                <Text style={s.label}>Quantity</Text>
                <Text style={s.value}>{Number(r.quantity).toLocaleString()} {r.unit ?? "MT"}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.label}>Warehouse</Text>
                <Text style={s.value}>{r.warehouseName ?? r.warehouseId ?? "—"}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.label}>Value</Text>
                <Text style={s.value}>₦{Number(r.valueNgn ?? 0).toLocaleString()}</Text>
              </View>
            </TouchableOpacity>
          ))
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.sm },
  ewrId: { ...FONTS.mono, color: COLORS.primary, fontSize: 14 },
  commodity: { ...FONTS.heading, color: COLORS.text, fontSize: 18, marginBottom: SPACING.sm },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, color: COLORS.text, fontSize: 13 },
  badge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  badgeGreen: { backgroundColor: "#10b98130" },
  badgeAmber: { backgroundColor: "#f59e0b30" },
  badgeGray: { backgroundColor: "#374151" },
  badgeText: { fontSize: 11, fontWeight: "700" as const, color: COLORS.text },
  empty: { alignItems: "center", marginTop: 60 },
  emptyText: { ...FONTS.body, color: COLORS.textMuted },
});
