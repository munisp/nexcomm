/**
 * NEXCOM Mobile — Warehouse Receipt Detail Screen
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function WarehouseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const receiptQ = trpc.receipts.get.useQuery({ id: Number(id) });
  const r = receiptQ.data as any;

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>EWR-{id?.padStart(6, "0")}</Text>
        </View>
        {receiptQ.isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : receiptQ.error ? (
          <Text style={s.error}>Failed to load receipt: {receiptQ.error.message}</Text>
        ) : r ? (
          <View style={s.card}>
            {[
              ["Commodity", r.commodityName ?? r.commodityCode],
              ["Status", r.status],
              ["Quantity", `${Number(r.quantity).toLocaleString()} ${r.unit ?? "MT"}`],
              ["Value (NGN)", `₦${Number(r.valueNgn ?? 0).toLocaleString()}`],
              ["Warehouse", r.warehouseName ?? r.warehouseId],
              ["Grade", r.grade ?? "—"],
              ["Deposited", r.depositDate ? new Date(r.depositDate).toLocaleDateString() : "—"],
              ["Expires", r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : "—"],
              ["Owner", r.ownerName ?? r.ownerId],
            ].map(([label, value]) => (
              <View key={label} style={s.row}>
                <Text style={s.label}>{label}</Text>
                <Text style={s.value}>{value ?? "—"}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 24, color: COLORS.text },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginHorizontal: SPACING.lg },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, color: COLORS.text, fontSize: 13, flex: 1, textAlign: "right" },
  error: { ...FONTS.body, color: COLORS.error, margin: SPACING.lg },
});
