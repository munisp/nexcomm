import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS } from '../../constants/config';
import { trpc } from '../../lib/trpc';

const POSITIVE = '#22c55e';
const NEGATIVE = '#ef4444';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PERIODS = ['1D', '1W', '1M', '3M', '1Y'] as const;
type Period = typeof PERIODS[number];

export default function AnalyticsScreen() {
  const [period, setPeriod] = useState<Period>('1M');

  const { data: summary, isLoading } = trpc.analytics.getSummary.useQuery(
    { period },
    { retry: 1, staleTime: 60_000 }
  );

  const { data: topMovers } = trpc.analytics.getTopMovers.useQuery(
    { limit: 5 },
    { retry: 1, staleTime: 30_000 }
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Market Analytics</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Period Selector */}
      <View style={styles.periodRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading analytics...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Summary Cards */}
          <View style={styles.cardGrid}>
            <StatCard label="Total Volume" value={summary?.totalVolume ?? 0} prefix="₦" suffix="M" />
            <StatCard label="Trades" value={summary?.totalTrades ?? 0} />
            <StatCard label="Avg Price" value={summary?.avgPrice ?? 0} prefix="₦" />
            <StatCard label="Volatility" value={summary?.volatility ?? 0} suffix="%" />
          </View>

          {/* Top Movers */}
          <Text style={styles.sectionTitle}>Top Movers</Text>
          {(topMovers ?? []).map((item, i) => (
            <TouchableOpacity
              key={item.symbol ?? i}
              style={styles.moverRow}
              onPress={() => router.push(`/trading/${item.symbol}`)}
            >
              <View style={styles.moverLeft}>
                <Text style={styles.moverSymbol}>{item.symbol}</Text>
                <Text style={styles.moverName}>{item.name}</Text>
              </View>
              <View style={styles.moverRight}>
                <Text style={styles.moverPrice}>₦{(item.price ?? 0).toLocaleString()}</Text>
                <Text style={[styles.moverChange, { color: (item.change ?? 0) >= 0 ? COLORS.positive : COLORS.negative }]}>
                  {(item.change ?? 0) >= 0 ? '+' : ''}{(item.change ?? 0).toFixed(2)}%
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          {/* Market Breadth */}
          <Text style={styles.sectionTitle}>Market Breadth</Text>
          <View style={styles.breadthCard}>
            <BreadthBar label="Advancing" value={summary?.advancing ?? 0} total={summary?.totalSymbols ?? 1} color={POSITIVE} />
            <BreadthBar label="Declining" value={summary?.declining ?? 0} total={summary?.totalSymbols ?? 1} color={NEGATIVE} />
            <BreadthBar label="Unchanged" value={summary?.unchanged ?? 0} total={summary?.totalSymbols ?? 1} color={COLORS.textMuted} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCard({ label, value, prefix = '', suffix = '' }: { label: string; value: number; prefix?: string; suffix?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{prefix}{value.toLocaleString()}{suffix}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BreadthBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.breadthRow}>
      <Text style={styles.breadthLabel}>{label}</Text>
      <View style={styles.breadthBarBg}>
        <View style={[styles.breadthBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={styles.breadthValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  backText: { color: COLORS.primary, fontSize: 14 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  periodRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12, gap: 8 },
  periodBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  periodBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  periodText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  periodTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: COLORS.textMuted, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { width: (SCREEN_WIDTH - 42) / 2, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  statValue: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  statLabel: { fontSize: 12, color: COLORS.textMuted },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 10, marginTop: 4 },
  moverRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  moverLeft: { flex: 1 },
  moverSymbol: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  moverName: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  moverRight: { alignItems: 'flex-end' },
  moverPrice: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  moverChange: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  breadthCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  breadthRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breadthLabel: { width: 80, fontSize: 12, color: COLORS.textMuted },
  breadthBarBg: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: 'hidden' },
  breadthBarFill: { height: 8, borderRadius: 4 },
  breadthValue: { width: 32, fontSize: 12, color: COLORS.text, textAlign: 'right' },
  
});
