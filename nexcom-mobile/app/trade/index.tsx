/**
 * NEXCOM Mobile — Trade Screen
 * Place market/limit orders with live price reference.
 */
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function TradeScreen() {
  const [symbol, setSymbol] = useState("MAIZE");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("LIMIT");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");

  const utils = trpc.useUtils();
  const livePricesQ = trpc.livePrices.getAll.useQuery();
  const openOrdersQ = trpc.orders.list.useQuery({ status: "OPEN", limit: 20 });
  const placeMutation = trpc.orders.create.useMutation({
    onSuccess: () => {
      Alert.alert("Order Placed", `${side} ${quantity} ${symbol} order submitted.`);
      setQuantity("");
      setPrice("");
      utils.orders.list.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const prices: any[] = (livePricesQ.data as any) ?? [];
  const livePrice = prices.find((p: any) => p.symbol === symbol);
  const openOrders: any[] = (openOrdersQ.data as any) ?? [];

  function handlePlace() {
    if (!quantity || Number(quantity) <= 0) { Alert.alert("Error", "Enter a valid quantity"); return; }
    if (orderType === "LIMIT" && (!price || Number(price) <= 0)) { Alert.alert("Error", "Enter a valid limit price"); return; }
    placeMutation.mutate({
      symbol,
      side,
      orderType,
      quantity: Number(quantity),
      ...(orderType === "LIMIT" ? { price: Number(price) } : {}),
    });
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Trade</Text>
        </View>

        {/* Order Form */}
        <View style={s.card}>
          <Text style={s.cardTitle}>New Order</Text>
          <TextInput style={s.input} value={symbol} onChangeText={setSymbol} placeholder="Symbol (e.g. MAIZE)" placeholderTextColor={COLORS.textDim} autoCapitalize="characters" />
          {livePrice && (
            <Text style={s.priceRef}>Live: ₦{Number(livePrice.price).toLocaleString()} ({Number(livePrice.changePct) >= 0 ? "+" : ""}{Number(livePrice.changePct).toFixed(2)}%)</Text>
          )}
          {/* Side */}
          <View style={s.segRow}>
            {(["BUY", "SELL"] as const).map(v => (
              <TouchableOpacity key={v} style={[s.seg, side === v && (v === "BUY" ? s.segBuy : s.segSell)]} onPress={() => setSide(v)}>
                <Text style={[s.segText, side === v && s.segTextActive]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Order type */}
          <View style={s.segRow}>
            {(["MARKET", "LIMIT"] as const).map(v => (
              <TouchableOpacity key={v} style={[s.seg, orderType === v && s.segActive]} onPress={() => setOrderType(v)}>
                <Text style={[s.segText, orderType === v && s.segTextActive]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={s.input} value={quantity} onChangeText={setQuantity} placeholder="Quantity" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />
          {orderType === "LIMIT" && (
            <TextInput style={s.input} value={price} onChangeText={setPrice} placeholder="Limit Price (NGN)" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />
          )}
          <TouchableOpacity style={[s.placeBtn, side === "BUY" ? s.buyBtn : s.sellBtn, placeMutation.isPending && s.btnDisabled]} onPress={handlePlace} disabled={placeMutation.isPending}>
            {placeMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.placeBtnText}>{side} {symbol}</Text>}
          </TouchableOpacity>
        </View>

        {/* Open Orders */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Open Orders ({openOrders.length})</Text>
          {openOrdersQ.isLoading ? <ActivityIndicator color={COLORS.primary} /> : openOrders.slice(0, 8).map((o: any) => (
            <View key={o.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.symbol}>{o.symbol}</Text>
                <Text style={s.muted}>{o.orderType} · Qty {o.quantity}</Text>
              </View>
              <Text style={[s.price, o.side === "BUY" ? s.pos : s.neg]}>{o.side}</Text>
            </View>
          ))}
          {openOrders.length === 0 && !openOrdersQ.isLoading && <Text style={s.muted}>No open orders</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 28, color: COLORS.text },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { ...FONTS.subheading, fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { backgroundColor: COLORS.surfaceAlt, borderRadius: 8, padding: SPACING.sm, color: COLORS.text, ...FONTS.body, fontSize: 14, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  priceRef: { ...FONTS.mono, color: COLORS.primary, fontSize: 13, marginBottom: SPACING.sm },
  segRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.sm },
  seg: { flex: 1, padding: SPACING.sm, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  segActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segBuy: { backgroundColor: COLORS.buy, borderColor: COLORS.buy },
  segSell: { backgroundColor: COLORS.sell, borderColor: COLORS.sell },
  segText: { ...FONTS.subheading, color: COLORS.textMuted, fontSize: 13 },
  segTextActive: { color: "#fff" },
  placeBtn: { borderRadius: 8, padding: SPACING.md, alignItems: "center", marginTop: SPACING.sm },
  buyBtn: { backgroundColor: COLORS.buy },
  sellBtn: { backgroundColor: COLORS.sell },
  btnDisabled: { opacity: 0.6 },
  placeBtnText: { ...FONTS.heading, color: "#fff", fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  symbol: { ...FONTS.subheading, color: COLORS.text, fontSize: 14 },
  muted: { ...FONTS.body, color: COLORS.textMuted, fontSize: 12 },
  price: { ...FONTS.mono, color: COLORS.text, fontSize: 14 },
  pos: { color: COLORS.success },
  neg: { color: COLORS.error },
});
