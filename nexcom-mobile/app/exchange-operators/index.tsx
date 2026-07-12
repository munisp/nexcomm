/**
 * NEXCOM Mobile — Exchange Operators Screen
 * Admin view of registered exchange operators with activate/suspend actions.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  active: COLORS.success,
  pending: COLORS.warning,
  suspended: COLORS.error,
  inactive: COLORS.textMuted,
};

export default function ExchangeOperatorsScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const listQ = trpc.exchangeOperator.list.useQuery({ page: 1, pageSize: 50 });
  const operators: any[] = (listQ.data as any)?.operators ?? [];
  const isLoading = listQ.isLoading;

  const activateMut = trpc.exchangeOperator.activate.useMutation({
    onSuccess: () => utils.exchangeOperator.list.invalidate(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const suspendMut = trpc.exchangeOperator.suspend.useMutation({
    onSuccess: () => utils.exchangeOperator.list.invalidate(),
    onError: (e) => Alert.alert("Error", e.message),
  });

  const handleActivate = (id: number, code: string) => {
    Alert.alert("Activate Operator", `Activate ${code}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Activate", onPress: () => activateMut.mutate({ operatorId: id }) },
    ]);
  };

  const handleSuspend = (id: number, code: string) => {
    Alert.alert("Suspend Operator", `Suspend ${code}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Suspend", style: "destructive", onPress: () => suspendMut.mutate({ operatorId: id, reason: "Suspended via mobile admin" }) },
    ]);
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Exchange Operators</Text>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => listQ.refetch()} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={s.section}>
          {operators.length === 0 && !isLoading && (
            <Text style={s.emptyText}>No exchange operators registered.</Text>
          )}
          {operators.map((op: any) => (
            <View key={op.id} style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.operatorCode}>{op.operatorCode}</Text>
                <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[op.status] ?? COLORS.textMuted }]}>
                  <Text style={s.statusText}>{(op.status ?? "unknown").toUpperCase()}</Text>
                </View>
              </View>
              <Text style={s.legalName}>{op.legalName}</Text>
              {op.tradingName ? <Text style={s.tradingName}>{op.tradingName}</Text> : null}

              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Jurisdiction</Text>
                <Text style={s.metaValue}>{op.jurisdiction ?? "—"}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Tier</Text>
                <Text style={s.metaValue}>{op.tier ?? "—"}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Settlement</Text>
                <Text style={s.metaValue}>{op.settlementCurrency ?? "—"}</Text>
              </View>

              {/* Actions */}
              <View style={s.actions}>
                {op.status !== "active" && (
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: COLORS.success }]}
                    onPress={() => handleActivate(op.id, op.operatorCode)}
                    disabled={activateMut.isPending}
                  >
                    <Text style={s.actionText}>Activate</Text>
                  </TouchableOpacity>
                )}
                {op.status === "active" && (
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: COLORS.error }]}
                    onPress={() => handleSuspend(op.id, op.operatorCode)}
                    disabled={suspendMut.isPending}
                  >
                    <Text style={s.actionText}>Suspend</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
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
  card: { backgroundColor: COLORS.surface, borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.sm },
  operatorCode: { ...FONTS.heading, color: COLORS.primary, fontSize: 16 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  legalName: { color: COLORS.text, fontSize: 14, ...FONTS.subheading },
  tradingName: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  metaLabel: { color: COLORS.textMuted, fontSize: 12 },
  metaValue: { color: COLORS.text, fontSize: 12 },
  actions: { flexDirection: "row", marginTop: SPACING.md, gap: SPACING.sm },
  actionBtn: { flex: 1, paddingVertical: SPACING.sm, borderRadius: 6, alignItems: "center" },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  emptyText: { color: COLORS.textMuted, textAlign: "center", marginTop: SPACING.xl },
});
