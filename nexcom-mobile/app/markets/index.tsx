/**
 * NEXCOM Mobile — Markets & Instruments Screen
 * Live commodity list with prices from livePrices.getAll.
 */
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function MarketsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const livePricesQ = trpc.livePrices.getAll.useQuery();
  const commoditiesQ = trpc.commodities.list.useQuery();

  const prices: any[] = (livePricesQ.data as any) ?? [];
  const commodities: any[] = (commoditiesQ.data as any) ?? [];

  // Merge live prices into commodity list
  const priceMap = Object.fromEntries(prices.map((p: any) => [p.symbol, p]));
  const instruments = commodities.length > 0 ? commodities : prices;
  const filtered = instruments.filter((c: any) =>
    (c.symbol ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.name ?? c.symbol ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const isLoading = livePricesQ.isLoading || commoditiesQ.isLoading;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Markets</Text>
        <TextInput
          style={s.search}
          placeholder="Search symbol or name..."
          placeholderTextColor={COLORS.textDim}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { livePricesQ.refetch(); commoditiesQ.refetch(); }} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={s.tableHeader}>
              <Text style={[s.th, { flex: 2 }]}>SYMBOL</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>PRICE (NGN)</Text>
              <Text style={[s.th, { flex: 1, textAlign: "right" }]}>CHG%</Text>
            </View>
            {filtered.map((c: any) => {
              const lp = priceMap[c.symbol] ?? c;
              const chg = Number(lp.changePct ?? 0);
              return (
                <TouchableOpacity
                  key={c.symbol}
                  style={s.row}
                  onPress={() => router.push({ pathname: "/market-detail", params: { symbol: c.symbol } })}
                >
                  <View style={{ flex: 2 }}>
                    <Text style={s.symbol}>{c.symbol}</Text>
                    <Text style={s.name}>{c.name ?? c.symbol}</Text>
                  </View>
                  <Text style={[s.price, { flex: 2, textAlign: "right" }]}>
                    {Number(lp.price ?? 0).toLocaleString()}
                  </Text>
                  <Text style={[s.change, { flex: 1, textAlign: "right" }, chg >= 0 ? s.pos : s.neg]}>
                    {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                  </Text>
                </TouchableOpacity>
              );
            })}
            {filtered.length === 0 && <Text style={s.empty}>No instruments found</Text>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 28, color: COLORS.text, marginBottom: SPACING.sm },
  search: { backgroundColor: COLORS.surface, borderRadius: 8, padding: SPACING.sm, color: COLORS.text, ...FONTS.body, fontSize: 14, borderWidth: 1, borderColor: COLORS.border },
  tableHeader: { flexDirection: "row", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  th: { ...FONTS.subheading, fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  symbol: { ...FONTS.subheading, color: COLORS.text, fontSize: 14 },
  name: { ...FONTS.body, color: COLORS.textMuted, fontSize: 12 },
  price: { ...FONTS.mono, color: COLORS.text, fontSize: 14 },
  change: { ...FONTS.mono, fontSize: 13 },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  empty: { ...FONTS.body, color: COLORS.textMuted, textAlign: "center", marginTop: 40 },
});
