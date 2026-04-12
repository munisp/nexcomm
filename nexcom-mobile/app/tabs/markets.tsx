import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { trpc } from '../../lib/trpc';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CATEGORIES = ['All', 'COMMODITY', 'EQUITY', 'FIXED_INCOME', 'INDEX'];
const CATEGORY_LABELS: Record<string, string> = {
  All: 'All', COMMODITY: 'Commodities', EQUITY: 'Equities',
  FIXED_INCOME: 'Fixed Income', INDEX: 'Indices',
};

type PriceRow = { id: number; symbol: string; name: string | null; assetClass: string; lastPrice: string | null; changePct: string | null; volume24h: string | null; unit: string | null };

function CommodityRow({ item }: { item: PriceRow }) {
  const change = Number(item.changePct ?? 0);
  const isPositive = change >= 0;
  const price = Number(item.lastPrice ?? 0);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/trading/${item.symbol}` as any)}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.symbol}>{item.symbol}</Text>
        <Text style={styles.name}>{item.name ?? item.symbol}</Text>
        <Text style={styles.volume}>
          {item.volume24h ? `Vol: ${Number(item.volume24h).toLocaleString()} ${item.unit ?? ''}` : item.assetClass}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.price}>
          ₦{price >= 1_000_000 ? `${(price / 1_000_000).toFixed(2)}M` : `${(price / 1_000).toFixed(0)}K`}
        </Text>
        <View style={[styles.changeBadge, { backgroundColor: isPositive ? `${COLORS.success}20` : `${COLORS.error}20` }]}>
          <Text style={[styles.change, { color: isPositive ? COLORS.success : COLORS.error }]}>
            {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MarketsScreen() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const pricesQuery = trpc.livePrices.getAll.useQuery();
  const allPrices = pricesQuery.data ?? [];

  const filtered = useMemo(() => {
    return allPrices.filter((c) => {
      const matchesSearch =
        search === '' ||
        c.symbol.toLowerCase().includes(search.toLowerCase()) ||
        (c.name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === 'All' || c.assetClass === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [allPrices, search, activeCategory]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {pricesQuery.isLoading && (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
      )}
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search commodities..."
          placeholderTextColor={COLORS.textDim}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Category Filter */}
      <FlatList
        data={CATEGORIES}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.categoryList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.categoryBtn,
                activeCategory === item && styles.categoryBtnActive,
              ]}
              onPress={() => setActiveCategory(item)}
            >
              <Text
                style={[
                  styles.categoryText,
                  activeCategory === item && styles.categoryTextActive,
                ]}
              >
                {CATEGORY_LABELS[item] ?? item}
              </Text>
            </TouchableOpacity>
          )}
      />

      {/* Market Stats Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Gainers</Text>
          <Text style={[styles.statValue, { color: COLORS.success }]}>
            {filtered.filter((c) => Number(c.changePct ?? 0) > 0).length}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Losers</Text>
          <Text style={[styles.statValue, { color: COLORS.error }]}>
            {filtered.filter((c) => Number(c.changePct ?? 0) < 0).length}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Total</Text>
          <Text style={[styles.statValue, { color: COLORS.textMuted }]}>
            {filtered.length}
          </Text>
        </View>
      </View>

      {/* Column Headers */}
      <View style={styles.columnHeaders}>
        <Text style={styles.columnHeader}>Commodity</Text>
        <Text style={[styles.columnHeader, { textAlign: 'right' }]}>Price / Change</Text>
      </View>

      {/* Commodity List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <CommodityRow item={item} />}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pricesQuery.isFetching}
            onRefresh={() => pricesQuery.refetch()}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {pricesQuery.isLoading ? 'Loading...' : 'No prices found'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
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

  categoryList: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  categoryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  categoryBtnActive: {
    backgroundColor: `${COLORS.primary}20`,
    borderColor: COLORS.primary,
  },
  categoryText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '500',
  },
  categoryTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  statsBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 2,
  },
  statValue: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },

  columnHeaders: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  columnHeader: {
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowLeft: { flex: 1 },
  symbol: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  name: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  volume: {
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  rowRight: { alignItems: 'flex-end' },
  price: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },
  changeBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  change: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
  },

  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.base },
});
