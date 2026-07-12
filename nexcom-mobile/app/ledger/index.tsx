/**
 * NEXCOM Mobile — Ledger Screen
 * Displays the user's full transaction ledger with debit/credit entries.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

const ENTRY_ICONS: Record<string, string> = {
  DEBIT: "↓",
  CREDIT: "↑",
  FEE: "⊖",
  TRANSFER: "⇄",
  SETTLEMENT: "✓",
};

export default function LedgerScreen() {
  const router = useRouter();
  const [page, setPage] = useState(1);

  const ledgerQ = trpc.ledger?.getMyEntries?.useQuery?.({ page, pageSize: 30 }) ?? { data: null, isLoading: false, refetch: () => {} };
  const entries: any[] = (ledgerQ.data as any)?.entries ?? [];
  const total: number = (ledgerQ.data as any)?.total ?? 0;
  const isLoading = ledgerQ.isLoading;

  const formatAmount = (amount: number | string, currency: string, type: string) => {
    const n = Number(amount);
    const sign = type === "DEBIT" || type === "FEE" ? "-" : "+";
    const color = sign === "-" ? COLORS.error : COLORS.success;
    return { text: `${sign}${currency ?? ""} ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color };
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Ledger</Text>
        <Text style={s.count}>{total} entries</Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item, i) => item.id?.toString() ?? i.toString()}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { setPage(1); ledgerQ.refetch(); }} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          !isLoading ? (
            <View style={s.emptyContainer}>
              <Text style={s.emptyText}>No ledger entries found.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const amt = formatAmount(item.amount, item.currency, item.entryType);
          return (
            <View style={s.row}>
              <View style={s.iconBox}>
                <Text style={[s.icon, { color: amt.color }]}>{ENTRY_ICONS[item.entryType] ?? "•"}</Text>
              </View>
              <View style={s.info}>
                <Text style={s.description} numberOfLines={1}>{item.description ?? item.reference ?? "Transaction"}</Text>
                <Text style={s.date}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}</Text>
              </View>
              <View style={s.amountBox}>
                <Text style={[s.amount, { color: amt.color }]}>{amt.text}</Text>
                <Text style={s.balance}>{item.runningBalance != null ? `Bal: ${Number(item.runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}</Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          entries.length > 0 && entries.length < total ? (
            <TouchableOpacity style={s.loadMore} onPress={() => setPage((p) => p + 1)}>
              <Text style={s.loadMoreText}>Load More</Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { marginRight: SPACING.md },
  backText: { color: COLORS.primary, fontSize: 15 },
  title: { ...FONTS.heading, color: COLORS.text, fontSize: 18, flex: 1 },
  count: { color: COLORS.textMuted, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  iconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", marginRight: SPACING.md },
  icon: { fontSize: 16, fontWeight: "700" },
  info: { flex: 1 },
  description: { color: COLORS.text, fontSize: 14 },
  date: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  amountBox: { alignItems: "flex-end" },
  amount: { fontSize: 14, ...FONTS.mono, fontWeight: "700" },
  balance: { color: COLORS.textDim, fontSize: 10, marginTop: 2 },
  emptyContainer: { alignItems: "center", paddingTop: SPACING["3xl"] },
  emptyText: { color: COLORS.textMuted },
  loadMore: { margin: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: 8, alignItems: "center" },
  loadMoreText: { color: COLORS.primary, ...FONTS.subheading },
});
