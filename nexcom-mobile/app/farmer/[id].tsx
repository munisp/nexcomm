import React, { useState } from 'react';
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

const FARMER_DATA: Record<string, any> = {
  '1': {
    id: '1',
    name: 'Ibrahim Musa',
    phone: '+234 803 456 7890',
    email: 'ibrahim.musa@example.com',
    location: 'Kumbotso LGA, Kano State',
    coordinates: { lat: 12.0022, lng: 8.5920 },
    kycStatus: 'VERIFIED',
    kycDate: '2024-01-10',
    accountType: 'INDIVIDUAL',
    farmSize: 5.2,
    farmUnit: 'hectares',
    primaryCrop: 'Maize',
    secondaryCrops: ['Sorghum', 'Cowpea'],
    soilType: 'Sandy Loam',
    irrigationType: 'Rainfed',
    memberSince: '2024-01-10',
    totalLoans: 2,
    activeLoans: 1,
    totalLoanAmount: 1500000,
    repaymentRate: 95,
    warehouseReceipts: 1,
    lastVisit: '2024-03-15',
    nextVisit: '2024-04-15',
    fieldAgent: 'Chukwuemeka Eze',
    cropHistory: [
      { season: '2023 Wet', crop: 'Maize', yield: 3.2, unit: 'MT/ha', area: 4.5 },
      { season: '2023 Dry', crop: 'Sorghum', yield: 2.1, unit: 'MT/ha', area: 2.0 },
      { season: '2022 Wet', crop: 'Maize', yield: 2.8, unit: 'MT/ha', area: 4.0 },
    ],
    loans: [
      { id: 'LN-001', amount: 500000, purpose: 'Fertilizer & Seeds', status: 'REPAID', date: '2023-03-01' },
      { id: 'LN-002', amount: 1000000, purpose: 'Land Preparation', status: 'ACTIVE', date: '2024-02-01' },
    ],
  },
};

