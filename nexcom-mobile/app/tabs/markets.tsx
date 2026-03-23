import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CATEGORIES = ['All', 'Grains', 'Oilseeds', 'Cash Crops', 'Livestock', 'Indices'];

const COMMODITIES = [
  // Grains
  { symbol: 'MAIZE', name: 'White Maize', category: 'Grains', price: 285000, change: 2.4, volume: 1250, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'SORGHUM', name: 'Sorghum', category: 'Grains', price: 195000, change: -0.5, volume: 890, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'WHEAT', name: 'Wheat', category: 'Grains', price: 420000, change: 1.1, volume: 340, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'MILLET', name: 'Pearl Millet', category: 'Grains', price: 165000, change: 0.8, volume: 520, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'RICE', name: 'Paddy Rice', category: 'Grains', price: 380000, change: -1.8, volume: 670, unit: 'MT', exchange: 'SPOT' },
  // Oilseeds
  { symbol: 'SOYBEAN', name: 'Soybean', category: 'Oilseeds', price: 520000, change: -1.2, volume: 980, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'SESAME', name: 'Sesame Seeds', category: 'Oilseeds', price: 1250000, change: 0.9, volume: 210, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'GROUNDNUT', name: 'Groundnut', category: 'Oilseeds', price: 680000, change: 2.1, volume: 430, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'SUNFLOWER', name: 'Sunflower Seed', category: 'Oilseeds', price: 490000, change: -0.3, volume: 180, unit: 'MT', exchange: 'SPOT' },
  // Cash Crops
  { symbol: 'COCOA', name: 'Cocoa Beans', category: 'Cash Crops', price: 4850000, change: 3.8, volume: 125, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'CASHEW', name: 'Cashew Nuts', category: 'Cash Crops', price: 3200000, change: 1.6, volume: 89, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'COTTON', name: 'Cotton Lint', category: 'Cash Crops', price: 1850000, change: -2.3, volume: 156, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'COFFEE', name: 'Arabica Coffee', category: 'Cash Crops', price: 5200000, change: 4.2, volume: 67, unit: 'MT', exchange: 'SPOT' },
  { symbol: 'GINGER', name: 'Dried Ginger', category: 'Cash Crops', price: 2100000, change: 1.9, volume: 94, unit: 'MT', exchange: 'SPOT' },
  // Livestock
  { symbol: 'CATTLE', name: 'Beef Cattle', category: 'Livestock', price: 850000, change: 0.6, volume: 45, unit: 'HEAD', exchange: 'SPOT' },
  { symbol: 'GOAT', name: 'Goat', category: 'Livestock', price: 95000, change: 1.2, volume: 320, unit: 'HEAD', exchange: 'SPOT' },
  // Indices
  { symbol: 'NAXI', name: 'NEXCOM Agri Index', category: 'Indices', price: 12450, change: 1.8, volume: 0, unit: 'PTS', exchange: 'INDEX' },
  { symbol: 'NGGI', name: 'Nigeria Grain Index', category: 'Indices', price: 8920, change: 0.9, volume: 0, unit: 'PTS', exchange: 'INDEX' },
];

function CommodityRow({ item }: { item: typeof COMMODITIES[0] }) {
  const isPositive = item.change >= 0;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/trading/${item.symbol}` as any)}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.symbol}>{item.symbol}</Text>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.volume}>
          {item.volume > 0 ? `Vol: ${item.volume.toLocaleString()} ${item.unit}` : item.exchange}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.price}>
          ₦{item.price >= 1_000_000
            ? `${(item.price / 1_000_000).toFixed(2)}M`
            : `${(item.price / 1_000).toFixed(0)}K`}
        </Text>
        <View
          style={[
            styles.changeBadge,
            { backgroundColor: isPositive ? `${COLORS.success}20` : `${COLORS.error}20` },
          ]}
        >
          <Text
            style={[
              styles.change,
              { color: isPositive ? COLORS.success : COLORS.error },
            ]}
          >
            {isPositive ? '▲' : '▼'} {Math.abs(item.change).toFixed(1)}%
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MarketsScreen() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const filtered = useMemo(() => {
    return COMMODITIES.filter((c) => {
      const matchesSearch =
        search === '' ||
        c.symbol.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === 'All' || c.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Market Stats Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Gainers</Text>
          <Text style={[styles.statValue, { color: COLORS.success }]}>
            {filtered.filter((c) => c.change > 0).length}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Losers</Text>
          <Text style={[styles.statValue, { color: COLORS.error }]}>
            {filtered.filter((c) => c.change < 0).length}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Unchanged</Text>
          <Text style={[styles.statValue, { color: COLORS.textMuted }]}>
            {filtered.filter((c) => c.change === 0).length}
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
        keyExtractor={(item) => item.symbol}
        renderItem={({ item }) => <CommodityRow item={item} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No commodities found</Text>
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
