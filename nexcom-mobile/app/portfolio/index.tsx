/**
 * Portfolio Screen — NEXCOM Mobile
 * Shows the user's commodity holdings, P&L, and allocation breakdown.
 */
import React from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function PortfolioScreen() {
  const summaryQuery = trpc.portfolio.summary.useQuery();
  const summary = summaryQuery.data;
  const positions: any[] = summary?.positions ?? [];

  const totalCost = summary?.totalCost ?? 0;
  const totalRealizedPnl = summary?.totalRealizedPnl ?? 0;
  const totalValue = positions.reduce((s: number, p: any) => s + Number(p.avgCost) * Number(p.quantity), 0);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={summaryQuery.isFetching}
            onRefresh={() => summaryQuery.refetch()}
            tintColor={COLORS.primary}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Portfolio</Text>
        </View>

        {summaryQuery.isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Summary card */}
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>Total Value (Cost Basis)</Text>
              <Text style={s.summaryValue}>₦{totalValue.toLocaleString()}</Text>
              <View style={s.pnlRow}>
                <Text style={[s.pnlText, totalRealizedPnl >= 0 ? s.profit : s.loss]}>
                  {totalRealizedPnl >= 0 ? "+" : ""}₦{totalRealizedPnl.toLocaleString()} realized
                </Text>
              </View>
            </View>

            {/* Holdings */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Holdings ({positions.length})</Text>
              {positions.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>📦</Text>
                  <Text style={s.emptyText}>No positions yet</Text>
                  <Text style={s.emptySub}>Your commodity positions will appear here after trading.</Text>
                </View>
              ) : (
                positions.map((h: any) => {
                  const value = Number(h.avgCost) * Number(h.quantity);
                  const pnl = Number(h.realizedPnl ?? 0);
                  return (
                    <View key={h.id ?? h.symbol} style={s.holdingCard}>
                      <View style={s.holdingTop}>
                        <View>
                          <Text style={s.holdingSymbol}>{h.symbol}</Text>
                          <Text style={s.holdingName}>{h.symbol}</Text>
                        </View>
                        <View style={s.holdingRight}>
                          <Text style={s.holdingValue}>₦{value.toLocaleString()}</Text>
                          <Text style={[s.holdingPnl, pnl >= 0 ? s.profit : s.loss]}>
                            {pnl >= 0 ? "+" : ""}₦{pnl.toLocaleString()}
                          </Text>
                        </View>
                      </View>
                      <View style={s.holdingBottom}>
                        <Text style={s.holdingDetail}>Qty: {Number(h.quantity).toLocaleString()}</Text>
                        <Text style={s.holdingDetail}>Avg: ₦{Number(h.avgCost).toLocaleString()}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "700", color: COLORS.text },
  summaryCard: {
    margin: 16,
    padding: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  summaryValue: { fontSize: 32, fontWeight: "700", color: COLORS.text, marginTop: 4 },
  pnlRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  pnlText: { fontSize: 16, fontWeight: "600" },
  pnlPct: { fontSize: 14, fontWeight: "500" },
  profit: { color: COLORS.success },
  loss: { color: COLORS.error },
  section: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text, marginBottom: 12 },
  holdingCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  holdingTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  holdingSymbol: { fontSize: 15, fontWeight: "700", color: COLORS.primary },
  holdingName: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  holdingRight: { alignItems: "flex-end" },
  holdingValue: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  holdingPnl: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  holdingBottom: { flexDirection: "row", gap: 16 },
  holdingDetail: { fontSize: 12, color: COLORS.textMuted },
  empty: { alignItems: "center", paddingVertical: 48 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: "600", color: COLORS.text, marginBottom: 6 },
  emptySub: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", paddingHorizontal: 32 },
});
