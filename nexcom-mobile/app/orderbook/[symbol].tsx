/**
 * NEXCOM Mobile — Order Book Screen
 * Live order book depth for a given symbol.
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function OrderBookScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = symbol ?? "MAIZE";
  const obQ = trpc.orders.orderBook.useQuery({ symbol: sym });
  const ob = obQ.data as any;
  const bids: any[] = ob?.bids ?? [];
  const asks: any[] = ob?.asks ?? [];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={obQ.isFetching} onRefresh={() => obQ.refetch()} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={s.header}>
          <Text style={s.title}>{sym} Order Book</Text>
        </View>
        {obQ.isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} /> : (
          <View style={s.grid}>
            {/* Bids */}
            <View style={s.side}>
              <Text style={s.sideHeader}>BIDS</Text>
              <View style={s.tableHeader}>
                <Text style={[s.th, { flex: 1 }]}>PRICE</Text>
                <Text style={[s.th, { flex: 1, textAlign: "right" }]}>QTY</Text>
              </View>
              {bids.slice(0, 12).map((b: any, i: number) => (
                <View key={i} style={s.row}>
                  <Text style={[s.price, s.pos]}>{Number(b.price).toLocaleString()}</Text>
                  <Text style={[s.qty, { textAlign: "right" }]}>{Number(b.quantity).toLocaleString()}</Text>
                </View>
              ))}
              {bids.length === 0 && <Text style={s.empty}>No bids</Text>}
            </View>
            {/* Asks */}
            <View style={s.side}>
              <Text style={s.sideHeader}>ASKS</Text>
              <View style={s.tableHeader}>
                <Text style={[s.th, { flex: 1 }]}>PRICE</Text>
                <Text style={[s.th, { flex: 1, textAlign: "right" }]}>QTY</Text>
              </View>
              {asks.slice(0, 12).map((a: any, i: number) => (
                <View key={i} style={s.row}>
                  <Text style={[s.price, s.neg]}>{Number(a.price).toLocaleString()}</Text>
                  <Text style={[s.qty, { textAlign: "right" }]}>{Number(a.quantity).toLocaleString()}</Text>
                </View>
              ))}
              {asks.length === 0 && <Text style={s.empty}>No asks</Text>}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 24, color: COLORS.text },
  grid: { flexDirection: "row", paddingHorizontal: SPACING.lg, gap: SPACING.md },
  side: { flex: 1 },
  sideHeader: { ...FONTS.subheading, fontSize: 11, color: COLORS.textMuted, letterSpacing: 1, marginBottom: SPACING.sm },
  tableHeader: { flexDirection: "row", marginBottom: SPACING.xs },
  th: { ...FONTS.subheading, fontSize: 10, color: COLORS.textDim },
  row: { flexDirection: "row", paddingVertical: 3 },
  price: { ...FONTS.mono, fontSize: 13, flex: 1 },
  qty: { ...FONTS.mono, fontSize: 13, flex: 1, color: COLORS.textMuted },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
  empty: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
});
