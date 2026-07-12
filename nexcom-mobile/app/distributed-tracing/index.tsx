/**
 * NEXCOM Mobile — Distributed Tracing Screen
 * Admin view of OTel trace spans, service map, and slow operations.
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
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

type TabKey = "traces" | "services" | "slow";

export default function DistributedTracingScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("traces");

  const tracesQ = trpc.tracing.getTraces.useQuery({ limit: 30 });
  const serviceMapQ = trpc.tracing.getServiceMap.useQuery();
  const slowOpsQ = trpc.tracing.getSlowOperations.useQuery({ limit: 20 });

  const isLoading = tracesQ.isLoading || serviceMapQ.isLoading || slowOpsQ.isLoading;

  const traces: any[] = (tracesQ.data as any) ?? [];
  const services: any[] = (serviceMapQ.data as any)?.services ?? [];
  const slowOps: any[] = (slowOpsQ.data as any) ?? [];

  const refetchAll = () => {
    tracesQ.refetch();
    serviceMapQ.refetch();
    slowOpsQ.refetch();
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "traces", label: "Traces" },
    { key: "services", label: "Services" },
    { key: "slow", label: "Slow Ops" },
  ];

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Distributed Tracing</Text>
      </View>

      {/* Tab Bar */}
      <View style={s.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabItem, tab === t.key && s.tabItemActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetchAll} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Traces Tab */}
        {tab === "traces" && (
          <View style={s.section}>
            {traces.length === 0 && !isLoading && (
              <Text style={s.emptyText}>No traces found.</Text>
            )}
            {traces.map((trace: any, i: number) => (
              <View key={trace.traceId ?? i} style={s.card}>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Service</Text>
                  <Text style={s.cardValue}>{trace.serviceName ?? "—"}</Text>
                </View>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Operation</Text>
                  <Text style={s.cardValue} numberOfLines={1}>{trace.operationName ?? "—"}</Text>
                </View>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Duration</Text>
                  <Text style={[s.cardValue, { color: (trace.durationMs ?? 0) > 500 ? COLORS.warning : COLORS.success }]}>
                    {trace.durationMs != null ? `${trace.durationMs} ms` : "—"}
                  </Text>
                </View>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Status</Text>
                  <Text style={[s.cardValue, { color: trace.statusCode === "ERROR" ? COLORS.error : COLORS.success }]}>
                    {trace.statusCode ?? "OK"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Services Tab */}
        {tab === "services" && (
          <View style={s.section}>
            {services.length === 0 && !isLoading && (
              <Text style={s.emptyText}>No service data available.</Text>
            )}
            {services.map((svc: any, i: number) => (
              <View key={svc.name ?? i} style={s.card}>
                <Text style={s.cardTitle}>{svc.name ?? "Unknown"}</Text>
                <View style={s.statsRow}>
                  <View style={s.statBox}>
                    <Text style={s.statValue}>{svc.spanCount ?? 0}</Text>
                    <Text style={s.statLabel}>Spans</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statValue, { color: COLORS.error }]}>{svc.errorCount ?? 0}</Text>
                    <Text style={s.statLabel}>Errors</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={s.statValue}>{svc.avgDurationMs != null ? `${svc.avgDurationMs}ms` : "—"}</Text>
                    <Text style={s.statLabel}>Avg</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statValue, { color: COLORS.warning }]}>
                      {svc.p99DurationMs != null ? `${svc.p99DurationMs}ms` : "—"}
                    </Text>
                    <Text style={s.statLabel}>P99</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Slow Ops Tab */}
        {tab === "slow" && (
          <View style={s.section}>
            {slowOps.length === 0 && !isLoading && (
              <Text style={s.emptyText}>No slow operations detected.</Text>
            )}
            {slowOps.map((op: any, i: number) => (
              <View key={op.traceId ?? i} style={s.card}>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Operation</Text>
                  <Text style={s.cardValue} numberOfLines={1}>{op.operationName ?? "—"}</Text>
                </View>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Service</Text>
                  <Text style={s.cardValue}>{op.serviceName ?? "—"}</Text>
                </View>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Duration</Text>
                  <Text style={[s.cardValue, { color: COLORS.error }]}>
                    {op.durationMs != null ? `${op.durationMs} ms` : "—"}
                  </Text>
                </View>
              </View>
            ))}
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
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
  tabItem: { flex: 1, paddingVertical: SPACING.md, alignItems: "center" },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabLabel: { color: COLORS.textMuted, fontSize: 13, ...FONTS.body },
  tabLabelActive: { color: COLORS.primary, ...FONTS.subheading },
  section: { padding: SPACING.lg },
  card: { backgroundColor: COLORS.surface, borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { ...FONTS.subheading, color: COLORS.text, fontSize: 15, marginBottom: SPACING.sm },
  cardRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  cardLabel: { color: COLORS.textMuted, fontSize: 12 },
  cardValue: { color: COLORS.text, fontSize: 12, ...FONTS.mono, maxWidth: "60%" },
  statsRow: { flexDirection: "row", justifyContent: "space-around", marginTop: SPACING.sm },
  statBox: { alignItems: "center" },
  statValue: { color: COLORS.text, fontSize: 16, ...FONTS.heading },
  statLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  emptyText: { color: COLORS.textMuted, textAlign: "center", marginTop: SPACING.xl },
});
