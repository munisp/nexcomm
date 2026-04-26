import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS } from '../../constants/config';
import { trpc } from '../../lib/trpc';

export default function RegulatoryScreen() {
  const { data, isLoading, refetch } = trpc.regulatoryReporting.getReports.useQuery(
    undefined,
    { retry: 1, staleTime: 30_000 }
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Regulatory Reports</Text>
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
          <View style={styles.listCard}>
            <Text style={styles.sectionTitle}>All Items</Text>
            {(Array.isArray(data) ? data : []).slice(0, 20).map((item: any, i: number) => (
              <View key={item.id ?? i} style={styles.listRow}>
                <View style={styles.listLeft}>
                  <Text style={styles.listLabel}>{item.name ?? item.title ?? item.symbol ?? item.id ?? `Item ${i + 1}`}</Text>
                  <Text style={styles.listSub}>{item.status ?? item.type ?? item.description ?? ''}</Text>
                </View>
                <Text style={styles.listValue}>{item.value ?? item.amount ?? item.price ?? ''}</Text>
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  listCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  listLeft: { flex: 1 },
  listLabel: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  listSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  listValue: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  emptyText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 20 },
});
