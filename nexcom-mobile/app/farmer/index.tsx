import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';

const AGENT_STATS = {
  farmersOnboarded: 1247,
  activeFarmers: 892,
  totalAcreage: 45600,
  pendingVisits: 12,
  completedVisits: 89,
  loanApplications: 34,
  cropReports: 156,
};

const PENDING_TASKS = [
  {
    id: '1',
    type: 'VISIT',
    farmer: 'Ibrahim Musa',
    location: 'Kano, Kumbotso LGA',
    crop: 'Maize',
    priority: 'HIGH',
    dueDate: 'Today',
    coordinates: { lat: 12.0022, lng: 8.5920 },
  },
  {
    id: '2',
    type: 'LOAN_ASSESSMENT',
    farmer: 'Fatima Bello',
    location: 'Kaduna, Zaria',
    crop: 'Soybean',
    priority: 'MEDIUM',
    dueDate: 'Tomorrow',
    coordinates: { lat: 11.0855, lng: 7.7199 },
  },
  {
    id: '3',
    type: 'CROP_REPORT',
    farmer: 'Emeka Okafor',
    location: 'Benue, Makurdi',
    crop: 'Sorghum',
    priority: 'LOW',
    dueDate: 'Mar 25',
    coordinates: { lat: 7.7337, lng: 8.5374 },
  },
];

const RECENT_FARMERS = [
  { id: '1', name: 'Ibrahim Musa', crop: 'Maize', acreage: 5.2, status: 'ACTIVE', kycStatus: 'VERIFIED' },
  { id: '2', name: 'Fatima Bello', crop: 'Soybean', acreage: 3.8, status: 'ACTIVE', kycStatus: 'VERIFIED' },
  { id: '3', name: 'Emeka Okafor', crop: 'Sorghum', acreage: 7.1, status: 'PENDING', kycStatus: 'PENDING' },
  { id: '4', name: 'Aisha Mohammed', crop: 'Sesame', acreage: 4.5, status: 'ACTIVE', kycStatus: 'VERIFIED' },
];

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: COLORS.error,
  MEDIUM: COLORS.warning,
  LOW: COLORS.success,
};

const TASK_ICONS: Record<string, string> = {
  VISIT: '🚗',
  LOAN_ASSESSMENT: '💰',
  CROP_REPORT: '📋',
  KYC: '🪪',
};

