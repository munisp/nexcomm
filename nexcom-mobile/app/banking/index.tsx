import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';

type Tab = 'overview' | 'loans' | 'transactions';

// Mock data for demo
const MOCK_SUMMARY = { totalBalance: 2450000, activeLoans: 2, outstandingBalance: 800000 };
const MOCK_LOANS = [
  { id: 1, amount: 500000, bankName: 'Access Bank', dueDate: '30 Jun 2026', status: 'REPAYING' },
  { id: 2, amount: 300000, bankName: 'GTBank', dueDate: '15 Aug 2026', status: 'APPROVED' },
];
const MOCK_TRANSACTIONS = [
  { id: 1, description: 'BUY MAIZE @₦285,000/MT', date: '22-Mar', amount: 285000, type: 'DEBIT' },
  { id: 2, description: 'SELL SOYBEANS @₦520,000/MT', date: '20-Mar', amount: 520000, type: 'CREDIT' },
  { id: 3, description: 'Loan Repayment – Access Bank', date: '18-Mar', amount: 50000, type: 'DEBIT' },
];

export default function BankingScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
  }, []);

  const formatAmount = (amount: number) => {
    if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(1)}K`;
    return `₦${amount.toFixed(0)}`;
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Banking</Text>
      </View>

      <View style={styles.tabBar}>
        {(['overview', 'loans', 'transactions'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'overview' && (
          <View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Account Balance</Text>
              <Text style={[styles.summaryValue, { color: '#16a34a' }]}>
                {formatAmount(MOCK_SUMMARY.totalBalance)}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Active Loans</Text>
              <Text style={[styles.summaryValue, { color: '#d97706' }]}>
                {MOCK_SUMMARY.activeLoans}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Outstanding Balance</Text>
              <Text style={[styles.summaryValue, { color: '#dc2626' }]}>
                {formatAmount(MOCK_SUMMARY.outstandingBalance)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => Alert.alert('Apply for Loan', 'Visit nexcom.exchange/banking to complete your full loan application.', [{ text: 'OK' }])}
            >
              <Text style={styles.applyBtnText}>+ Apply for Loan</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeTab === 'loans' && (
          <View>
            {MOCK_LOANS.map((loan) => (
              <View key={loan.id} style={styles.loanCard}>
                <View style={styles.loanHeader}>
                  <Text style={styles.loanAmount}>{formatAmount(loan.amount)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getLoanStatusColor(loan.status) + '20' }]}>
                    <Text style={[styles.statusText, { color: getLoanStatusColor(loan.status) }]}>
                      {loan.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.loanMeta}>{loan.bankName} • Due: {loan.dueDate}</Text>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'transactions' && (
          <View>
            {MOCK_TRANSACTIONS.map((tx) => {
              const isCredit = tx.type === 'CREDIT';
              return (
                <View key={tx.id} style={styles.txRow}>
                  <View>
                    <Text style={styles.txDescription}>{tx.description}</Text>
                    <Text style={styles.txDate}>{tx.date}</Text>
                  </View>
                  <Text style={[styles.txAmount, { color: isCredit ? '#16a34a' : '#dc2626' }]}>
                    {isCredit ? '+' : '-'}{formatAmount(tx.amount)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#16a34a' },
  tabText: { fontSize: 14, color: '#6b7280' },
  activeTabText: { color: '#16a34a', fontWeight: '600' },
  content: { flex: 1, padding: 16 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  summaryLabel: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  summaryValue: { fontSize: 24, fontWeight: '700' },
  applyBtn: { backgroundColor: '#16a34a', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  loanCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  loanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  loanAmount: { fontSize: 18, fontWeight: '700', color: '#111827' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  loanMeta: { fontSize: 13, color: '#6b7280' },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 10, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  txDescription: { fontSize: 14, fontWeight: '500', color: '#111827' },
  txDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
});
