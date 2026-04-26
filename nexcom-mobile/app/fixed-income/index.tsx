import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS } from '../../constants/config';
import { trpc } from '../../lib/trpc';

export default function FixedIncomeScreen() {
  const [tab, setTab] = useState<'overview' | 'list'>('overview');

  const { data, isLoading, refetch } = trpc.fixedIncome.getInstruments.useQuery(
    undefined,
    { retry: 1, staleTime: 30_000 }
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Fixed Income</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.cardGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{(data as any)?.['listedBonds'] ?? '—'}</Text>
              <Text style={styles.statLabel}>Listed Bonds</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>₦{(data as any)?.['totalVolume'] ?? '—'}</Text>
              <Text style={styles.statLabel}>Total Volume</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{(data as any)?.['avgYield'] ?? '—'}%</Text>
              <Text style={styles.statLabel}>Avg Yield</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{(data as any)?.['matured'] ?? '—'}</Text>
              <Text style={styles.statLabel}>Matured</Text>
            </View>

          </View>

          <View style={styles.listCard}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {(Array.isArray(data) ? data : []).slice(0, 10).map((item: any, i: number) => (
              <View key={item.id ?? i} style={styles.listRow}>
                <Text style={styles.listLabel}>{item.name ?? item.symbol ?? item.id ?? `Item ${i + 1}`}</Text>
                <Text style={styles.listValue}>{item.status ?? item.value ?? '—'}</Text>
              </View>
            ))}
            {(!data || (Array.isArray(data) && data.length === 0)) && (
              <Text style={styles.emptyText}>No data available</Text>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  backText: { color: COLORS.primary, fontSize: 14 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  refreshBtn: { padding: 4 },
  refreshText: { color: COLORS.primary, fontSize: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: COLORS.textMuted, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { width: '47%', backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  statValue: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  statLabel: { fontSize: 12, color: COLORS.textMuted },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  listCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  listLabel: { fontSize: 14, color: COLORS.text, flex: 1 },
  listValue: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  emptyText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 20 },
});