export default function FieldAgentScreen() {
  const [activeTab, setActiveTab] = useState<'tasks' | 'farmers' | 'reports'>('tasks');

  const handleStartVisit = (task: typeof PENDING_TASKS[0]) => {
    Alert.alert(
      'Start Visit',
      `Navigate to ${task.farmer} at ${task.location}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Maps',
          onPress: () => {
            Alert.alert('Navigation', `Opening maps to: ${task.location}\nCoords: ${task.coordinates.lat}, ${task.coordinates.lng}`);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Agent Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Farmers', value: AGENT_STATS.farmersOnboarded.toLocaleString(), icon: '👨‍🌾' },
            { label: 'Active', value: AGENT_STATS.activeFarmers.toLocaleString(), icon: '✅' },
            { label: 'Acreage', value: `${(AGENT_STATS.totalAcreage / 1000).toFixed(1)}K ha`, icon: '🌾' },
            { label: 'Pending', value: AGENT_STATS.pendingVisits.toString(), icon: '📍' },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statIcon}>{stat.icon}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          {[
            { icon: '➕', label: 'Onboard Farmer', action: () => Alert.alert('Coming Soon', 'Farmer onboarding form') },
            { icon: '📋', label: 'Crop Report', action: () => Alert.alert('Coming Soon', 'Crop report form') },
            { icon: '💰', label: 'Loan Request', action: () => Alert.alert('Coming Soon', 'Loan application form') },
            { icon: '🗺️', label: 'Field Map', action: () => Alert.alert('Coming Soon', 'Field mapping tool') },
          ].map((action) => (
            <TouchableOpacity
              key={action.label}
              style={styles.quickActionBtn}
              onPress={action.action}
            >
              <View style={styles.quickActionIcon}>
                <Text style={styles.quickActionEmoji}>{action.icon}</Text>
              </View>
              <Text style={styles.quickActionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Selector */}
        <View style={styles.tabSelector}>
          {(['tasks', 'farmers', 'reports'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'tasks' ? `Tasks (${AGENT_STATS.pendingVisits})` :
                 tab === 'farmers' ? 'Farmers' : 'Reports'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <View style={styles.section}>
            {PENDING_TASKS.map((task) => (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <View style={styles.taskLeft}>
                    <Text style={styles.taskIcon}>{TASK_ICONS[task.type]}</Text>
                    <View>
                      <Text style={styles.taskType}>{task.type.replace('_', ' ')}</Text>
                      <Text style={styles.taskFarmer}>{task.farmer}</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.priorityBadge,
                      { backgroundColor: `${PRIORITY_COLORS[task.priority]}20` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.priorityText,
                        { color: PRIORITY_COLORS[task.priority] },
                      ]}
                    >
                      {task.priority}
                    </Text>
                  </View>
                </View>

                <View style={styles.taskDetails}>
                  <Text style={styles.taskDetail}>📍 {task.location}</Text>
                  <Text style={styles.taskDetail}>🌾 {task.crop}</Text>
                  <Text style={styles.taskDetail}>📅 Due: {task.dueDate}</Text>
                </View>

                <View style={styles.taskActions}>
                  <TouchableOpacity
                    style={styles.taskActionBtn}
                    onPress={() => handleStartVisit(task)}
                  >
                    <Text style={styles.taskActionText}>🗺️ Navigate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.taskActionBtn, styles.taskActionBtnPrimary]}
                    onPress={() => Alert.alert('Task', 'Opening task form...')}
                  >
                    <Text style={[styles.taskActionText, { color: COLORS.primary }]}>
                      Start Task →
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Farmers Tab */}
        {activeTab === 'farmers' && (
          <View style={styles.section}>
            {RECENT_FARMERS.map((farmer) => (
              <TouchableOpacity
                key={farmer.id}
                style={styles.farmerCard}
                onPress={() => router.push(`/farmer/${farmer.id}` as any)}
              >
                <View style={styles.farmerAvatar}>
                  <Text style={styles.farmerAvatarText}>{farmer.name[0]}</Text>
                </View>
                <View style={styles.farmerInfo}>
                  <Text style={styles.farmerName}>{farmer.name}</Text>
                  <Text style={styles.farmerDetails}>
                    {farmer.crop} · {farmer.acreage} ha
                  </Text>
                </View>
                <View style={styles.farmerStatus}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor:
                          farmer.kycStatus === 'VERIFIED' ? COLORS.success : COLORS.warning,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.farmerStatusText,
                      {
                        color:
                          farmer.kycStatus === 'VERIFIED' ? COLORS.success : COLORS.warning,
                      },
                    ]}
                  >
                    {farmer.kycStatus}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <View style={styles.section}>
            <View style={styles.reportsCard}>
              <Text style={styles.reportsTitle}>Crop Reports Summary</Text>
              <View style={styles.reportsStat}>
                <Text style={styles.reportsStatLabel}>Total Reports Filed</Text>
                <Text style={styles.reportsStatValue}>{AGENT_STATS.cropReports}</Text>
              </View>
              <View style={styles.reportsStat}>
                <Text style={styles.reportsStatLabel}>This Month</Text>
                <Text style={styles.reportsStatValue}>23</Text>
              </View>
              <View style={styles.reportsStat}>
                <Text style={styles.reportsStatLabel}>Loan Applications</Text>
                <Text style={styles.reportsStatValue}>{AGENT_STATS.loanApplications}</Text>
              </View>
              <TouchableOpacity style={styles.newReportBtn}>
                <Text style={styles.newReportBtnText}>+ File New Crop Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  statsGrid: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 8,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statIcon: { fontSize: 20, marginBottom: 4 },
  statValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
  },

  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  quickActionBtn: { flex: 1, alignItems: 'center' },
  quickActionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickActionEmoji: { fontSize: 22 },
  quickActionLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    textAlign: 'center',
    fontWeight: '500',
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

  section: { paddingHorizontal: 16, gap: 12 },

  taskCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  taskLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskIcon: { fontSize: 24 },
  taskType: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  taskFarmer: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginTop: 2,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityText: { fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '700' },
  taskDetails: { gap: 4, marginBottom: 12 },
  taskDetail: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  taskActions: { flexDirection: 'row', gap: 8 },
  taskActionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskActionBtnPrimary: {
    backgroundColor: `${COLORS.primary}15`,
    borderColor: `${COLORS.primary}40`,
  },
  taskActionText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
  },

  farmerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  farmerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${COLORS.primary}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  farmerAvatarText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
  },
  farmerInfo: { flex: 1 },
  farmerName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },
  farmerDetails: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginTop: 2,
  },
  farmerStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  farmerStatusText: { fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '600' },

  reportsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reportsTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 16,
  },
  reportsStat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reportsStatLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  reportsStatValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  newReportBtn: {
    marginTop: 16,
    paddingVertical: 12,
    backgroundColor: `${COLORS.primary}20`,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  newReportBtnText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
});
