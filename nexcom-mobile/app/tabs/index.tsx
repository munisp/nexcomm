import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { useLoanNotifications, getLoanEventLabel } from '../../lib/useLoanNotifications';
import { useAuthStore } from '../../lib/store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Demo data for dashboard
const PORTFOLIO_DATA = {
  totalValue: 45_820_500,
  pnl: 1_234_500,
  pnlPercent: 2.77,
  currency: 'NGN',
};

const MARKET_SUMMARY = [
  { symbol: 'MAIZE', name: 'White Maize', price: 285000, change: 2.4, unit: '/MT' },
  { symbol: 'SOYBEAN', name: 'Soybean', price: 520000, change: -1.2, unit: '/MT' },
  { symbol: 'COCOA', name: 'Cocoa Beans', price: 4850000, change: 3.8, unit: '/MT' },
  { symbol: 'SESAME', name: 'Sesame Seeds', price: 1250000, change: 0.9, unit: '/MT' },
  { symbol: 'SORGHUM', name: 'Sorghum', price: 195000, change: -0.5, unit: '/MT' },
  { symbol: 'CASHEW', name: 'Cashew Nuts', price: 3200000, change: 1.6, unit: '/MT' },
];

const RECENT_TRADES = [
  { id: '1', symbol: 'MAIZE', side: 'BUY', qty: 50, price: 283000, time: '10:24 AM', status: 'FILLED' },
  { id: '2', symbol: 'COCOA', side: 'SELL', qty: 10, price: 4820000, time: '09:15 AM', status: 'FILLED' },
  { id: '3', symbol: 'SOYBEAN', side: 'BUY', qty: 25, price: 522000, time: 'Yesterday', status: 'PARTIAL' },
];

const ALERTS = [
  { id: '1', type: 'PRICE', message: 'MAIZE hit your target price of ₦285,000/MT', time: '5m ago', icon: '🎯' },
  { id: '2', type: 'WAREHOUSE', message: 'WR-2024-001 inspection due in 3 days', time: '1h ago', icon: '🏭' },
  { id: '3', type: 'LOAN', message: 'Loan repayment of ₦2.5M due in 7 days', time: '2h ago', icon: '💰' },
];

