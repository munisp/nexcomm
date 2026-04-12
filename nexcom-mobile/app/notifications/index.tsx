import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';

import { trpc } from '../../lib/trpc';

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  TRADE: { icon: '📈', color: '#2563eb' },
  LOAN: { icon: '🏦', color: '#d97706' },
  PRICE_ALERT: { icon: '🔔', color: '#7c3aed' },
  SYSTEM: { icon: 'ℹ️', color: '#6b7280' },
  WAREHOUSE: { icon: '🏭', color: '#16a34a' },
};

export default function NotificationsScreen() {
  const utils = trpc.useUtils();
  const notificationsQuery = trpc.notifications.list.useQuery({ limit: 50 });
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });

  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

  const formatTime = (ts: number | string | null | undefined) => {
    if (!ts) return '';
    const date = new Date(typeof ts === 'number' ? ts : ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const renderItem = ({ item }: { item: any }) => {
    const config = TYPE_CONFIG[item.type as string] ?? TYPE_CONFIG.SYSTEM;
    return (
      <TouchableOpacity
        style={[styles.notifCard, !item.isRead && styles.unreadCard]}
        onPress={() => !item.isRead && markReadMutation.mutate({ id: item.id })}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: config.color + '20' }]}>
          <Text style={styles.icon}>{config.icon}</Text>
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <Text style={[styles.notifTitle, !item.isRead && styles.unreadTitle]}>
              {item.title}
            </Text>
            <Text style={styles.notifTime}>{formatTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.notifMessage} numberOfLines={2}>
            {item.message}
          </Text>
          {!item.isRead && <View style={styles.unreadDot} />}
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
          <TouchableOpacity
            onPress={() => markAllReadMutation.mutate()}
            style={styles.markAllBtn}
            disabled={markAllReadMutation.isPending}
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item: any) => String(item.id)}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={notificationsQuery.isFetching}
            onRefresh={() => notificationsQuery.refetch()}
            colors={['#16a34a']}
            tintColor="#16a34a"
          />
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          notificationsQuery.isLoading ? (
            <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>No notifications yet</Text>
              <Text style={styles.emptySubtext}>
                You'll be notified about trades, price alerts, and loan updates here.
              </Text>
            </View>
          )
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
