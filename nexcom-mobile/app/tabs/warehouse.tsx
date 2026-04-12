import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { trpc } from '../../lib/trpc';

type InventoryItem = {
  id: number;
  receiptNumber: string;
  commodityName: string | null;
  quantity: string;
  unit: string | null;
  warehouseName: string | null;
  location: string | null;
  depositDate: number | null;
  expiryDate: number | null;
  qualityGrade: string | null;
  status: string;
  estimatedValue: string | null;
  isPledged: boolean | null;
};

const RECEIPTS_PLACEHOLDER = [
  {
    id: 'WR-2024-001',
    commodity: 'White Maize',
    quantity: 500,
    unit: 'MT',
    warehouse: 'Kano Central Warehouse',
    location: 'Kano, Nigeria',
    depositDate: '2024-01-15',
    expiryDate: '2024-07-15',
    quality: 'Grade A',
    status: 'ACTIVE',
    value: 142500000,
    pledged: false,
  },
  {
    id: 'WR-2024-002',
    commodity: 'Soybean',
    quantity: 200,
    unit: 'MT',
    warehouse: 'Lagos Port Warehouse',
    location: 'Lagos, Nigeria',
    depositDate: '2024-02-01',
    expiryDate: '2024-08-01',
    quality: 'Grade A',
    status: 'PLEDGED',
    value: 104000000,
    pledged: true,
  },
  {
    id: 'WR-2024-003',
    commodity: 'Cocoa Beans',
    quantity: 50,
    unit: 'MT',
    warehouse: 'Ibadan Cold Storage',
    location: 'Oyo, Nigeria',
    depositDate: '2024-01-28',
    expiryDate: '2024-04-28',
    quality: 'Premium',
    status: 'INSPECTION_DUE',
    value: 242500000,
    pledged: false,
  },
  {
    id: 'WR-2024-004',
    commodity: 'Sesame Seeds',
    quantity: 100,
    unit: 'MT',
    warehouse: 'Borno Agri Hub',
    location: 'Borno, Nigeria',
    depositDate: '2024-03-01',
    expiryDate: '2024-09-01',
    quality: 'Grade B',
    status: 'ACTIVE',
    value: 125000000,
    pledged: false,
  },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _RECEIPTS_PLACEHOLDER = RECEIPTS_PLACEHOLDER;

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: COLORS.success,
  PLEDGED: COLORS.warning,
  INSPECTION_DUE: COLORS.error,
  EXPIRED: COLORS.textDim,
  RELEASED: COLORS.info,
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  PLEDGED: 'Pledged',
  INSPECTION_DUE: 'Inspection Due',
  EXPIRED: 'Expired',
  RELEASED: 'Released',
};

function ReceiptCard({ item }: { item: InventoryItem }) {
  const statusColor = STATUS_COLORS[item.status] || COLORS.textMuted;
  const value = Number(item.estimatedValue ?? 0);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/warehouse/${item.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.receiptId}>{item.receiptNumber}</Text>
          <Text style={styles.commodity}>{item.commodityName ?? 'Unknown'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {STATUS_LABELS[item.status] ?? item.status}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>📦</Text>
          <Text style={styles.infoText}>
            {Number(item.quantity).toLocaleString()} {item.unit ?? 'MT'} · {item.qualityGrade ?? 'N/A'}
          </Text>
        </View>
        {item.warehouseName && (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>🏭</Text>
            <Text style={styles.infoText}>{item.warehouseName}</Text>
          </View>
        )}
        {item.location && (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>📍</Text>
            <Text style={styles.infoText}>{item.location}</Text>
          </View>
        )}
        {item.expiryDate && (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>📅</Text>
            <Text style={styles.infoText}>
              Expires: {new Date(item.expiryDate).toLocaleDateString()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.valueLabel}>Estimated Value</Text>
          <Text style={styles.valueAmount}>
            ₦{value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value.toLocaleString()}
          </Text>
        </View>
        {item.isPledged && (
          <View style={styles.pledgedBadge}>
            <Text style={styles.pledgedText}>🔒 Pledged as Collateral</Text>
          </View>
        )}
        {!item.isPledged && item.status === 'ACTIVE' && (
          <TouchableOpacity style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>Pledge →</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function WarehouseScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const inventoryQuery = trpc.warehouseInventory.myInventory.useQuery();
  const allItems: InventoryItem[] = (inventoryQuery.data ?? []) as InventoryItem[];

  const filters = ['All', 'Active', 'Pledged', 'Inspection Due'];

  const filtered = allItems.filter((r) => {
    const matchSearch =
      search === '' ||
      r.receiptNumber.toLowerCase().includes(search.toLowerCase()) ||
      (r.commodityName ?? '').toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'All' ||
      (filter === 'Active' && r.status === 'ACTIVE') ||
      (filter === 'Pledged' && r.status === 'PLEDGED') ||
      (filter === 'Inspection Due' && r.status === 'INSPECTION_DUE');
    return matchSearch && matchFilter;
  });

  const totalValue = allItems.reduce((sum, r) => sum + Number(r.estimatedValue ?? 0), 0);
  const totalQty = allItems.reduce((sum, r) => sum + Number(r.quantity), 0);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {inventoryQuery.isLoading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 16 }} />}
      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total WRs</Text>
          <Text style={styles.summaryValue}>{allItems.length}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Qty</Text>
          <Text style={styles.summaryValue}>{totalQty.toLocaleString()} MT</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Value</Text>
          <Text style={styles.summaryValue}>
            ₦{(totalValue / 1_000_000).toFixed(0)}M
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search receipts..."
          placeholderTextColor={COLORS.textDim}
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity style={styles.newBtn}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[styles.filterText, filter === f && styles.filterTextActive]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Receipt List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ReceiptCard item={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={inventoryQuery.isFetching}
            onRefresh={() => inventoryQuery.refetch()}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🏭</Text>
            <Text style={styles.emptyText}>
              {inventoryQuery.isLoading ? 'Loading...' : 'No warehouse receipts found'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  summaryRow: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 8,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 4,
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
  },
  newBtn: {
    backgroundColor: `${COLORS.primary}20`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  newBtnText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterBtnActive: {
    backgroundColor: `${COLORS.primary}20`,
    borderColor: COLORS.primary,
  },
  filterText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '500',
  },
  filterTextActive: { color: COLORS.primary, fontWeight: '700' },

  list: { padding: 16, paddingTop: 8, gap: 12 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  receiptId: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    marginBottom: 2,
  },
  commodity: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
  },

  cardBody: { gap: 6, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoIcon: { fontSize: 14, width: 20 },
  infoText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    flex: 1,
  },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  valueLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 2,
  },
  valueAmount: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
  },
  pledgedBadge: {
    backgroundColor: `${COLORS.warning}20`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  pledgedText: {
    color: COLORS.warning,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
  },
  actionBtn: {
    backgroundColor: `${COLORS.primary}20`,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  actionBtnText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },

  empty: { padding: 40, alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.base },
});