function formatCurrency(value: number, currency = 'NGN'): string {
  if (value >= 1_000_000_000) return `₦${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `₦${(value / 1_000).toFixed(0)}K`;
  return `₦${value.toLocaleString()}`;
}

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuthStore();
  const userId = user ? parseInt(user.id) : null;
  const { events: loanEvents, unreadCount, markAllRead } = useLoanNotifications(userId);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Portfolio Card */}
        <View style={styles.portfolioCard}>
          <Text style={styles.portfolioLabel}>Portfolio Value</Text>
          <Text style={styles.portfolioValue}>
            {formatCurrency(PORTFOLIO_DATA.totalValue)}
          </Text>
          <View style={styles.pnlRow}>
            <Text
              style={[
                styles.pnlText,
                { color: PORTFOLIO_DATA.pnl >= 0 ? COLORS.success : COLORS.error },
              ]}
            >
              {PORTFOLIO_DATA.pnl >= 0 ? '+' : ''}
              {formatCurrency(PORTFOLIO_DATA.pnl)}
            </Text>
            <View
              style={[
                styles.pnlBadge,
                {
                  backgroundColor:
                    PORTFOLIO_DATA.pnlPercent >= 0
                      ? `${COLORS.success}20`
                      : `${COLORS.error}20`,
                },
              ]}
            >
              <Text
                style={[
                  styles.pnlPercent,
                  {
                    color:
                      PORTFOLIO_DATA.pnlPercent >= 0
                        ? COLORS.success
                        : COLORS.error,
                  },
                ]}
              >
                {PORTFOLIO_DATA.pnlPercent >= 0 ? '▲' : '▼'}{' '}
                {Math.abs(PORTFOLIO_DATA.pnlPercent).toFixed(2)}%
              </Text>
            </View>
          </View>

          {/* Quick Action Buttons */}
          <View style={styles.quickActions}>
            {[
              { label: 'Deposit', icon: '⬇️', route: '/deposit' },
              { label: 'Withdraw', icon: '⬆️', route: '/withdraw' },
              { label: 'Transfer', icon: '↔️', route: '/transfer' },
              { label: 'History', icon: '📋', route: '/history' },
            ].map((action) => (
              <TouchableOpacity
                key={action.label}
                style={styles.quickActionBtn}
                onPress={() => router.push(action.route as any)}
              >
                <View style={styles.quickActionIcon}>
                  <Text style={styles.quickActionEmoji}>{action.icon}</Text>
                </View>
                <Text style={styles.quickActionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Market Summary */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Market Prices</Text>
            <TouchableOpacity onPress={() => router.push('/tabs/markets')}>
              <Text style={styles.sectionLink}>View All →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.marketScroll}
          >
            {MARKET_SUMMARY.map((item) => (
              <TouchableOpacity
                key={item.symbol}
                style={styles.marketCard}
                onPress={() => router.push(`/trading/${item.symbol}` as any)}
              >
                <Text style={styles.marketSymbol}>{item.symbol}</Text>
                <Text style={styles.marketName}>{item.name}</Text>
                <Text style={styles.marketPrice}>
                  ₦{(item.price / 1000).toFixed(0)}K{item.unit}
                </Text>
                <View
                  style={[
                    styles.marketChangeBadge,
                    {
                      backgroundColor:
                        item.change >= 0
                          ? `${COLORS.success}20`
                          : `${COLORS.error}20`,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.marketChange,
                      { color: item.change >= 0 ? COLORS.success : COLORS.error },
                    ]}
                  >
                    {item.change >= 0 ? '▲' : '▼'} {Math.abs(item.change)}%
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Recent Trades */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Trades</Text>
            <TouchableOpacity>
              <Text style={styles.sectionLink}>View All →</Text>
            </TouchableOpacity>
          </View>
          {RECENT_TRADES.map((trade) => (
            <View key={trade.id} style={styles.tradeRow}>
              <View
                style={[
                  styles.tradeSideBadge,
                  {
                    backgroundColor:
                      trade.side === 'BUY'
                        ? `${COLORS.success}20`
                        : `${COLORS.error}20`,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tradeSide,
                    { color: trade.side === 'BUY' ? COLORS.success : COLORS.error },
                  ]}
                >
                  {trade.side}
                </Text>
              </View>
              <View style={styles.tradeInfo}>
                <Text style={styles.tradeSymbol}>{trade.symbol}</Text>
                <Text style={styles.tradeDetails}>
                  {trade.qty} MT @ ₦{(trade.price / 1000).toFixed(0)}K
                </Text>
              </View>
              <View style={styles.tradeRight}>
                <Text style={styles.tradeTime}>{trade.time}</Text>
                <Text
                  style={[
                    styles.tradeStatus,
                    {
                      color:
                        trade.status === 'FILLED'
                          ? COLORS.success
                          : COLORS.warning,
                    },
                  ]}
                >
                  {trade.status}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Loan Notifications (real-time) */}
        {loanEvents.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.sectionTitle}>Loan Notifications</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={markAllRead}>
                <Text style={styles.sectionLink}>Mark Read</Text>
              </TouchableOpacity>
            </View>
            {loanEvents.slice(0, 5).map((event, i) => (
              <View key={`loan-${i}`} style={styles.alertRow}>
                <Text style={styles.alertIcon}>
                  {event.event.startsWith('LOAN') ? '💰' : '🛡️'}
                </Text>
                <View style={styles.alertContent}>
                  <Text style={styles.alertMessage}>{getLoanEventLabel(event.event)}</Text>
                  {event.message && (
                    <Text style={styles.alertTime} numberOfLines={2}>{event.message}</Text>
                  )}
                  {event.amount && (
                    <Text style={[styles.alertTime, { color: COLORS.primary }]}>
                      ₦{event.amount.toLocaleString()}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Alerts */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Alerts</Text>
            <TouchableOpacity>
              <Text style={styles.sectionLink}>Manage →</Text>
            </TouchableOpacity>
          </View>
          {ALERTS.map((alert) => (
            <View key={alert.id} style={styles.alertRow}>
              <Text style={styles.alertIcon}>{alert.icon}</Text>
              <View style={styles.alertContent}>
                <Text style={styles.alertMessage}>{alert.message}</Text>
                <Text style={styles.alertTime}>{alert.time}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Bottom padding */}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },

  // Portfolio Card
  portfolioCard: {
    margin: 16,
    padding: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  portfolioLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '500',
    marginBottom: 4,
  },
  portfolioValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes['3xl'],
    fontWeight: '700',
    marginBottom: 8,
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  pnlText: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },
  pnlBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pnlPercent: {
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickActionBtn: {
    alignItems: 'center',
    flex: 1,
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickActionEmoji: { fontSize: 20 },
  quickActionLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '500',
  },

  // Sections
  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
  },
  sectionLink: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
  },

  // Market Cards
  marketScroll: { paddingRight: 16, gap: 10 },
  marketCard: {
    width: 140,
    padding: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  marketSymbol: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 2,
  },
  marketName: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 8,
  },
  marketPrice: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    marginBottom: 6,
  },
  marketChangeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  marketChange: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
  },

  // Trade Rows
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  tradeSideBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 50,
    alignItems: 'center',
  },
  tradeSide: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
  },
  tradeInfo: { flex: 1 },
  tradeSymbol: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },
  tradeDetails: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  tradeRight: { alignItems: 'flex-end' },
  tradeTime: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  tradeStatus: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
    marginTop: 2,
  },

  // Alert Rows
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  alertIcon: { fontSize: 20, marginTop: 2 },
  alertContent: { flex: 1 },
  alertMessage: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    lineHeight: 20,
  },
  alertTime: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 4,
  },
  unreadBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
