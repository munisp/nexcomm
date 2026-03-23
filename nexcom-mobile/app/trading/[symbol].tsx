import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { useOrderBook } from '../../lib/useOrderBook';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COMMODITY_DATA: Record<string, any> = {
  MAIZE: {
    name: 'White Maize',
    price: 285000,
    change: 2.4,
    open: 278500,
    high: 287000,
    low: 276000,
    volume: 1250,
    bid: 284500,
    ask: 285500,
    lastTrade: '10:24:32',
    exchange: 'NEXCOM SPOT',
    unit: 'MT',
    description: 'Grade A White Maize, moisture content ≤14%, foreign matter ≤2%',
  },
  SOYBEAN: {
    name: 'Soybean',
    price: 520000,
    change: -1.2,
    open: 526000,
    high: 528000,
    low: 518000,
    volume: 980,
    bid: 519500,
    ask: 520500,
    lastTrade: '10:18:45',
    exchange: 'NEXCOM SPOT',
    unit: 'MT',
    description: 'Grade A Soybean, protein content ≥40%, moisture ≤13%',
  },
  COCOA: {
    name: 'Cocoa Beans',
    price: 4850000,
    change: 3.8,
    open: 4670000,
    high: 4870000,
    low: 4650000,
    volume: 125,
    bid: 4845000,
    ask: 4855000,
    lastTrade: '10:22:11',
    exchange: 'NEXCOM SPOT',
    unit: 'MT',
    description: 'Premium Grade 1 Cocoa Beans, fermentation ≥70%, moisture ≤7.5%',
  },
};

const RECENT_TRADES_DATA = [
  { price: 285000, qty: 25, time: '10:24:32', side: 'BUY' },
  { price: 284500, qty: 50, time: '10:22:18', side: 'SELL' },
  { price: 285000, qty: 10, time: '10:20:45', side: 'BUY' },
  { price: 285500, qty: 30, time: '10:18:22', side: 'BUY' },
  { price: 284000, qty: 75, time: '10:15:11', side: 'SELL' },
];

const TIMEFRAMES = ['1H', '4H', '1D', '1W', '1M'];

