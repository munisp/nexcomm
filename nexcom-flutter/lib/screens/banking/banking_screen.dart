import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

class BankingScreen extends ConsumerStatefulWidget {
  const BankingScreen({super.key});

  @override
  ConsumerState<BankingScreen> createState() => _BankingScreenState();
}

class _BankingScreenState extends ConsumerState<BankingScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _summary;
  List<dynamic> _loans = [];
  List<dynamic> _transactions = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiServiceProvider);
      final results = await Future.wait([
        api.get('/banking/summary'),
        api.get('/banking/loans'),
        api.get('/banking/transactions'),
      ]);
      setState(() {
        _summary = results[0] as Map<String, dynamic>?;
        _loans = (results[1] as List?) ?? [];
        _transactions = (results[2] as List?) ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Banking'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Overview'),
            Tab(text: 'Loans'),
            Tab(text: 'Transactions'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text('Error: $_error'),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildOverview(),
                    _buildLoans(),
                    _buildTransactions(),
                  ],
                ),
    );
  }

  Widget _buildOverview() {
    if (_summary == null) {
      return const Center(child: Text('No banking data available'));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _SummaryCard(
            title: 'Account Balance',
            value: '₦${_formatAmount(_summary!['balance'] ?? 0)}',
            icon: Icons.account_balance_wallet,
            color: Colors.green,
          ),
          const SizedBox(height: 12),
          _SummaryCard(
            title: 'Active Loans',
            value: '${_summary!['activeLoans'] ?? 0}',
            icon: Icons.credit_card,
            color: Colors.orange,
          ),
          const SizedBox(height: 12),
          _SummaryCard(
            title: 'Outstanding Balance',
            value: '₦${_formatAmount(_summary!['outstandingBalance'] ?? 0)}',
            icon: Icons.money_off,
            color: Colors.red,
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _showLoanApplicationDialog,
            icon: const Icon(Icons.add),
            label: const Text('Apply for Loan'),
            style: ElevatedButton.styleFrom(
              minimumSize: const Size(double.infinity, 48),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoans() {
    if (_loans.isEmpty) {
      return const Center(
        child: Text('No active loans.\nTap Overview to apply.'),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _loans.length,
        itemBuilder: (context, index) {
          final loan = _loans[index];
          final status = loan['status'] as String? ?? 'UNKNOWN';
          final statusColor = _loanStatusColor(status);
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: statusColor.withOpacity(0.2),
                child: Icon(Icons.credit_card, color: statusColor),
              ),
              title: Text('₦${_formatAmount(loan['amount'] ?? 0)}'),
              subtitle: Text('${loan['bankName'] ?? 'Bank'} • Due: ${loan['dueDate'] ?? 'N/A'}'),
              trailing: Chip(
                label: Text(status, style: const TextStyle(fontSize: 11)),
                backgroundColor: statusColor.withOpacity(0.1),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildTransactions() {
    if (_transactions.isEmpty) {
      return const Center(child: Text('No recent transactions'));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _transactions.length,
        itemBuilder: (context, index) {
          final tx = _transactions[index];
          final isCredit = (tx['type'] as String? ?? '').contains('CREDIT');
          return ListTile(
            leading: CircleAvatar(
              backgroundColor: isCredit
                  ? Colors.green.withOpacity(0.2)
                  : Colors.red.withOpacity(0.2),
              child: Icon(
                isCredit ? Icons.arrow_downward : Icons.arrow_upward,
                color: isCredit ? Colors.green : Colors.red,
              ),
            ),
            title: Text(tx['description'] as String? ?? 'Transaction'),
            subtitle: Text(tx['date'] as String? ?? ''),
            trailing: Text(
              '${isCredit ? '+' : '-'}₦${_formatAmount(tx['amount'] ?? 0)}',
              style: TextStyle(
                color: isCredit ? Colors.green : Colors.red,
                fontWeight: FontWeight.bold,
              ),
            ),
          );
        },
      ),
    );
  }

  void _showLoanApplicationDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Apply for Loan'),
        content: const Text(
          'Visit nexcom.exchange/banking to complete your full loan application with document upload.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Open Web App'),
          ),
        ],
      ),
    );
  }

  String _formatAmount(dynamic amount) {
    final num value = amount is num ? amount : num.tryParse(amount.toString()) ?? 0;
    if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '${(value / 1000).toStringAsFixed(1)}K';
    return value.toStringAsFixed(0);
  }

  Color _loanStatusColor(String status) {
    switch (status.toUpperCase()) {
      case 'APPROVED':
      case 'DISBURSED':
        return Colors.green;
      case 'REPAYING':
        return Colors.blue;
      case 'PENDING':
      case 'UNDER_REVIEW':
        return Colors.orange;
      case 'REJECTED':
      case 'CANCELLED':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }
}

class _SummaryCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _SummaryCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: color.withOpacity(0.15),
              child: Icon(icon, color: color),
            ),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.bodySmall),
                Text(
                  value,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: color,
                      ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
