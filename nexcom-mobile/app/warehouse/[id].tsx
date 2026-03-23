import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';

const RECEIPT_DATA: Record<string, any> = {
  'WR-2024-001': {
    id: 'WR-2024-001',
    commodity: 'White Maize',
    quantity: 500,
    unit: 'MT',
    warehouse: 'Kano Central Warehouse',
    location: 'Kano, Nigeria',
    address: 'Plot 45, Bompai Industrial Area, Kano',
    depositDate: '2024-01-15',
    expiryDate: '2024-07-15',
    quality: 'Grade A',
    moisture: '13.2%',
    foreignMatter: '1.8%',
    status: 'ACTIVE',
    value: 142500000,
    pledged: false,
    depositor: 'Adebayo Okonkwo',
    warehouseOperator: 'Kano Agri Storage Ltd',
    inspectionDate: '2024-01-14',
    nextInspection: '2024-04-14',
    blockchainHash: '0x7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    tokenized: true,
    tokenId: 'NEXWR-001234',
    transactions: [
      { date: '2024-01-15', type: 'DEPOSIT', qty: 500, notes: 'Initial deposit' },
      { date: '2024-02-01', type: 'INSPECTION', qty: 500, notes: 'Routine quality check - PASSED' },
    ],
  },
};

export default function WarehouseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const receipt = RECEIPT_DATA[id || 'WR-2024-001'] || RECEIPT_DATA['WR-2024-001'];

  const handlePledge = () => {
    Alert.alert(
      'Pledge as Collateral',
      `Pledge ${receipt.id} (${receipt.quantity} MT ${receipt.commodity}) as collateral for a loan?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Proceed', onPress: () => Alert.alert('Success', 'Pledge request submitted for review.') },
      ]
    );
  };

  const handleTransfer = () => {
    Alert.alert('Transfer Receipt', 'Transfer warehouse receipt to another party?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Transfer', onPress: () => Alert.alert('Success', 'Transfer initiated.') },
    ]);
  };

  const handleSell = () => {
    Alert.alert('Sell Commodity', `List ${receipt.quantity} MT of ${receipt.commodity} for sale?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'List for Sale', onPress: () => Alert.alert('Success', 'Listing created on NEXCOM Exchange.') },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: receipt.id }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Status Banner */}
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor:
                  receipt.status === 'ACTIVE' ? `${COLORS.success}15` : `${COLORS.warning}15`,
                borderColor:
                  receipt.status === 'ACTIVE' ? `${COLORS.success}40` : `${COLORS.warning}40`,
              },
            ]}
          >
            <Text style={styles.statusBannerIcon}>
              {receipt.status === 'ACTIVE' ? '✅' : '⚠️'}
            </Text>
            <View>
              <Text
                style={[
                  styles.statusBannerText,
                  {
                    color:
                      receipt.status === 'ACTIVE' ? COLORS.success : COLORS.warning,
                  },
                ]}
              >
                {receipt.status}
              </Text>
              <Text style={styles.statusBannerSub}>
                Expires: {receipt.expiryDate}
              </Text>
            </View>
            {receipt.tokenized && (
              <View style={styles.tokenBadge}>
                <Text style={styles.tokenBadgeText}>⛓ On-Chain</Text>
              </View>
            )}
          </View>

          {/* Commodity Details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Commodity Details</Text>
            <View style={styles.detailGrid}>
              {[
                { label: 'Commodity', value: receipt.commodity },
                { label: 'Quantity', value: `${receipt.quantity.toLocaleString()} ${receipt.unit}` },
                { label: 'Quality Grade', value: receipt.quality },
                { label: 'Moisture', value: receipt.moisture },
                { label: 'Foreign Matter', value: receipt.foreignMatter },
                { label: 'Est. Value', value: `₦${(receipt.value / 1_000_000).toFixed(1)}M` },
              ].map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Warehouse Info */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Storage Information</Text>
            <View style={styles.detailGrid}>
              {[
                { label: 'Warehouse', value: receipt.warehouse },
                { label: 'Location', value: receipt.location },
                { label: 'Address', value: receipt.address },
                { label: 'Operator', value: receipt.warehouseOperator },
                { label: 'Deposit Date', value: receipt.depositDate },
                { label: 'Last Inspection', value: receipt.inspectionDate },
                { label: 'Next Inspection', value: receipt.nextInspection },
              ].map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Blockchain Info */}
          {receipt.tokenized && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>⛓ Blockchain Record</Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Token ID</Text>
                  <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                    {receipt.tokenId}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>TX Hash</Text>
                  <Text style={[styles.detailValue, { fontSize: TYPOGRAPHY.sizes.xs }]}>
                    {receipt.blockchainHash.slice(0, 20)}...
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Transaction History */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Transaction History</Text>
            {receipt.transactions.map((tx: any, i: number) => (
              <View
                key={i}
                style={[styles.txRow, i < receipt.transactions.length - 1 && styles.txRowBorder]}
              >
                <View style={styles.txLeft}>
                  <Text style={styles.txType}>{tx.type}</Text>
                  <Text style={styles.txNotes}>{tx.notes}</Text>
                </View>
                <View style={styles.txRight}>
                  <Text style={styles.txDate}>{tx.date}</Text>
                  <Text style={styles.txQty}>{tx.qty} MT</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.actionsSection}>
            <Text style={styles.actionsTitle}>Actions</Text>
            <View style={styles.actionsGrid}>
              {!receipt.pledged && (
                <TouchableOpacity style={styles.actionBtn} onPress={handlePledge}>
                  <Text style={styles.actionIcon}>🔒</Text>
                  <Text style={styles.actionLabel}>Pledge as Collateral</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={handleSell}>
                <Text style={styles.actionIcon}>💹</Text>
                <Text style={styles.actionLabel}>Sell on Exchange</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleTransfer}>
                <Text style={styles.actionIcon}>↔️</Text>
                <Text style={styles.actionLabel}>Transfer Receipt</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => Alert.alert('Download', 'Downloading PDF receipt...')}
              >
                <Text style={styles.actionIcon}>📄</Text>
                <Text style={styles.actionLabel}>Download PDF</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  statusBannerIcon: { fontSize: 24 },
  statusBannerText: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  statusBannerSub: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  tokenBadge: {
    marginLeft: 'auto',
    backgroundColor: `${COLORS.primary}20`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
  },
  tokenBadgeText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
  },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 12,
  },
  detailGrid: { gap: 0 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    flex: 1,
  },
  detailValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },

  txRow: { paddingVertical: 10 },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  txLeft: { flex: 1 },
  txRight: { alignItems: 'flex-end' },
  txType: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },
  txNotes: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  txDate: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs },
  txQty: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    marginTop: 2,
  },

  actionsSection: { marginHorizontal: 16, marginBottom: 16 },
  actionsTitle: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionBtn: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  actionIcon: { fontSize: 24 },
  actionLabel: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
    textAlign: 'center',
  },
});
