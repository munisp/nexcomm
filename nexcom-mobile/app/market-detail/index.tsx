/**
 * NEXCOM Mobile — Market Detail Screen
 * Price history chart data + order book for a given symbol.
 */
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

const INTERVALS = ["1D", "1W", "1M", "3M"];

export default function MarketDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const [interval, setInterval] = useState("1D");
  const sym = symbol ?? "MAIZE";

  const historyQ = trpc.commodities.priceHistory.useQuery({ symbol: sym, interval });
  const livePricesQ = trpc.livePrices.getAll.useQuery();

  const prices: any[] = (livePricesQ.data as any) ?? [];
  const lp = prices.find((p: any) => p.symbol === sym);
  const history: any = historyQ.data;
  const candles: any[] = history?.candles ?? [];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>{sym}</Text>
          {lp && (
            <View style={s.priceRow}>
              <Text style={s.bigPrice}>₦{Number(lp.price).toLocaleString()}</Text>
              <Text style={[s.change, Number(lp.changePct) >= 0 ? s.pos : s.neg]}>
                {Number(lp.changePct) >= 0 ? "+" : ""}{Number(lp.changePct).toFixed(2)}%
              </Text>
            </View>
          )}
        </View>

        {/* Interval selector */}
        <View style={s.intervals}>
          {INTERVALS.map(iv => (
            <TouchableOpacity key={iv} style={[s.ivBtn, interval === iv && s.ivBtnActive]} onPress={() => setInterval(iv)}>
              <Text style={[s.ivText, interval === iv && s.ivTextActive]}>{iv}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* OHLCV table */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Price History ({candles.length} bars)</Text>
          {historyQ.isLoading ? <ActivityIndicator color={COLORS.primary} /> : (
            <>
              <View style={s.tableHeader}>
                {["Date", "Open", "High", "Low", "Close"].map(h => (
                  <Text key={h} style={[s.th, { flex: 1, textAlign: h === "Date" ? "left" : "right" }]}>{h}</Text>
                ))}
              </View>
              {candles.slice(-10).reverse().map((c: any, i: number) => (
                <View key={i} style={s.tableRow}>
                  <Text style={[s.td, { flex: 1 }]}>{new Date(c.time ?? c.timestamp ?? 0).toLocaleDateString()}</Text>
                  <Text style={[s.td, { flex: 1, textAlign: "right" }]}>{Number(c.open).toLocaleString()}</Text>
                  <Text style={[s.td, { flex: 1, textAlign: "right" }]}>{Number(c.high).toLocaleString()}</Text>
                  <Text style={[s.td, { flex: 1, textAlign: "right" }]}>{Number(c.low).toLocaleString()}</Text>
                  <Text style={[s.td, { flex: 1, textAlign: "right" }]}>{Number(c.close).toLocaleString()}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Trade button */}
        <TouchableOpacity style={s.tradeBtn} onPress={() => router.push({ pathname: "/trading/[symbol]", params: { symbol: sym } })}>
          <Text style={s.tradeBtnText}>Trade {sym}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 28, color: COLORS.text },
  priceRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginTop: 4 },
  bigPrice: { ...FONTS.heading, fontSize: 24, color: COLORS.text },
  change: { ...FONTS.mono, fontSize: 16 },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  intervals: { flexDirection: "row", paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  ivBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  ivBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  ivText: { ...FONTS.subheading, color: COLORS.textMuted, fontSize: 13 },
  ivTextActive: { color: "#fff" },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { ...FONTS.subheading, fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  tableHeader: { flexDirection: "row", marginBottom: SPACING.sm },
  th: { ...FONTS.subheading, fontSize: 11, color: COLORS.textMuted },
  tableRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  td: { ...FONTS.mono, fontSize: 12, color: COLORS.text },
  tradeBtn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: SPACING.md, marginHorizontal: SPACING.lg, alignItems: "center" },
  tradeBtnText: { ...FONTS.heading, color: "#fff", fontSize: 16 },
});
