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
} from 'react-native';
import { trpc } from '../../lib/trpc';

type Tab = 'overview' | 'loans' | 'transactions';

export default function BankingScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const dashboardQuery = trpc.banking.getDashboard.useQuery();
  const loansQuery = trpc.banking.listLoans.useQuery({ limit: 20 });
  const txQuery = trpc.banking.getTransactions.useQuery({ limit: 20 });

  const isRefreshing = dashboardQuery.isFetching || loansQuery.isFetching || txQuery.isFetching;

  const onRefresh = () => {
    dashboardQuery.refetch();
    loansQuery.refetch();
    txQuery.refetch();
  };

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

  const dashboard = dashboardQuery.data;
  const loans = loansQuery.data?.loans ?? [];
  const transactions = txQuery.data?.transactions ?? [];

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
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'overview' && (
          <View>
            {dashboardQuery.isLoading ? (
              <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
            ) : (
              <>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Total Balance</Text>
                  <Text style={[styles.summaryValue, { color: '#16a34a' }]}>
                    {formatAmount(dashboard?.totalBalance)}
                  </Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Active Loans</Text>
                  <Text style={[styles.summaryValue, { color: '#d97706' }]}>
                    {dashboard?.activeLoansCount ?? 0}
                  </Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Outstanding Balance</Text>
                  <Text style={[styles.summaryValue, { color: '#dc2626' }]}>
                    {formatAmount(dashboard?.outstandingLoanBalance)}
                  </Text>
                </View>
                {(dashboard?.accounts ?? []).map((acc: any) => (
                  <View key={acc.id} style={styles.accountCard}>
                    <Text style={styles.accountName}>{acc.accountName ?? acc.bankName}</Text>
                    <Text style={styles.accountNumber}>{acc.accountNumber}</Text>
                    <Text style={styles.accountBalance}>{formatAmount(acc.balance)}</Text>
                  </View>
                ))}
              </>
            )}
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
            {loansQuery.isLoading ? (
              <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
            ) : loans.length === 0 ? (
              <Text style={styles.emptyText}>No loans found</Text>
            ) : (
              loans.map((loan: any) => (
                <View key={loan.id} style={styles.loanCard}>
                  <View style={styles.loanHeader}>
                    <Text style={styles.loanAmount}>{formatAmount(loan.amount)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getLoanStatusColor(loan.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getLoanStatusColor(loan.status) }]}>
                        {loan.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.loanMeta}>
                    {loan.bankName ?? loan.lenderName ?? 'Bank'} • Due: {loan.dueDate ? new Date(loan.dueDate).toLocaleDateString() : 'N/A'}
                  </Text>
                  {loan.purpose && <Text style={styles.loanPurpose}>{loan.purpose}</Text>}
                </View>
              ))
            )}
          </View>
        )}

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
                      <Text style={styles.txDate}>
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : tx.date ?? ''}
                      </Text>
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
  accountCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  accountName: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  accountNumber: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  accountBalance: { fontSize: 20, fontWeight: '700', color: '#2563eb' },
  applyBtn: { backgroundColor: '#16a34a', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  loanCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  loanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  loanAmount: { fontSize: 18, fontWeight: '700', color: '#111827' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  loanMeta: { fontSize: 13, color: '#6b7280' },
  loanPurpose: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 10, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  txDescription: { fontSize: 14, fontWeight: '500', color: '#111827' },
  txDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 32, fontSize: 14 },
});
