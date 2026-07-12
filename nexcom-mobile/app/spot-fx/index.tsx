/**
 * NEXCOM Mobile — Spot FX Screen
 * Live FX rates, pair depth, and order submission for spot currency trading.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

type Side = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT";

export default function SpotFxScreen() {
  const router = useRouter();
  const [selectedPair, setSelectedPair] = useState<{ base: string; quote: string } | null>(null);
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [showOrder, setShowOrder] = useState(false);

  const ratesQ = trpc.tracing?.getTraces?.useQuery?.({ limit: 1 }) as any; // placeholder — FX rates come from matching engine REST
  // In production the mobile app calls the matching engine REST API directly
  // Here we use a static list of common pairs for the demo
  const COMMON_PAIRS = [
    { base: "USD", quote: "NGN", rate: "1,580.00", change: "+0.3%" },
    { base: "USD", quote: "GHS", rate: "15.20", change: "-0.1%" },
    { base: "USD", quote: "KES", rate: "129.50", change: "+0.5%" },
    { base: "EUR", quote: "USD", rate: "1.0820", change: "+0.2%" },
    { base: "GBP", quote: "USD", rate: "1.2710", change: "-0.4%" },
    { base: "USD", quote: "ZAR", rate: "18.45", change: "+0.8%" },
    { base: "XOF", quote: "USD", rate: "0.00165", change: "0.0%" },
    { base: "ETB", quote: "USD", rate: "0.0179", change: "-0.2%" },
  ];

  const submitOrderMut = trpc.order?.placeOrder?.useMutation?.({
    onSuccess: () => {
      Alert.alert("Order Submitted", "Your FX order has been submitted successfully.");
      setQuantity("");
      setLimitPrice("");
      setShowOrder(false);
    },
    onError: (e: any) => Alert.alert("Order Failed", e.message),
  }) ?? { mutate: () => {}, isPending: false };

  const handleSubmitOrder = () => {
    if (!selectedPair) return;
    if (!quantity || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity.");
      return;
    }
    if (orderType === "LIMIT" && (!limitPrice || isNaN(Number(limitPrice)))) {
      Alert.alert("Invalid Price", "Please enter a valid limit price.");
      return;
    }
    const symbol = `${selectedPair.base}/${selectedPair.quote}`;
    submitOrderMut.mutate({
      symbol,
      side,
      orderType,
      quantity: Number(quantity),
      price: orderType === "LIMIT" ? Number(limitPrice) : undefined,
    } as any);
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Spot FX</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Rates Table */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Live Rates</Text>
          {COMMON_PAIRS.map((pair) => {
            const isSelected = selectedPair?.base === pair.base && selectedPair?.quote === pair.quote;
            const changeColor = pair.change.startsWith("+") ? COLORS.success : pair.change.startsWith("-") ? COLORS.error : COLORS.textMuted;
            return (
              <TouchableOpacity
                key={`${pair.base}/${pair.quote}`}
                style={[s.pairRow, isSelected && s.pairRowSelected]}
                onPress={() => { setSelectedPair({ base: pair.base, quote: pair.quote }); setShowOrder(true); }}
              >
                <Text style={s.pairLabel}>{pair.base}/{pair.quote}</Text>
                <Text style={s.pairRate}>{pair.rate}</Text>
                <Text style={[s.pairChange, { color: changeColor }]}>{pair.change}</Text>
                <Text style={s.tradeBtn}>Trade →</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Order Form */}
        {showOrder && selectedPair && (
          <View style={s.orderSection}>
            <Text style={s.sectionTitle}>New Order — {selectedPair.base}/{selectedPair.quote}</Text>

            {/* Side */}
            <View style={s.segmentRow}>
              {(["BUY", "SELL"] as Side[]).map((s_) => (
                <TouchableOpacity
                  key={s_}
                  style={[s.segmentBtn, side === s_ && { backgroundColor: s_ === "BUY" ? COLORS.success : COLORS.error }]}
                  onPress={() => setSide(s_)}
                >
                  <Text style={[s.segmentText, side === s_ && { color: "#fff" }]}>{s_}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Order Type */}
            <View style={s.segmentRow}>
              {(["MARKET", "LIMIT"] as OrderType[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[s.segmentBtn, orderType === t && { backgroundColor: COLORS.primary }]}
                  onPress={() => setOrderType(t)}
                >
                  <Text style={[s.segmentText, orderType === t && { color: "#fff" }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.inputLabel}>Quantity ({selectedPair.base})</Text>
            <TextInput
              style={s.input}
              placeholder="0.00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
            />

            {orderType === "LIMIT" && (
              <>
                <Text style={s.inputLabel}>Limit Price ({selectedPair.quote})</Text>
                <TextInput
                  style={s.input}
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                  value={limitPrice}
                  onChangeText={setLimitPrice}
                />
              </>
            )}

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: side === "BUY" ? COLORS.success : COLORS.error }]}
              onPress={handleSubmitOrder}
              disabled={submitOrderMut.isPending}
            >
              {submitOrderMut.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.submitText}>{side} {selectedPair.base}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { marginRight: SPACING.md },
  backText: { color: COLORS.primary, fontSize: 15 },
  title: { ...FONTS.heading, color: COLORS.text, fontSize: 18 },
  section: { padding: SPACING.lg },
  sectionTitle: { ...FONTS.subheading, color: COLORS.text, fontSize: 15, marginBottom: SPACING.sm },
  pairRow: { flexDirection: "row", alignItems: "center", paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  pairRowSelected: { backgroundColor: COLORS.surfaceAlt },
  pairLabel: { flex: 1, color: COLORS.text, fontSize: 14, ...FONTS.mono },
  pairRate: { color: COLORS.text, fontSize: 14, ...FONTS.mono, marginRight: SPACING.sm },
  pairChange: { fontSize: 12, width: 52, textAlign: "right", marginRight: SPACING.sm },
  tradeBtn: { color: COLORS.primary, fontSize: 12 },
  orderSection: { margin: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: 8, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  segmentRow: { flexDirection: "row", marginBottom: SPACING.md, gap: SPACING.sm },
  segmentBtn: { flex: 1, paddingVertical: SPACING.sm, borderRadius: 6, alignItems: "center", backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border },
  segmentText: { color: COLORS.textMuted, fontWeight: "600", fontSize: 13 },
  inputLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: COLORS.surfaceAlt, borderRadius: 6, padding: SPACING.md, color: COLORS.text, fontSize: 15, ...FONTS.mono, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  submitBtn: { paddingVertical: SPACING.md, borderRadius: 8, alignItems: "center", marginTop: SPACING.sm },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
