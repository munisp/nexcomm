import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import {
  registerForPushNotifications,
  sendLocalPriceAlert,
  cancelNotification,
  type PriceAlert,
  type AlertCondition,
} from '../../lib/notifications';

// Demo commodity data
const COMMODITIES = [
  { symbol: 'MAIZE', name: 'White Maize', price: 285000, unit: 'MT' },
  { symbol: 'SOYBEAN', name: 'Soybean', price: 520000, unit: 'MT' },
  { symbol: 'SORGHUM', name: 'Sorghum', price: 195000, unit: 'MT' },
  { symbol: 'COCOA', name: 'Cocoa Beans', price: 4850000, unit: 'MT' },
  { symbol: 'SESAME', name: 'Sesame Seeds', price: 1250000, unit: 'MT' },
  { symbol: 'CASHEW', name: 'Cashew Nuts', price: 3200000, unit: 'MT' },
  { symbol: 'COTTON', name: 'Cotton Lint', price: 1850000, unit: 'MT' },
  { symbol: 'GROUNDNUT', name: 'Groundnut', price: 680000, unit: 'MT' },
];

const CONDITION_LABELS: Record<AlertCondition, string> = {
  ABOVE: 'Price goes above',
  BELOW: 'Price goes below',
  PERCENT_CHANGE: 'Price changes by %',
  VOLUME_SPIKE: 'Volume spike',
};

