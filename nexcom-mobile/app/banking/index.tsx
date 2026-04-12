import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { trpc } from '../../lib/trpc';
import { useLoanNotifications, getLoanEventLabel } from '../../lib/useLoanNotifications';
import { useAuthStore } from '../../lib/store';

type Tab = 'overview' | 'loans' | 'transactions';
const LOAN_PURPOSES = ['WORKING_CAPITAL', 'INPUT_PURCHASE', 'EQUIPMENT', 'LAND_LEASE', 'STORAGE', 'OTHER'] as const;
type LoanPurpose = typeof LOAN_PURPOSES[number];

export default function BankingScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loanModalVisible, setLoanModalVisible] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanPurpose, setLoanPurpose] = useState<LoanPurpose>('WORKING_CAPITAL');
  const [loanTenor, setLoanTenor] = useState('12');
  const [loanCollateral, setLoanCollateral] = useState('');
  const [loanBankName, setLoanBankName] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const { user: authUser } = useAuthStore();
  const { events: loanEvents, unreadCount, markAllRead } = useLoanNotifications(authUser?.id);

  const dashboardQuery = trpc.banking.getDashboard.useQuery();
  const loansQuery = trpc.banking.listLoans.useQuery({ limit: 20 });
  const txQuery = trpc.banking.getTransactions.useQuery({ limit: 20 });

  const applyLoanMutation = trpc.banking.applyLoan.useMutation({
    onSuccess: () => {
      setLoanModalVisible(false);
      setLoanAmount('');
      setLoanCollateral('');
      setLoanBankName('');
      loansQuery.refetch();
      Alert.alert('Application Submitted', 'Your loan application has been submitted successfully. You will be notified once it is reviewed.');
    },
    onError: (err) => Alert.alert('Error', err.message ?? 'Failed to submit loan application'),
  });

  const isRefreshing = dashboardQuery.isFetching || loansQuery.isFetching || txQuery.isFetching;
  const onRefresh = () => { dashboardQuery.refetch(); loansQuery.refetch(); txQuery.refetch(); };

  const formatAmount = (amount: number | string | null | undefined) => {
    const n = Number(amount ?? 0);
    if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
    return `₦${n.toFixed(0)}`;
  };

  const getLoanStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'APPROVED': case 'DISBURSED': return '#16a34a';
      case 'REPAYING': return '#2563eb';
      case 'PENDING': case 'UNDER_REVIEW': return '#d97706';
      case 'REJECTED': case 'CANCELLED': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const handleApplyLoan = () => {
    const amount = parseFloat(loanAmount.replace(/,/g, ''));
    if (!amount || amount < 1000) { Alert.alert('Invalid Amount', 'Please enter a valid loan amount (minimum ₦1,000)'); return; }
    const tenor = parseInt(loanTenor, 10);
    if (!tenor || tenor < 1 || tenor > 60) { Alert.alert('Invalid Tenor', 'Please enter a valid tenor between 1 and 60 months'); return; }
    applyLoanMutation.mutate({
      amount,
      purpose: loanPurpose,
      tenorMonths: tenor,
      collateralDescription: loanCollateral || undefined,
      bankName: loanBankName || undefined,
    });
  };

  const dashboard = dashboardQuery.data;
  const loans = loansQuery.data?.loans ?? [];
  const transactions = txQuery.data?.transactions ?? [];
  const latestLoanEvent = loanEvents[0];
  const showBanner = !bannerDismissed && unreadCount > 0 && !!latestLoanEvent;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* Loan Notification Banner */}
      {showBanner && (
        <TouchableOpacity
          style={styles.notificationBanner}
          onPress={() => { markAllRead(); setBannerDismissed(true); setActiveTab('loans'); }}
        >
          <Text style={styles.bannerIcon}>🔔</Text>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>{getLoanEventLabel(latestLoanEvent.event)}</Text>
            {latestLoanEvent.message && (
              <Text style={styles.bannerMessage} numberOfLines={1}>{latestLoanEvent.message}</Text>
            )}
          </View>
          <TouchableOpacity onPress={() => setBannerDismissed(true)}>
            <Text style={styles.bannerClose}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Banking</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount}</Text></View>
          )}
        </View>

        <View style={styles.tabBar}>
          {(['overview', 'loans', 'transactions'] as Tab[]).map((tab) => (
            <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.activeTab]} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
        >
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <View>
              {dashboardQuery.isLoading ? (
                <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
              ) : (
                <>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Total Balance</Text>
                    <Text style={[styles.summaryValue, { color: '#2563eb' }]}>{formatAmount(dashboard?.totalBalance)}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Active Loans</Text>
                    <Text style={[styles.summaryValue, { color: '#d97706' }]}>{dashboard?.activeLoansCount ?? 0}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Outstanding Balance</Text>
                    <Text style={[styles.summaryValue, { color: '#dc2626' }]}>{formatAmount(dashboard?.outstandingLoanBalance)}</Text>
                  </View>
                  {(dashboard?.accounts ?? []).map((acc: any) => (
                    <View key={acc.id} style={styles.accountCard}>
                      <Text style={styles.accountName}>{acc.accountName ?? acc.bankName}</Text>
                      <Text style={styles.accountNumber}>{acc.accountNumber}</Text>
                      <Text style={styles.accountBalance}>{formatAmount(acc.balance)}</Text>
                    </View>
                  ))}
                  <TouchableOpacity style={styles.applyBtn} onPress={() => { setActiveTab('loans'); setLoanModalVisible(true); }}>
                    <Text style={styles.applyBtnText}>+ Apply for Loan</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Loans Tab */}
          {activeTab === 'loans' && (
            <View>
              <TouchableOpacity style={styles.applyBtn} onPress={() => setLoanModalVisible(true)}>
                <Text style={styles.applyBtnText}>+ Apply for Loan</Text>
              </TouchableOpacity>
              {loansQuery.isLoading ? (
                <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
              ) : loans.length === 0 ? (
                <Text style={styles.emptyText}>No loans found. Apply for your first loan above.</Text>
              ) : (
                loans.map((loan: any) => (
                  <View key={loan.id} style={styles.loanCard}>
                    <View style={styles.loanHeader}>
                      <Text style={styles.loanAmount}>{formatAmount(loan.amount)}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: getLoanStatusColor(loan.status) + '20' }]}>
                        <Text style={[styles.statusText, { color: getLoanStatusColor(loan.status) }]}>{loan.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.loanMeta}>
                      {loan.bankName ?? loan.lenderName ?? 'Bank'} • {loan.purpose ?? ''} • Due: {loan.dueDate ? new Date(loan.dueDate).toLocaleDateString() : 'N/A'}
                    </Text>
                    {loan.tenorMonths && <Text style={styles.loanPurpose}>{loan.tenorMonths} months tenor</Text>}
                  </View>
                ))
              )}
            </View>
          )}

          {/* Transactions Tab */}
          {activeTab === 'transactions' && (
            <View>
              {txQuery.isLoading ? (
                <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
              ) : transactions.length === 0 ? (
                <Text style={styles.emptyText}>No transactions found</Text>
              ) : (
                transactions.map((tx: any) => {
                  const isCredit = tx.type === 'CREDIT' || tx.type === 'credit';
                  return (
                    <View key={tx.id} style={styles.txRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txDescription}>{tx.description ?? tx.narration}</Text>
                        <Text style={styles.txDate}>{tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : tx.date ?? ''}</Text>
                      </View>
                      <Text style={[styles.txAmount, { color: isCredit ? '#16a34a' : '#dc2626' }]}>
                        {isCredit ? '+' : '-'}{formatAmount(tx.amount)}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      </View>

      {/* Loan Application Modal */}
      <Modal visible={loanModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLoanModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Apply for Loan</Text>
            <TouchableOpacity onPress={() => setLoanModalVisible(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody}>
            <Text style={styles.fieldLabel}>Loan Amount (₦) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 500000"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              value={loanAmount}
              onChangeText={setLoanAmount}
            />

            <Text style={styles.fieldLabel}>Purpose *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              {LOAN_PURPOSES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.purposeChip, loanPurpose === p && styles.purposeChipActive]}
                  onPress={() => setLoanPurpose(p)}
                >
                  <Text style={[styles.purposeChipText, loanPurpose === p && styles.purposeChipTextActive]}>
                    {p.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Tenor (months) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 12"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              value={loanTenor}
              onChangeText={setLoanTenor}
            />

            <Text style={styles.fieldLabel}>Preferred Bank (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Access Bank"
              placeholderTextColor="#9ca3af"
              value={loanBankName}
              onChangeText={setLoanBankName}
            />

            <Text style={styles.fieldLabel}>Collateral Description (optional)</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Describe any collateral you can offer..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              value={loanCollateral}
              onChangeText={setLoanCollateral}
            />

            <TouchableOpacity
              style={[styles.submitBtn, applyLoanMutation.isPending && { opacity: 0.6 }]}
              onPress={handleApplyLoan}
              disabled={applyLoanMutation.isPending}
            >
              {applyLoanMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Application</Text>
              )}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f9fafb' },
  container: { flex: 1 },
  notificationBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1d4ed8',
    paddingHorizontal: 16, paddingVertical: 10, gap: 10,
  },
  bannerIcon: { fontSize: 18 },
  bannerContent: { flex: 1 },
  bannerTitle: { color: '#fff', fontWeight: '700', fontSize: 13 },
  bannerMessage: { color: '#bfdbfe', fontSize: 12, marginTop: 1 },
  bannerClose: { color: '#93c5fd', fontSize: 16, paddingLeft: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', flex: 1 },
  badge: {
    backgroundColor: '#dc2626', borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#16a34a' },
  tabText: { fontSize: 14, color: '#6b7280' },
  activeTabText: { color: '#16a34a', fontWeight: '600' },
  content: { flex: 1, padding: 16 },
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  summaryLabel: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  summaryValue: { fontSize: 24, fontWeight: '700' },
  accountCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  accountName: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  accountNumber: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  accountBalance: { fontSize: 20, fontWeight: '700', color: '#2563eb' },
  applyBtn: { backgroundColor: '#16a34a', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 32, fontSize: 14 },
  loanCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  loanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  loanAmount: { fontSize: 18, fontWeight: '700', color: '#111827' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  loanMeta: { fontSize: 13, color: '#6b7280' },
  loanPurpose: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  txRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  txDescription: { fontSize: 14, color: '#111827', fontWeight: '500' },
  txDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
  // Modal
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  modalClose: { fontSize: 20, color: '#6b7280', padding: 4 },
  modalBody: { flex: 1, padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb',
  },
  purposeChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#d1d5db', marginRight: 8, backgroundColor: '#f9fafb',
  },
  purposeChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  purposeChipText: { fontSize: 13, color: '#374151' },
  purposeChipTextActive: { color: '#fff', fontWeight: '600' },
  submitBtn: { backgroundColor: '#16a34a', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
