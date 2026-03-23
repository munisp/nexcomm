import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';

type NotificationType = 'TRADE' | 'LOAN' | 'PRICE_ALERT' | 'SYSTEM' | 'WAREHOUSE';

interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 1, type: 'TRADE', title: 'Order Filled', message: 'Your BUY order for 10MT MAIZE at ₦285,000/MT has been filled.', read: false, createdAt: '2026-03-23T10:30:00Z' },
  { id: 2, type: 'PRICE_ALERT', title: 'Price Alert Triggered', message: 'SOYBEANS has crossed your alert threshold of ₦520,000/MT.', read: false, createdAt: '2026-03-23T09:15:00Z' },
  { id: 3, type: 'LOAN', title: 'Loan Application Update', message: 'Your loan application #LOAN-1042 has been approved by Access Bank.', read: true, createdAt: '2026-03-22T14:00:00Z' },
  { id: 4, type: 'WAREHOUSE', title: 'Warehouse Receipt Issued', message: 'Receipt WR-2025-0891 for 50MT Maize has been issued at Kano Central Warehouse.', read: true, createdAt: '2026-03-21T11:20:00Z' },
  { id: 5, type: 'SYSTEM', title: 'KYC Verification Complete', message: 'Your identity verification has been approved. Full trading access is now enabled.', read: true, createdAt: '2026-03-20T08:45:00Z' },
];

const TYPE_CONFIG: Record<NotificationType, { icon: string; color: string }> = {
  TRADE: { icon: '📈', color: '#2563eb' },
  LOAN: { icon: '🏦', color: '#d97706' },
  PRICE_ALERT: { icon: '🔔', color: '#7c3aed' },
  SYSTEM: { icon: 'ℹ️', color: '#6b7280' },
  WAREHOUSE: { icon: '🏭', color: '#16a34a' },
};

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setRefreshing(false);
  }, []);

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markRead = (id: number) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.SYSTEM;
    return (
      <TouchableOpacity
        style={[styles.notifCard, !item.read && styles.unreadCard]}
        onPress={() => markRead(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: config.color + '20' }]}>
          <Text style={styles.icon}>{config.icon}</Text>
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <Text style={[styles.notifTitle, !item.read && styles.unreadTitle]}>
              {item.title}
            </Text>
            <Text style={styles.notifTime}>{formatTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.notifMessage} numberOfLines={2}>
            {item.message}
          </Text>
          {!item.read && <View style={styles.unreadDot} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 && (
            <Text style={styles.unreadCount}>{unreadCount} unread</Text>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyText}>No notifications yet</Text>
            <Text style={styles.emptySubtext}>
              You'll be notified about trades, price alerts, and loan updates here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  unreadCount: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  markAllBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f3f4f6', borderRadius: 8 },
  markAllText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  listContent: { padding: 12 },
  separator: { height: 8 },
  notifCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  unreadCard: { borderLeftWidth: 3, borderLeftColor: '#16a34a' },
  iconContainer: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  icon: { fontSize: 20 },
  notifContent: { flex: 1 },
  notifHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  notifTitle: { fontSize: 14, fontWeight: '500', color: '#374151', flex: 1, marginRight: 8 },
  unreadTitle: { fontWeight: '700', color: '#111827' },
  notifTime: { fontSize: 12, color: '#9ca3af' },
  notifMessage: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a', position: 'absolute', top: 0, right: 0 },
  emptyState: { alignItems: 'center', paddingVertical: 64 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#374151', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#6b7280', textAlign: 'center', paddingHorizontal: 32 },
});
