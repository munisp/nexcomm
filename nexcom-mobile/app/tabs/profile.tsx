import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { trpc } from '../../lib/trpc';
import { useAuthStore } from '../../lib/store';

const MENU_SECTIONS = [
  {
    title: 'Account',
    items: [
      { icon: '👤', label: 'Personal Information', route: '/profile/personal' },
      { icon: '🏦', label: 'Bank Accounts', route: '/profile/banks' },
      { icon: '📋', label: 'KYC Documents', route: '/profile/kyc' },
      { icon: '🔐', label: 'Security Settings', route: '/profile/security' },
    ],
  },
  {
    title: 'Trading',
    items: [
      { icon: '📊', label: 'Trading Limits', route: '/profile/limits' },
      { icon: '📜', label: 'Trade History', route: '/profile/history' },
      { icon: '📄', label: 'Statements', route: '/profile/statements' },
      { icon: '🧾', label: 'Tax Reports', route: '/profile/tax' },
    ],
  },
  {
    title: 'Services',
    items: [
      { icon: '🏭', label: 'Warehouse Receipts', route: '/tabs/warehouse' },
      { icon: '🏦', label: 'Banking & Loans', route: '/banking' },
      { icon: '🔔', label: 'Notifications', route: '/notifications' },
      { icon: '💰', label: 'Input Financing', route: '/financing' },
      { icon: '🌾', label: 'Field Agent Network', route: '/field-agents' },
      { icon: '📈', label: 'Fixed Income', route: '/fixed-income' },
    ],
  },
  {
    title: 'Support',
    items: [
      { icon: '❓', label: 'Help Center', route: '/help' },
      { icon: '💬', label: 'Live Chat', route: '/chat' },
      { icon: '📞', label: 'Contact Us', route: '/contact' },
      { icon: 'ℹ️', label: 'About NEXCOM', route: '/about' },
    ],
  },
];

export default function ProfileScreen() {
  const [notifications, setNotifications] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const { user: authUser } = useAuthStore();
  const profileQuery = trpc.profile.get.useQuery(undefined, { enabled: !!authUser });
  const portfolioQuery = trpc.portfolio.summary.useQuery(undefined, { enabled: !!authUser });
  const profile = profileQuery.data;
  const portfolio = portfolioQuery.data;
  const displayName = profile?.displayName ?? authUser?.name ?? 'User';
  const displayEmail = profile?.email ?? authUser?.email ?? '';
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out of NEXCOM Exchange?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: () => router.replace('/auth' as any),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            {profileQuery.isLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <>
                <Text style={styles.profileName}>{displayName}</Text>
                <Text style={styles.profileEmail}>{displayEmail}</Text>
                <View style={styles.profileBadges}>
                  {profile?.kycStatus === 'VERIFIED' && (
                    <View style={[styles.badge, { backgroundColor: `${COLORS.success}20` }]}>
                      <Text style={[styles.badgeText, { color: COLORS.success }]}>✓ KYC Verified</Text>
                    </View>
                  )}
                  {profile?.accountType && (
                    <View style={[styles.badge, { backgroundColor: `${COLORS.primary}20` }]}>
                      <Text style={[styles.badgeText, { color: COLORS.primary }]}>{profile.accountType}</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        </View>

        {/* Account Balance */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceRow}>
            <View style={styles.balanceItem}>
              <Text style={styles.balanceLabel}>Portfolio Value</Text>
              <Text style={styles.balanceValue}>
                ₦{((portfolio?.totalValue ?? 0) / 1_000_000).toFixed(2)}M
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceItem}>
              <Text style={styles.balanceLabel}>Unrealized P&L</Text>
              <Text style={[styles.balanceValue, { color: (portfolio?.unrealizedPnl ?? 0) >= 0 ? COLORS.success : COLORS.error }]}>
                ₦{((portfolio?.unrealizedPnl ?? 0) / 1_000_000).toFixed(2)}M
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceItem}>
              <Text style={styles.balanceLabel}>Positions</Text>
              <Text style={[styles.balanceValue, { color: COLORS.primary }]}>
                {portfolio?.positionCount ?? 0}
              </Text>
            </View>
          </View>
          <Text style={styles.tradingId}>Member ID: {authUser?.id ?? '-'}</Text>
        </View>

        {/* Quick Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <View style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🔔</Text>
                <Text style={styles.settingLabel}>Push Notifications</Text>
              </View>
              <Switch
                value={notifications}
                onValueChange={setNotifications}
                trackColor={{ false: COLORS.border, true: `${COLORS.primary}60` }}
                thumbColor={notifications ? COLORS.primary : COLORS.textDim}
              />
            </View>
            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🔒</Text>
                <Text style={styles.settingLabel}>Biometric Login</Text>
              </View>
              <Switch
                value={biometric}
                onValueChange={setBiometric}
                trackColor={{ false: COLORS.border, true: `${COLORS.primary}60` }}
                thumbColor={biometric ? COLORS.primary : COLORS.textDim}
              />
            </View>
            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🌙</Text>
                <Text style={styles.settingLabel}>Dark Mode</Text>
              </View>
              <Switch
                value={darkMode}
                onValueChange={setDarkMode}
                trackColor={{ false: COLORS.border, true: `${COLORS.primary}60` }}
                thumbColor={darkMode ? COLORS.primary : COLORS.textDim}
              />
            </View>
          </View>
        </View>

        {/* Menu Sections */}
        {MENU_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.menuCard}>
              {section.items.map((item, index) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.menuRow,
                    index < section.items.length - 1 && styles.menuRowBorder,
                  ]}
                  onPress={() => router.push(item.route as any)}
                >
                  <Text style={styles.menuIcon}>{item.icon}</Text>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* App Version */}
        <View style={styles.versionSection}>
          <Text style={styles.versionText}>NEXCOM Exchange v1.0.0</Text>
          {profile?.createdAt && (
            <Text style={styles.versionSubtext}>
              Member since {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </Text>
          )}
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>🚪 Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  profileHeader: {
    flexDirection: 'row',
    padding: 20,
    gap: 16,
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${COLORS.primary}30`,
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
  profileInfo: { flex: 1 },
  profileName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '700',
    marginBottom: 2,
  },
  profileEmail: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginBottom: 8,
  },
  profileBadges: { flexDirection: 'row', gap: 8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: TYPOGRAPHY.sizes.xs, fontWeight: '700' },

  balanceCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  balanceRow: { flexDirection: 'row', marginBottom: 12 },
  balanceItem: { flex: 1, alignItems: 'center' },
  balanceDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  balanceLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 4,
  },
  balanceValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  tradingId: {
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },

  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  settingRowBorder: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingIcon: { fontSize: 18 },
  settingLabel: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
  },

  menuCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  menuRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuIcon: { fontSize: 18, width: 24 },
  menuLabel: {
    flex: 1,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
  },
  menuArrow: {
    color: COLORS.textDim,
    fontSize: 20,
    fontWeight: '300',
  },

  versionSection: { alignItems: 'center', marginBottom: 16 },
  versionText: {
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  versionSubtext: {
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },

  logoutBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: `${COLORS.error}15`,
    borderWidth: 1,
    borderColor: `${COLORS.error}40`,
    alignItems: 'center',
  },
  logoutText: {
    color: COLORS.error,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
});