export default function FarmerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmer = FARMER_DATA[id || '1'] || FARMER_DATA['1'];
  const [activeTab, setActiveTab] = useState<'overview' | 'crops' | 'loans'>('overview');

  return (
    <>
      <Stack.Screen options={{ title: farmer.name }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Farmer Header */}
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{farmer.name[0]}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.farmerName}>{farmer.name}</Text>
              <Text style={styles.farmerLocation}>📍 {farmer.location}</Text>
              <View style={styles.badges}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        farmer.kycStatus === 'VERIFIED'
                          ? `${COLORS.success}20`
                          : `${COLORS.warning}20`,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color:
                          farmer.kycStatus === 'VERIFIED' ? COLORS.success : COLORS.warning,
                      },
                    ]}
                  >
                    {farmer.kycStatus === 'VERIFIED' ? '✓ KYC Verified' : '⚠ KYC Pending'}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: `${COLORS.primary}20` }]}>
                  <Text style={[styles.badgeText, { color: COLORS.primary }]}>
                    {farmer.primaryCrop}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Quick Stats */}
          <View style={styles.statsRow}>
            {[
              { label: 'Farm Size', value: `${farmer.farmSize} ha` },
              { label: 'Repayment', value: `${farmer.repaymentRate}%` },
              { label: 'WRs', value: farmer.warehouseReceipts.toString() },
              { label: 'Loans', value: farmer.totalLoans.toString() },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* Tab Selector */}
          <View style={styles.tabSelector}>
            {(['overview', 'crops', 'loans'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <View style={styles.section}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Contact Information</Text>
                {[
                  { icon: '📞', label: 'Phone', value: farmer.phone },
                  { icon: '📧', label: 'Email', value: farmer.email },
                  { icon: '📅', label: 'Member Since', value: farmer.memberSince },
                  { icon: '👤', label: 'Field Agent', value: farmer.fieldAgent },
                ].map((item) => (
                  <View key={item.label} style={styles.infoRow}>
                    <Text style={styles.infoIcon}>{item.icon}</Text>
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>{item.label}</Text>
                      <Text style={styles.infoValue}>{item.value}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Farm Details</Text>
                {[
                  { label: 'Farm Size', value: `${farmer.farmSize} ${farmer.farmUnit}` },
                  { label: 'Primary Crop', value: farmer.primaryCrop },
                  { label: 'Other Crops', value: farmer.secondaryCrops.join(', ') },
                  { label: 'Soil Type', value: farmer.soilType },
                  { label: 'Irrigation', value: farmer.irrigationType },
                  { label: 'Last Visit', value: farmer.lastVisit },
                  { label: 'Next Visit', value: farmer.nextVisit },
                ].map((item) => (
                  <View key={item.label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{item.label}</Text>
                    <Text style={styles.detailValue}>{item.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Crops Tab */}
          {activeTab === 'crops' && (
            <View style={styles.section}>
              {farmer.cropHistory.map((crop: any, i: number) => (
                <View key={i} style={styles.cropCard}>
                  <View style={styles.cropHeader}>
                    <Text style={styles.cropSeason}>{crop.season}</Text>
                    <Text style={styles.cropName}>{crop.crop}</Text>
                  </View>
                  <View style={styles.cropStats}>
                    <View style={styles.cropStat}>
                      <Text style={styles.cropStatLabel}>Yield</Text>
                      <Text style={styles.cropStatValue}>
                        {crop.yield} {crop.unit}
                      </Text>
                    </View>
                    <View style={styles.cropStat}>
                      <Text style={styles.cropStatLabel}>Area</Text>
                      <Text style={styles.cropStatValue}>{crop.area} ha</Text>
                    </View>
                    <View style={styles.cropStat}>
                      <Text style={styles.cropStatLabel}>Total</Text>
                      <Text style={styles.cropStatValue}>
                        {(crop.yield * crop.area).toFixed(1)} MT
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => Alert.alert('New Report', 'Opening crop report form...')}
              >
                <Text style={styles.addBtnText}>+ Add Crop Report</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Loans Tab */}
          {activeTab === 'loans' && (
            <View style={styles.section}>
              <View style={styles.loanSummary}>
                <View style={styles.loanSummaryStat}>
                  <Text style={styles.loanSummaryLabel}>Total Borrowed</Text>
                  <Text style={styles.loanSummaryValue}>
                    ₦{(farmer.totalLoanAmount / 1_000_000).toFixed(1)}M
                  </Text>
                </View>
                <View style={styles.loanSummaryStat}>
                  <Text style={styles.loanSummaryLabel}>Repayment Rate</Text>
                  <Text style={[styles.loanSummaryValue, { color: COLORS.success }]}>
                    {farmer.repaymentRate}%
                  </Text>
                </View>
              </View>

              {farmer.loans.map((loan: any) => (
                <View key={loan.id} style={styles.loanCard}>
                  <View style={styles.loanHeader}>
                    <Text style={styles.loanId}>{loan.id}</Text>
                    <View
                      style={[
                        styles.loanStatusBadge,
                        {
                          backgroundColor:
                            loan.status === 'ACTIVE'
                              ? `${COLORS.warning}20`
                              : `${COLORS.success}20`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.loanStatusText,
                          {
                            color:
                              loan.status === 'ACTIVE' ? COLORS.warning : COLORS.success,
                          },
                        ]}
                      >
                        {loan.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.loanPurpose}>{loan.purpose}</Text>
                  <View style={styles.loanDetails}>
                    <Text style={styles.loanAmount}>
                      ₦{(loan.amount / 1_000_000).toFixed(1)}M
                    </Text>
                    <Text style={styles.loanDate}>{loan.date}</Text>
                  </View>
                </View>
              ))}

              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => Alert.alert('Loan Application', 'Opening loan application form...')}
              >
                <Text style={styles.addBtnText}>+ New Loan Application</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row',
    padding: 16,
    gap: 14,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${COLORS.primary}20`,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes['2xl'],
    fontWeight: '700',
  },
  headerInfo: { flex: 1 },
  farmerName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '700',
    marginBottom: 4,
  },
  farmerLocation: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginBottom: 8,
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '700' },

  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs },

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

  section: { paddingHorizontal: 16, gap: 12 },

  card: {
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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  infoIcon: { fontSize: 16, width: 20, marginTop: 2 },
  infoContent: { flex: 1 },
  infoLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs },
  infoValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  detailValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 8,
  },

  cropCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cropHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cropSeason: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  cropName: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
  },
  cropStats: { flexDirection: 'row', gap: 8 },
  cropStat: { flex: 1, alignItems: 'center' },
  cropStatLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs },
  cropStatValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    marginTop: 2,
  },

  loanSummary: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 16,
  },
  loanSummaryStat: { flex: 1, alignItems: 'center' },
  loanSummaryLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.xs },
  loanSummaryValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    marginTop: 4,
  },

  loanCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  loanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  loanId: { color: COLORS.primary, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '700' },
  loanStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  loanStatusText: { fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '700' },
  loanPurpose: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginBottom: 8,
  },
  loanDetails: { flexDirection: 'row', justifyContent: 'space-between' },
  loanAmount: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  loanDate: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },

  addBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}15`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
    alignItems: 'center',
  },
  addBtnText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
});
