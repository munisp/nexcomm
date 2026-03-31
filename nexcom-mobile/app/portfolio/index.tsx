/**
 * Portfolio Screen — NEXCOM Mobile
 * Shows the user's commodity holdings, P&L, and allocation breakdown.
 */
import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../constants/config";

interface Holding {
  symbol: string; name: string; quantity: number; avgCost: number;
  currentPrice: number; value: number; pnl: number; pnlPct: number;
}

const MOCK_HOLDINGS: Holding[] = [
  { symbol: "GINGER-NG-SPOT", name: "Ginger (Nigeria)", quantity: 500, avgCost: 1850, currentPrice: 1920, value: 960000, pnl: 35000, pnlPct: 3.78 },
  { symbol: "SESAME-NG-SPOT", name: "Sesame Seeds", quantity: 200, avgCost: 2100, currentPrice: 2050, value: 410000, pnl: -10000, pnlPct: -2.38 },
  { symbol: "COCOA-NG-SPOT",  name: "Cocoa Beans",  quantity: 100, avgCost: 3400, currentPrice: 3580, value: 358000, pnl: 18000, pnlPct: 5.29 },
  { symbol: "PALM-NG-SPOT",   name: "Palm Oil",     quantity: 300, avgCost: 1200, currentPrice: 1185, value: 355500, pnl: -4500, pnlPct: -1.25 },
];

export default function PortfolioScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [holdings] = useState<Holding[]>(MOCK_HOLDINGS);

  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const totalPnl   = holdings.reduce((s, h) => s + h.pnl, 0);
  const totalPnlPct = (totalPnl / (totalValue - totalPnl)) * 100;

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Portfolio</Text>
        </View>

        {/* Summary card */}
        <View style={s.summaryCard}>
          <Text style={s.summaryLabel}>Total Value</Text>
          <Text style={s.summaryValue}>₦{totalValue.toLocaleString()}</Text>
          <View style={s.pnlRow}>
            <Text style={[s.pnlText, totalPnl >= 0 ? s.profit : s.loss]}>
              {totalPnl >= 0 ? "+" : ""}₦{totalPnl.toLocaleString()}
            </Text>
            <Text style={[s.pnlPct, totalPnl >= 0 ? s.profit : s.loss]}>
              ({totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(2)}%)
            </Text>
          </View>
        </View>

        {/* Holdings list */}
        <Text style={s.sectionTitle}>Holdings</Text>
        {holdings.map((h) => (
          <TouchableOpacity key={h.symbol} style={s.holdingCard}>
            <View style={s.holdingLeft}>
              <Text style={s.holdingSymbol}>{h.symbol.split("-")[0]}</Text>
              <Text style={s.holdingName}>{h.name}</Text>
              <Text style={s.holdingQty}>{h.quantity.toLocaleString()} MT</Text>
            </View>
            <View style={s.holdingRight}>
              <Text style={s.holdingValue}>₦{h.value.toLocaleString()}</Text>
              <Text style={[s.holdingPnl, h.pnl >= 0 ? s.profit : s.loss]}>
                {h.pnl >= 0 ? "+" : ""}₦{h.pnl.toLocaleString()}
              </Text>
              <Text style={[s.holdingPnlPct, h.pnl >= 0 ? s.profit : s.loss]}>
                ({h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%)
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d1117" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#e6edf3" },
  summaryCard: { margin: 16, padding: 20, backgroundColor: "#161b22", borderRadius: 16, borderWidth: 1, borderColor: "#30363d" },
  summaryLabel: { fontSize: 13, color: "#8b949e", marginBottom: 4 },
  summaryValue: { fontSize: 32, fontWeight: "700", color: "#e6edf3" },
  pnlRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  pnlText: { fontSize: 16, fontWeight: "600" },
  pnlPct: { fontSize: 14 },
  profit: { color: "#3fb950" },
  loss: { color: "#f85149" },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#8b949e", textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: 20, marginBottom: 8 },
  holdingCard: { marginHorizontal: 16, marginBottom: 8, padding: 16, backgroundColor: "#161b22", borderRadius: 12, borderWidth: 1, borderColor: "#30363d", flexDirection: "row", justifyContent: "space-between" },
  holdingLeft: { flex: 1 },
  holdingSymbol: { fontSize: 15, fontWeight: "700", color: "#e6edf3" },
  holdingName: { fontSize: 12, color: "#8b949e", marginTop: 2 },
  holdingQty: { fontSize: 12, color: "#8b949e", marginTop: 4 },
  holdingRight: { alignItems: "flex-end" },
  holdingValue: { fontSize: 15, fontWeight: "600", color: "#e6edf3" },
  holdingPnl: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  holdingPnlPct: { fontSize: 12, marginTop: 2 },
});
