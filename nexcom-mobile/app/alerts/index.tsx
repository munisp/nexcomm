import React, { useState, useEffect } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import {
  registerForPushNotifications,
} from '../../lib/notifications';
import { trpc } from '../../lib/trpc';

type AlertCondition = 'ABOVE' | 'BELOW' | 'CROSS_ABOVE' | 'CROSS_BELOW';

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

const CONDITION_LABELS: Record<string, string> = {
  ABOVE: 'Price goes above',
  BELOW: 'Price goes below',
  CROSS_ABOVE: 'Crosses above',
  CROSS_BELOW: 'Crosses below',
};

const CONDITION_ICONS: Record<string, string> = {
  ABOVE: '▲',
  BELOW: '▼',
  CROSS_ABOVE: '⇑',
  CROSS_BELOW: '⇓',
};

export default function AlertsScreen() {
  const utils = trpc.useUtils();
  const [showAddModal, setShowAddModal] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('MAIZE');
  const [selectedCondition, setSelectedCondition] = useState<AlertCondition>('ABOVE');
  const [targetPriceInput, setTargetPriceInput] = useState('');

  const alertsQuery = trpc.priceAlerts.list.useQuery();
  const createAlertMutation = trpc.priceAlerts.create.useMutation({
    onSuccess: () => {
      utils.priceAlerts.list.invalidate();
      setShowAddModal(false);
      setTargetPriceInput('');
    },
    onError: (err) => Alert.alert('Error', err.message),
  });
  const deleteAlertMutation = trpc.priceAlerts.delete.useMutation({
    onSuccess: () => utils.priceAlerts.list.invalidate(),
    onError: (err) => Alert.alert('Error', err.message),
  });
  const updateAlertMutation = trpc.priceAlerts.update.useMutation({
    onSuccess: () => utils.priceAlerts.list.invalidate(),
  });

  const allAlerts = [
    ...(alertsQuery.data?.active ?? []),
    ...(alertsQuery.data?.triggered ?? []),
  ];

  useEffect(() => {
    registerForPushNotifications().then((token) => {
      if (token) { setPushToken(token); setPushEnabled(true); }
    });
  }, []);

  const handleEnablePush = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      setPushToken(token);
      setPushEnabled(true);
      Alert.alert('Push Notifications Enabled', 'You will receive price alerts for your watchlist.');
    } else {
      Alert.alert('Permission Required', 'Please enable notifications in your device settings.', [{ text: 'OK' }]);
    }
  };

  const handleToggleAlert = (alertId: number, enabled: boolean) => {
    updateAlertMutation.mutate({ id: alertId, isActive: enabled });
  };

  const handleDeleteAlert = (alert: any) => {
    Alert.alert(
      'Delete Alert',
      `Remove price alert for ${alert.symbol}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteAlertMutation.mutate({ id: alert.id }) },
      ]
    );
  };

  const handleAddAlert = () => {
    const targetPrice = parseFloat(targetPriceInput.replace(/,/g, ''));
    if (isNaN(targetPrice) || targetPrice <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid target price.');
      return;
    }
    const commodity = COMMODITIES.find((c) => c.symbol === selectedSymbol);
    createAlertMutation.mutate({ symbol: selectedSymbol, condition: selectedCondition, targetPrice });
    Alert.alert('Alert Created', `Alert set for ${commodity?.name ?? selectedSymbol} at ₦${targetPrice.toLocaleString()}.`);
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
              <Text style={styles.sectionTitle}>Active Alerts ({allAlerts.length})</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setShowAddModal(true)}
              >
                <Text style={styles.addBtnText}>+ New Alert</Text>
              </TouchableOpacity>
            </View>

            {alertsQuery.isLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} />
            ) : allAlerts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔔</Text>
                <Text style={styles.emptyTitle}>No alerts set</Text>
                <Text style={styles.emptySub}>
                  Create price alerts to get notified when commodities hit your target prices.
                </Text>
                <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowAddModal(true)}>
                  <Text style={styles.emptyBtnText}>Create First Alert</Text>
                </TouchableOpacity>
              </View>
            ) : (
              allAlerts.map((alert: any) => (
                <View key={alert.id} style={styles.alertCard}>
                  <View style={styles.alertTop}>
                    <View style={styles.alertLeft}>
                      <Text style={styles.alertSymbol}>{alert.symbol}</Text>
                      <Text style={styles.alertName}>{alert.symbol}</Text>
                    </View>
                    <Switch
                      value={!alert.triggered && alert.isActive !== false}
                      onValueChange={(v) => handleToggleAlert(alert.id, v)}
                      trackColor={{ false: COLORS.border, true: `${COLORS.primary}60` }}
                      thumbColor={!alert.triggered ? COLORS.primary : COLORS.textMuted}
                    />
                  </View>
                  <View style={styles.alertCondition}>
                    <Text style={styles.alertConditionIcon}>{CONDITION_ICONS[alert.condition] ?? '▲'}</Text>
                    <Text style={styles.alertConditionText}>{CONDITION_LABELS[alert.condition] ?? alert.condition}</Text>
                    <Text style={styles.alertTargetPrice}>₦{Number(alert.targetPrice).toLocaleString()}</Text>
                  </View>
                  <View style={styles.alertFooter}>
                    <Text style={styles.alertCurrentPrice}>{alert.triggered ? '✓ Triggered' : 'Active'}</Text>
                    <View style={styles.alertActions}>
                      <TouchableOpacity
                        style={[styles.alertActionBtn, styles.alertDeleteBtn]}
                        onPress={() => handleDeleteAlert(alert)}
                      >
                        <Text style={[styles.alertActionText, { color: COLORS.error }]}>Delete</Text>
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
              {(['ABOVE', 'BELOW', 'CROSS_ABOVE', 'CROSS_BELOW'] as AlertCondition[]).map((cond) => (
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
                Target Price (₦)
              </Text>
              <TextInput
                style={styles.priceInput}
                value={targetPriceInput}
                onChangeText={setTargetPriceInput}
                placeholder={`e.g. ${selectedCommodity ? Math.round(selectedCommodity.price * 1.1).toLocaleString() : '300000'}`}
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />

              <TouchableOpacity
                style={[styles.createBtn, createAlertMutation.isPending && { opacity: 0.6 }]}
                onPress={handleAddAlert}
                disabled={createAlertMutation.isPending}
              >
                <Text style={styles.createBtnText}>{createAlertMutation.isPending ? 'Creating...' : 'Create Alert'}</Text>
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
