/**
 * NEXCOM Mobile — Credit Score Screen
 * Displays the user's credit score, tier, and contributing factors.
 */
import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

function ScoreArc({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 750 ? COLORS.success :
    pct >= 600 ? COLORS.warning :
    COLORS.error;
  return (
    <View style={arc.container}>
      <View style={[arc.circle, { borderColor: color }]}>
        <Text style={[arc.score, { color }]}>{score}</Text>
        <Text style={arc.label}>Credit Score</Text>
      </View>
    </View>
  );
}

const arc = StyleSheet.create({
  container: { alignItems: "center", marginVertical: SPACING.xl },
  circle: { width: 140, height: 140, borderRadius: 70, borderWidth: 6, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface },
  score: { fontSize: 36, fontWeight: "800" },
  label: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
});

export default function CreditScoreScreen() {
  const router = useRouter();
  const scoreQ = trpc.creditScoring?.getMyScore?.useQuery?.() ?? { data: null, isLoading: false, refetch: () => {} };
  const score = (scoreQ.data as any) ?? null;

  const TIER_LABELS: Record<string, string> = {
    PRIME: "Prime",
    NEAR_PRIME: "Near Prime",
    SUBPRIME: "Subprime",
    DEEP_SUBPRIME: "Deep Subprime",
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Credit Score</Text>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={scoreQ.isLoading} onRefresh={() => scoreQ.refetch()} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {score ? (
          <>
            <ScoreArc score={score.score ?? 0} />

            <View style={s.section}>
              <View style={s.card}>
                <View style={s.row}>
                  <Text style={s.rowLabel}>Tier</Text>
                  <Text style={s.rowValue}>{TIER_LABELS[score.tier] ?? score.tier ?? "—"}</Text>
                </View>
                <View style={s.row}>
                  <Text style={s.rowLabel}>Max Loan</Text>
                  <Text style={s.rowValue}>{score.maxLoanAmount != null ? `${score.currency ?? "NGN"} ${Number(score.maxLoanAmount).toLocaleString()}` : "—"}</Text>
                </View>
                <View style={s.row}>
                  <Text style={s.rowLabel}>Interest Rate</Text>
                  <Text style={s.rowValue}>{score.interestRatePct != null ? `${score.interestRatePct}%` : "—"}</Text>
                </View>
                <View style={s.row}>
                  <Text style={s.rowLabel}>Last Updated</Text>
                  <Text style={s.rowValue}>{score.computedAt ? new Date(score.computedAt).toLocaleDateString() : "—"}</Text>
                </View>
              </View>

              {/* Factors */}
              {score.factors && score.factors.length > 0 && (
                <View style={s.factorsSection}>
                  <Text style={s.sectionTitle}>Contributing Factors</Text>
                  {score.factors.map((f: any, i: number) => (
                    <View key={i} style={s.factorRow}>
                      <View style={[s.factorDot, { backgroundColor: f.impact === "positive" ? COLORS.success : f.impact === "negative" ? COLORS.error : COLORS.textMuted }]} />
                      <Text style={s.factorText}>{f.description ?? f.factor}</Text>
                      {f.weight != null && <Text style={s.factorWeight}>{f.weight > 0 ? "+" : ""}{f.weight}</Text>}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        ) : !scoreQ.isLoading ? (
          <View style={s.emptyContainer}>
            <Text style={s.emptyTitle}>No Credit Score</Text>
            <Text style={s.emptyText}>Complete your KYC and make transactions to build your credit profile.</Text>
          </View>
        ) : (
          <View style={s.emptyContainer}>
            <Text style={s.emptyText}>Loading credit score…</Text>
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
  section: { paddingHorizontal: SPACING.lg },
  card: { backgroundColor: COLORS.surface, borderRadius: 8, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowLabel: { color: COLORS.textMuted, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 13, ...FONTS.subheading },
  factorsSection: { marginTop: SPACING.sm },
  sectionTitle: { ...FONTS.subheading, color: COLORS.text, fontSize: 15, marginBottom: SPACING.sm },
  factorRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  factorDot: { width: 8, height: 8, borderRadius: 4, marginRight: SPACING.sm },
  factorText: { flex: 1, color: COLORS.text, fontSize: 13 },
  factorWeight: { color: COLORS.textMuted, fontSize: 12, ...FONTS.mono },
  emptyContainer: { alignItems: "center", paddingTop: SPACING["3xl"], paddingHorizontal: SPACING.xl },
  emptyTitle: { ...FONTS.heading, color: COLORS.text, fontSize: 18, marginBottom: SPACING.sm },
  emptyText: { color: COLORS.textMuted, textAlign: "center", lineHeight: 22 },
});
