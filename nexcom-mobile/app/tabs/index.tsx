import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { useLoanNotifications, getLoanEventLabel } from '../../lib/useLoanNotifications';
import { useAuthStore } from '../../lib/store';
import { trpc } from '../../lib/trpc';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  // Real API calls
  const portfolioQuery = trpc.portfolio.summary.useQuery(undefined, { enabled: !!user });
  const recentOrdersQuery = trpc.orders.list.useQuery({ limit: 5 }, { enabled: !!user });
  const marketPricesQuery = trpc.livePrices.getAll.useQuery();
  const notificationsQuery = trpc.notifications.list.useQuery(
    { page: 1, limit: 5 },
    { enabled: !!user }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      portfolioQuery.refetch(),
      recentOrdersQuery.refetch(),
      marketPricesQuery.refetch(),
      notificationsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [portfolioQuery, recentOrdersQuery, marketPricesQuery, notificationsQuery]);

  // Derive display data
  const portfolio = portfolioQuery.data;
  const totalValue = portfolio?.totalValue ?? 0;
  const totalPnl = portfolio?.unrealizedPnl ?? 0;
  const pnlPercent = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;
  const marketSummary = (marketPricesQuery.data ?? []).slice(0, 6);
  const recentTrades = recentOrdersQuery.data ?? [];
  const notifItems = notificationsQuery.data?.notifications ?? [];
  const notifUnread = notificationsQuery.data?.unreadCount ?? 0;

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
          {portfolioQuery.isLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
          ) : (
            <>
              <Text style={styles.portfolioValue}>{formatCurrency(totalValue)}</Text>
              <View style={styles.pnlRow}>
                <Text style={[styles.pnlText, { color: totalPnl >= 0 ? COLORS.success : COLORS.error }]}>
                  {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
                </Text>
                <View style={[styles.pnlBadge, { backgroundColor: totalPnl >= 0 ? `${COLORS.success}20` : `${COLORS.error}20` }]}>
                  <Text style={[styles.pnlPercent, { color: totalPnl >= 0 ? COLORS.success : COLORS.error }]}>
                    {totalPnl >= 0 ? '▲' : '▼'} {Math.abs(pnlPercent).toFixed(2)}%
                  </Text>
                </View>
              </View>
            </>
          )}
          {/* Quick Action Buttons */}
          <View style={styles.quickActions}>
            {[
              { label: 'Trade', icon: '📈', route: '/tabs/trade' },
              { label: 'Warehouse', icon: '🏭', route: '/tabs/warehouse' },
              { label: 'Banking', icon: '🏦', route: '/banking' },
              { label: 'Alerts', icon: '🔔', route: '/alerts' },
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
            <TouchableOpacity onPress={() => router.push('/tabs/markets' as any)}>
              <Text style={styles.sectionLink}>View All →</Text>
            </TouchableOpacity>
          </View>
          {marketPricesQuery.isLoading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketScroll}>
              {marketSummary.map((item) => {
                const change = Number(item.changePct ?? 0);
                const isPositive = change >= 0;
                return (
                  <TouchableOpacity
                    key={item.symbol}
                    style={styles.marketCard}
                    onPress={() => router.push(`/trading/${item.symbol}` as any)}
                  >
                    <Text style={styles.marketSymbol}>{item.symbol}</Text>
                    <Text style={styles.marketName}>{item.name ?? item.symbol}</Text>
                    <Text style={styles.marketPrice}>₦{Number(item.lastPrice ?? 0).toLocaleString()}</Text>
                    <View style={[styles.marketChangeBadge, { backgroundColor: isPositive ? `${COLORS.success}20` : `${COLORS.error}20` }]}>
                      <Text style={[styles.marketChange, { color: isPositive ? COLORS.success : COLORS.error }]}>
                        {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Recent Trades */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Orders</Text>
            <TouchableOpacity onPress={() => router.push('/portfolio' as any)}>
              <Text style={styles.sectionLink}>View All →</Text>
            </TouchableOpacity>
          </View>
          {recentOrdersQuery.isLoading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : recentTrades.length === 0 ? (
            <Text style={{ color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm, paddingVertical: 8 }}>No orders yet.</Text>
          ) : (
            recentTrades.map((trade) => {
              const isBuy = trade.side === 'BUY';
              return (
                <View key={trade.id} style={styles.tradeRow}>
                  <View style={[styles.tradeSideBadge, { backgroundColor: isBuy ? `${COLORS.buy}20` : `${COLORS.sell}20` }]}>
                    <Text style={[styles.tradeSide, { color: isBuy ? COLORS.buy : COLORS.sell }]}>{trade.side}</Text>
                  </View>
                  <View style={styles.tradeInfo}>
                    <Text style={styles.tradeSymbol}>{trade.symbol}</Text>
                    <Text style={styles.tradeDetails}>
                      {Number(trade.quantity).toLocaleString()} MT @ ₦{Number(trade.price ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.tradeRight}>
                    <Text style={styles.tradeTime}>
                      {new Date(trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={[styles.tradeStatus, {
                      color: trade.status === 'FILLED' ? COLORS.success
                        : trade.status === 'CANCELLED' ? COLORS.error
                        : COLORS.warning
                    }]}>{trade.status}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => { markAllRead(); router.push('/notifications' as any); }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {(notifUnread + unreadCount) > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{notifUnread + unreadCount}</Text>
                  </View>
                )}
                <Text style={styles.sectionLink}>Manage →</Text>
              </View>
            </TouchableOpacity>
          </View>
          {notificationsQuery.isLoading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : notifItems.length === 0 && loanEvents.length === 0 ? (
            <Text style={{ color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm, paddingVertical: 8 }}>No notifications.</Text>
          ) : (
            <>
              {loanEvents.slice(0, 2).map((event, i) => (
                <View key={`loan-${i}`} style={styles.alertRow}>
                  <Text style={styles.alertIcon}>{event.event.startsWith('LOAN') ? '💰' : '🛡️'}</Text>
                  <View style={styles.alertContent}>
                    <Text style={styles.alertMessage}>{getLoanEventLabel(event.event)}</Text>
                    {event.message && <Text style={styles.alertTime} numberOfLines={2}>{event.message}</Text>}
                  </View>
                </View>
              ))}
              {notifItems.slice(0, 3).map((n) => (
                <View key={n.id} style={styles.alertRow}>
                  <Text style={styles.alertIcon}>
                    {n.type === 'TRADE' ? '📈' : n.type === 'PRICE_ALERT' ? '🔔' : n.type === 'WAREHOUSE' ? '🏭' : 'ℹ️'}
                  </Text>
                  <View style={styles.alertContent}>
                    <Text style={styles.alertMessage}>{n.message}</Text>
                    <Text style={styles.alertTime}>{new Date(n.createdAt).toLocaleTimeString()}</Text>
                  </View>
                </View>
              ))}
            </>
          )}
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