const CONDITION_ICONS: Record<AlertCondition, string> = {
  ABOVE: '▲',
  BELOW: '▼',
  PERCENT_CHANGE: '%',
  VOLUME_SPIKE: '📊',
};

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([
    {
      id: 'alert-1',
      symbol: 'MAIZE',
      commodityName: 'White Maize',
      condition: 'ABOVE',
      targetPrice: 300000,
      currentPrice: 285000,
      isActive: true,
      createdAt: Date.now() - 86400000,
    },
    {
      id: 'alert-2',
      symbol: 'COCOA',
      commodityName: 'Cocoa Beans',
      condition: 'BELOW',
      targetPrice: 4500000,
      currentPrice: 4850000,
      isActive: true,
      createdAt: Date.now() - 3600000,
    },
  ]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);

  // New alert form state
  const [selectedSymbol, setSelectedSymbol] = useState('MAIZE');
  const [selectedCondition, setSelectedCondition] = useState<AlertCondition>('ABOVE');
  const [targetPriceInput, setTargetPriceInput] = useState('');

  useEffect(() => {
    checkPushPermissions();
  }, []);

  const checkPushPermissions = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      setPushToken(token);
      setPushEnabled(true);
    }
  };

  const handleEnablePush = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      setPushToken(token);
      setPushEnabled(true);
      Alert.alert('Push Notifications Enabled', 'You will receive price alerts for your watchlist.');
    } else {
      Alert.alert(
        'Permission Required',
        'Please enable notifications in your device settings to receive price alerts.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleToggleAlert = useCallback((alertId: string, enabled: boolean) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, isActive: enabled } : a))
    );
  }, []);

  const handleDeleteAlert = useCallback(
    (alert: PriceAlert) => {
      Alert.alert(
        'Delete Alert',
        `Remove price alert for ${alert.symbol} (${CONDITION_LABELS[alert.condition]} ₦${alert.targetPrice?.toLocaleString()})?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (alert.notificationId) {
                await cancelNotification(alert.notificationId);
              }
              setAlerts((prev) => prev.filter((a) => a.id !== alertId));
            },
          },
        ]
      );
    },
    []
  );

  const handleTestAlert = async (alert: PriceAlert) => {
    if (!alert.targetPrice) return;
    const notifId = await sendLocalPriceAlert(
      alert.symbol,
      alert.commodityName,
      alert.currentPrice,
      alert.targetPrice,
      alert.condition
    );
    Alert.alert('Test Sent', `Test notification sent (ID: ${notifId.slice(0, 8)}...)`);
  };

  const handleAddAlert = () => {
    const targetPrice = parseFloat(targetPriceInput.replace(/,/g, ''));
    if (isNaN(targetPrice) || targetPrice <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid target price.');
      return;
    }

    const commodity = COMMODITIES.find((c) => c.symbol === selectedSymbol)!;
    const newAlert: PriceAlert = {
      id: `alert-${Date.now()}`,
      symbol: selectedSymbol,
      commodityName: commodity.name,
      condition: selectedCondition,
      targetPrice,
      currentPrice: commodity.price,
      isActive: true,
      createdAt: Date.now(),
    };

    setAlerts((prev) => [newAlert, ...prev]);
    setShowAddModal(false);
    setTargetPriceInput('');
    Alert.alert('Alert Created', `You will be notified when ${commodity.name} price ${CONDITION_LABELS[selectedCondition].toLowerCase()} ₦${targetPrice.toLocaleString()}.`);
  };

  const selectedCommodity = COMMODITIES.find((c) => c.symbol === selectedSymbol);

  return (
    <>
      <Stack.Screen options={{ title: 'Price Alerts' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Push Notification Status */}
          <View style={styles.pushBanner}>
            <View style={styles.pushLeft}>
              <Text style={styles.pushIcon}>{pushEnabled ? '🔔' : '🔕'}</Text>
              <View>
                <Text style={styles.pushTitle}>
                  {pushEnabled ? 'Notifications Active' : 'Enable Notifications'}
                </Text>
                <Text style={styles.pushSub}>
                  {pushEnabled
                    ? `Token: ${pushToken?.slice(0, 20)}...`
                    : 'Tap to enable push notifications'}
                </Text>
              </View>
            </View>
            {!pushEnabled && (
              <TouchableOpacity style={styles.enableBtn} onPress={handleEnablePush}>
                <Text style={styles.enableBtnText}>Enable</Text>
              </TouchableOpacity>
            )}
            {pushEnabled && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>✓ Active</Text>
              </View>
            )}
          </View>

          {/* Alert Types Info */}
          <View style={styles.infoRow}>
            {(['ABOVE', 'BELOW', 'PERCENT_CHANGE'] as AlertCondition[]).map((cond) => (
              <View key={cond} style={styles.infoChip}>
                <Text style={styles.infoChipIcon}>{CONDITION_ICONS[cond]}</Text>
                <Text style={styles.infoChipText}>
                  {cond === 'ABOVE' ? 'Price Up' : cond === 'BELOW' ? 'Price Down' : '% Change'}
                </Text>
              </View>
            ))}
          </View>

          {/* Active Alerts */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Active Alerts ({alerts.length})</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setShowAddModal(true)}
              >
                <Text style={styles.addBtnText}>+ New Alert</Text>
              </TouchableOpacity>
            </View>

            {alerts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔔</Text>
                <Text style={styles.emptyTitle}>No alerts set</Text>
                <Text style={styles.emptySub}>
                  Create price alerts to get notified when commodities hit your target prices.
                </Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => setShowAddModal(true)}
                >
                  <Text style={styles.emptyBtnText}>Create First Alert</Text>
                </TouchableOpacity>
              </View>
            ) : (
              alerts.map((alert) => (
                <View key={alert.id} style={styles.alertCard}>
                  <View style={styles.alertTop}>
                    <View style={styles.alertLeft}>
                      <Text style={styles.alertSymbol}>{alert.symbol}</Text>
                      <Text style={styles.alertName}>{alert.commodityName}</Text>
                    </View>
                    <Switch
                      value={alert.isActive}
                      onValueChange={(v) => handleToggleAlert(alert.id, v)}
                      trackColor={{ false: COLORS.border, true: `${COLORS.primary}60` }}
                      thumbColor={alert.isActive ? COLORS.primary : COLORS.textMuted}
                    />
                  </View>

                  <View style={styles.alertCondition}>
                    <Text style={styles.alertConditionIcon}>
                      {CONDITION_ICONS[alert.condition]}
                    </Text>
                    <Text style={styles.alertConditionText}>
                      {CONDITION_LABELS[alert.condition]}
                    </Text>
                    <Text style={styles.alertTargetPrice}>
                      ₦{alert.targetPrice?.toLocaleString()}
                    </Text>
                  </View>

                  <View style={styles.alertFooter}>
                    <Text style={styles.alertCurrentPrice}>
                      Current: ₦{alert.currentPrice.toLocaleString()}
                    </Text>
                    <View style={styles.alertActions}>
                      <TouchableOpacity
                        style={styles.alertActionBtn}
                        onPress={() => handleTestAlert(alert)}
                      >
                        <Text style={styles.alertActionText}>Test</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.alertActionBtn, styles.alertDeleteBtn]}
                        onPress={() => handleDeleteAlert(alert)}
                      >
                        <Text style={[styles.alertActionText, { color: COLORS.error }]}>
                          Delete
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>

        {/* Add Alert Modal */}
        <Modal
          visible={showAddModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowAddModal(false)}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Price Alert</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {/* Commodity Selector */}
              <Text style={styles.fieldLabel}>Commodity</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {COMMODITIES.map((c) => (
                  <TouchableOpacity
                    key={c.symbol}
                    style={[
                      styles.chip,
                      selectedSymbol === c.symbol && styles.chipActive,
                    ]}
                    onPress={() => setSelectedSymbol(c.symbol)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selectedSymbol === c.symbol && styles.chipTextActive,
                      ]}
                    >
                      {c.symbol}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {selectedCommodity && (
                <Text style={styles.currentPriceHint}>
                  Current price: ₦{selectedCommodity.price.toLocaleString()} / MT
                </Text>
              )}

              {/* Condition Selector */}
              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Alert Condition</Text>
              {(['ABOVE', 'BELOW', 'PERCENT_CHANGE'] as AlertCondition[]).map((cond) => (
                <TouchableOpacity
                  key={cond}
                  style={[
                    styles.conditionOption,
                    selectedCondition === cond && styles.conditionOptionActive,
                  ]}
                  onPress={() => setSelectedCondition(cond)}
                >
                  <Text style={styles.conditionIcon}>{CONDITION_ICONS[cond]}</Text>
                  <Text
                    style={[
                      styles.conditionLabel,
                      selectedCondition === cond && { color: COLORS.primary },
                    ]}
                  >
                    {CONDITION_LABELS[cond]}
                  </Text>
                  {selectedCondition === cond && (
                    <Text style={styles.conditionCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}

              {/* Target Price Input */}
              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
                {selectedCondition === 'PERCENT_CHANGE' ? 'Percent Change (%)' : 'Target Price (₦)'}
              </Text>
              <TextInput
                style={styles.priceInput}
                value={targetPriceInput}
                onChangeText={setTargetPriceInput}
                placeholder={
                  selectedCondition === 'PERCENT_CHANGE'
                    ? 'e.g. 5 (for 5%)'
                    : `e.g. ${selectedCommodity ? Math.round(selectedCommodity.price * 1.1).toLocaleString() : '300000'}`
                }
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />

              <TouchableOpacity style={styles.createBtn} onPress={handleAddAlert}>
                <Text style={styles.createBtnText}>Create Alert</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  pushBanner: {
    margin: 16,
    padding: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pushLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  pushIcon: { fontSize: 28 },
  pushTitle: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700' },
  pushSub: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs, marginTop: 2 },
  enableBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  enableBtnText: { color: '#000', fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '700' },
  activeBadge: {
    backgroundColor: `${COLORS.success}20`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  activeBadgeText: { color: COLORS.success, fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '700' },

  infoRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  infoChip: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  infoChipIcon: { fontSize: 18 },
  infoChipText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '600' },

  section: { paddingHorizontal: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700' },
  addBtn: {
    backgroundColor: `${COLORS.primary}15`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
  },
  addBtnText: { color: COLORS.primary, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '700' },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '700' },
  emptySub: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    textAlign: 'center',
    maxWidth: 260,
  },
  emptyBtn: {
    marginTop: 12,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyBtnText: { color: '#000', fontWeight: '700', fontSize: TYPOGRAPHY.sizes.base },

  alertCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  alertLeft: {},
  alertSymbol: { color: COLORS.primary, fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700' },
  alertName: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs, marginTop: 2 },
  alertCondition: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  alertConditionIcon: { fontSize: 16 },
  alertConditionText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm, flex: 1 },
  alertTargetPrice: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700' },
  alertFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alertCurrentPrice: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs },
  alertActions: { flexDirection: 'row', gap: 8 },
  alertActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: `${COLORS.primary}15`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  alertDeleteBtn: {
    backgroundColor: `${COLORS.error}15`,
    borderColor: `${COLORS.error}30`,
  },
  alertActionText: { color: COLORS.primary, fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '700' },

  // Modal
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.xl, fontWeight: '700' },
  modalClose: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xl, padding: 4 },
  modalBody: { padding: 16 },
  fieldLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  chipRow: { marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  chipActive: { backgroundColor: `${COLORS.primary}20`, borderColor: COLORS.primary },
  chipText: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '600' },
  chipTextActive: { color: COLORS.primary },
  currentPriceHint: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 6,
    marginBottom: 4,
  },
  conditionOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
    gap: 12,
  },
  conditionOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
  },
  conditionIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  conditionLabel: { flex: 1, color: COLORS.text, fontSize: TYPOGRAPHY.sizes.base, fontWeight: '600' },
  conditionCheck: { color: COLORS.primary, fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700' },
  priceInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    marginBottom: 8,
  },
  createBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 30,
  },
  createBtnText: { color: '#000', fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700' },
});