export default function TradingDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const [activeTab, setActiveTab] = useState<'chart' | 'orderbook' | 'trades'>('chart');
  const [timeframe, setTimeframe] = useState('1D');

  const staticData = COMMODITY_DATA[symbol || 'MAIZE'] || COMMODITY_DATA['MAIZE'];

  // Live order book via WebSocket — falls back to demo data if server unreachable
  const ob = useOrderBook(symbol || 'MAIZE');

  // Merge live price into display data (prefer live when connected)
  const isLive = ob.status === 'connected';
  const data = {
    ...staticData,
    price: isLive ? ob.price : staticData.price,
    bid: isLive ? ob.bid : staticData.bid,
    ask: isLive ? ob.ask : staticData.ask,
    change: isLive ? ob.changePct : staticData.change,
    volume: isLive ? ob.volume : staticData.volume,
  };
  const isPositive = data.change >= 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: `${symbol} / NGN`,
          headerRight: () => (
            <TouchableOpacity style={styles.watchlistBtn}>
              <Text style={styles.watchlistIcon}>⭐</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Price Header */}
          <View style={styles.priceHeader}>
            <View>
              <Text style={styles.commodityName}>{data.name}</Text>
              <Text style={styles.exchange}>{data.exchange}</Text>
            </View>
            <View style={styles.priceRight}>
              <Text style={styles.currentPrice}>
                ₦{(data.price / 1000).toFixed(0)}K
              </Text>
              <View
                style={[
                  styles.changeBadge,
                  { backgroundColor: isPositive ? `${COLORS.success}20` : `${COLORS.error}20` },
                ]}
              >
                <Text
                  style={[
                    styles.changeText,
                    { color: isPositive ? COLORS.success : COLORS.error },
                  ]}
                >
                  {isPositive ? '▲' : '▼'} {Math.abs(data.change).toFixed(1)}%
                </Text>
              </View>
            </View>
          </View>

          {/* OHLCV Stats */}
          <View style={styles.statsGrid}>
            {[
              { label: 'Open', value: `₦${(data.open / 1000).toFixed(0)}K` },
              { label: 'High', value: `₦${(data.high / 1000).toFixed(0)}K` },
              { label: 'Low', value: `₦${(data.low / 1000).toFixed(0)}K` },
              { label: 'Volume', value: `${data.volume} MT` },
              { label: 'Bid', value: `₦${(data.bid / 1000).toFixed(0)}K` },
              { label: 'Ask', value: `₦${(data.ask / 1000).toFixed(0)}K` },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCell}>
                <Text style={styles.statLabel}>{stat.label}</Text>
                <Text style={styles.statValue}>{stat.value}</Text>
              </View>
            ))}
          </View>

          {/* Tab Selector */}
          <View style={styles.tabSelector}>
            {(['chart', 'orderbook', 'trades'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[styles.tabText, activeTab === tab && styles.tabTextActive]}
                >
                  {tab === 'chart' ? 'Chart' : tab === 'orderbook' ? 'Order Book' : 'Trades'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Chart View */}
          {activeTab === 'chart' && (
            <View style={styles.chartSection}>
              <View style={styles.timeframeRow}>
                {TIMEFRAMES.map((tf) => (
                  <TouchableOpacity
                    key={tf}
                    style={[styles.tfBtn, timeframe === tf && styles.tfBtnActive]}
                    onPress={() => setTimeframe(tf)}
                  >
                    <Text style={[styles.tfText, timeframe === tf && styles.tfTextActive]}>
                      {tf}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.chartPlaceholder}>
                <Text style={styles.chartPlaceholderText}>📈</Text>
                <Text style={styles.chartPlaceholderLabel}>
                  Price Chart — {symbol} {timeframe}
                </Text>
                <Text style={styles.chartPlaceholderSub}>
                  Live chart renders via WebSocket in production
                </Text>
              </View>
              <View style={styles.descriptionCard}>
                <Text style={styles.descriptionTitle}>Contract Specifications</Text>
                <Text style={styles.descriptionText}>{data.description}</Text>
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Unit</Text>
                  <Text style={styles.specValue}>1 Metric Ton (MT)</Text>
                </View>
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Min Lot</Text>
                  <Text style={styles.specValue}>10 MT</Text>
                </View>
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Settlement</Text>
                  <Text style={styles.specValue}>T+2 Physical Delivery</Text>
                </View>
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Currency</Text>
                  <Text style={styles.specValue}>Nigerian Naira (NGN)</Text>
                </View>
              </View>
            </View>
          )}

          {/* Order Book — live via WebSocket */}
          {activeTab === 'orderbook' && (
            <View style={styles.orderBookSection}>
              {/* Connection status badge */}
              <View style={styles.obStatusRow}>
                <View
                  style={[
                    styles.obStatusDot,
                    {
                      backgroundColor:
                        ob.status === 'connected'
                          ? COLORS.success
                          : ob.status === 'connecting'
                          ? COLORS.warning
                          : COLORS.error,
                    },
                  ]}
                />
                <Text style={styles.obStatusText}>
                  {ob.status === 'connected'
                    ? `Live · ${ob.source}`
                    : ob.status === 'connecting'
                    ? 'Connecting…'
                    : 'Demo data'}
                </Text>
              </View>

              <View style={styles.obHeader}>
                <Text style={styles.obHeaderText}>Price (₦/MT)</Text>
                <Text style={styles.obHeaderText}>Qty (MT)</Text>
                <Text style={[styles.obHeaderText, { textAlign: 'right' }]}>Total (₦)</Text>
              </View>

              {/* Asks (sell side) — reversed so lowest ask is nearest spread */}
              {ob.asks.slice().reverse().map((ask, i) => (
                <View key={`ask-${i}`} style={styles.obRow}>
                  <View
                    style={[
                      styles.obBar,
                      {
                        width: `${ask.depth}%`,
                        backgroundColor: `${COLORS.error}15`,
                        right: 0,
                      },
                    ]}
                  />
                  <Text style={[styles.obPrice, { color: COLORS.error }]}>
                    {(ask.price / 1000).toFixed(1)}K
                  </Text>
                  <Text style={styles.obQty}>{ask.qty}</Text>
                  <Text style={[styles.obTotal, { textAlign: 'right' }]}>
                    {(ask.total / 1_000_000).toFixed(1)}M
                  </Text>
                </View>
              ))}

              {/* Spread row */}
              <View style={styles.obSpread}>
                <Text style={styles.obSpreadText}>
                  Spread: ₦{(ob.spread / 1000).toFixed(1)}K
                </Text>
                <Text style={styles.obSpreadText}>
                  ({ob.spreadPct.toFixed(3)}%)
                </Text>
              </View>

              {/* Bids (buy side) */}
              {ob.bids.map((bid, i) => (
                <View key={`bid-${i}`} style={styles.obRow}>
                  <View
                    style={[
                      styles.obBar,
                      {
                        width: `${bid.depth}%`,
                        backgroundColor: `${COLORS.success}15`,
                        left: 0,
                      },
                    ]}
                  />
                  <Text style={[styles.obPrice, { color: COLORS.success }]}>
                    {(bid.price / 1000).toFixed(1)}K
                  </Text>
                  <Text style={styles.obQty}>{bid.qty}</Text>
                  <Text style={[styles.obTotal, { textAlign: 'right' }]}>
                    {(bid.total / 1_000_000).toFixed(1)}M
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Recent Trades */}
          {activeTab === 'trades' && (
            <View style={styles.tradesSection}>
              <View style={styles.obHeader}>
                <Text style={styles.obHeaderText}>Price (₦/MT)</Text>
                <Text style={styles.obHeaderText}>Qty (MT)</Text>
                <Text style={[styles.obHeaderText, { textAlign: 'right' }]}>Time</Text>
              </View>
              {RECENT_TRADES_DATA.map((trade, i) => (
                <View key={i} style={styles.obRow}>
                  <Text
                    style={[
                      styles.obPrice,
                      { color: trade.side === 'BUY' ? COLORS.success : COLORS.error },
                    ]}
                  >
                    {(trade.price / 1000).toFixed(1)}K
                  </Text>
                  <Text style={styles.obQty}>{trade.qty}</Text>
                  <Text style={[styles.obTotal, { textAlign: 'right' }]}>
                    {trade.time}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky Buy/Sell Buttons */}
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.buyBtn]}
            onPress={() => router.push('/tabs/trade')}
          >
            <Text style={styles.actionBtnText}>BUY</Text>
            <Text style={styles.actionBtnPrice}>₦{(data.ask / 1000).toFixed(0)}K</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.sellBtn]}
            onPress={() => router.push('/tabs/trade')}
          >
            <Text style={styles.actionBtnText}>SELL</Text>
            <Text style={styles.actionBtnPrice}>₦{(data.bid / 1000).toFixed(0)}K</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  watchlistBtn: { marginRight: 16, padding: 4 },
  watchlistIcon: { fontSize: 20 },
  priceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
  },
  commodityName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '700',
  },
  exchange: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  priceRight: { alignItems: 'flex-end' },
  currentPrice: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes['2xl'],
    fontWeight: '700',
    marginBottom: 4,
  },
  changeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeText: {
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  statCell: {
    width: '33.33%',
    padding: 12,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 4,
  },
  statValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
  },
  tabSelector: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: `${COLORS.primary}20` },
  tabText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '500' },
  tabTextActive: { color: COLORS.primary, fontWeight: '700' },
  chartSection: { paddingHorizontal: 16 },
  timeframeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tfBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tfBtnActive: {
    backgroundColor: `${COLORS.primary}20`,
    borderColor: COLORS.primary,
  },
  tfText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  tfTextActive: { color: COLORS.primary, fontWeight: '700' },
  chartPlaceholder: {
    height: 200,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  chartPlaceholderText: { fontSize: 48, marginBottom: 8 },
  chartPlaceholderLabel: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },
  chartPlaceholderSub: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 4,
  },
  descriptionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  descriptionTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 8,
  },
  descriptionText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    lineHeight: 20,
    marginBottom: 12,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  specLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  specValue: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '600' },
  orderBookSection: { paddingHorizontal: 16 },
  tradesSection: { paddingHorizontal: 16 },
  // Connection status
  obStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  obStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  obStatusText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  obHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 4,
  },
  obHeaderText: {
    flex: 1,
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  obRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    position: 'relative',
  },
  obBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    opacity: 0.5,
  },
  obPrice: { flex: 1, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '600' },
  obQty: { flex: 1, color: COLORS.text, fontSize: TYPOGRAPHY.sizes.sm },
  obTotal: { flex: 1, color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  obSpread: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: `${COLORS.primary}10`,
    borderRadius: 6,
    marginVertical: 4,
  },
  obSpreadText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
  },
  actionBar: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buyBtn: { backgroundColor: COLORS.success },
  sellBtn: { backgroundColor: COLORS.error },
  actionBtnText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    letterSpacing: 1,
  },
  actionBtnPrice: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
});
