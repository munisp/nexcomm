/**
 * NEXCOM Mobile — Dashboard Screen
 * Live portfolio summary, recent trades, market movers, and price alerts.
 */
import React from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function DashboardScreen() {
  const router = useRouter();
  const summaryQ = trpc.portfolio.summary.useQuery();
  const alertsQ = trpc.priceAlerts.list.useQuery();
  const livePricesQ = trpc.livePrices.getAll.useQuery();

  const isLoading = summaryQ.isLoading || alertsQ.isLoading;

  function refetchAll() {
    summaryQ.refetch();
    alertsQ.refetch();
    livePricesQ.refetch();
  }

  const summary = summaryQ.data;
  const positions: any[] = (summary as any)?.positions ?? [];
  const alerts: any[] = (alertsQ.data as any) ?? [];
  const livePrices: any[] = (livePricesQ.data as any) ?? [];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetchAll} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={s.header}>
          <Text style={s.title}>Dashboard</Text>
          <Text style={s.subtitle}>NEXCOM Exchange</Text>
        </View>
        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Portfolio</Text>
              <Text style={s.bigValue}>
                {String.fromCharCode(8358)}{positions.reduce((acc: number, p: any) => acc + Number(p.avgCost) * Number(p.quantity), 0).toLocaleString()}
              </Text>
              <Text style={s.muted}>{positions.length} position{positions.length !== 1 ? "s" : ""} open</Text>
              <TouchableOpacity onPress={() => router.push("/portfolio")} style={s.linkBtn}>
                <Text style={s.linkText}>View Portfolio</Text>
              </TouchableOpacity>
            </View>
            <View style={s.card}>
              <Text style={s.cardTitle}>Market Snapshot</Text>
              {livePrices.slice(0, 5).map((p: any) => (
                <View key={p.symbol} style={s.row}>
                  <Text style={s.symbol}>{p.symbol}</Text>
                  <Text style={s.price}>{String.fromCharCode(8358)}{Number(p.price).toLocaleString()}</Text>
                  <Text style={[s.change, Number(p.changePct) >= 0 ? s.pos : s.neg]}>
                    {Number(p.changePct) >= 0 ? "+" : ""}{Number(p.changePct).toFixed(2)}%
                  </Text>
                </View>
              ))}
              {livePrices.length === 0 && <Text style={s.muted}>No live prices available</Text>}
              <TouchableOpacity onPress={() => router.push("/markets")} style={s.linkBtn}>
                <Text style={s.linkText}>All Markets</Text>
              </TouchableOpacity>
            </View>
            <View style={s.card}>
              <Text style={s.cardTitle}>Active Alerts ({alerts.length})</Text>
              {alerts.slice(0, 4).map((a: any) => (
                <View key={a.id} style={s.row}>
                  <Text style={s.symbol}>{a.symbol}</Text>
                  <Text style={s.muted}>{a.condition} {String.fromCharCode(8358)}{Number(a.targetPrice).toLocaleString()}</Text>
                  <View style={[s.badge, a.isActive ? s.badgeGreen : s.badgeGray]}>
                    <Text style={s.badgeText}>{a.isActive ? "ACTIVE" : "DONE"}</Text>
                  </View>
                </View>
              ))}
              {alerts.length === 0 && <Text style={s.muted}>No alerts set</Text>}
              <TouchableOpacity onPress={() => router.push("/alerts")} style={s.linkBtn}>
                <Text style={s.linkText}>Manage Alerts</Text>
              </TouchableOpacity>
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
  bigValue: { ...FONTS.heading, fontSize: 32, color: COLORS.text },
  muted: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  symbol: { ...FONTS.subheading, color: COLORS.text, flex: 1, fontSize: 14 },
  price: { ...FONTS.mono, color: COLORS.text, fontSize: 14, marginRight: 8 },
  change: { ...FONTS.mono, fontSize: 13, minWidth: 60, textAlign: "right" },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  linkBtn: { marginTop: SPACING.sm },
  linkText: { color: COLORS.primary, ...FONTS.subheading, fontSize: 14 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeGreen: { backgroundColor: "#10b98130" },
  badgeGray: { backgroundColor: "#374151" },
  badgeText: { fontSize: 10, fontWeight: "700" as const, color: COLORS.text },
});
