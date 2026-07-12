import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/api_service.dart';

/// NEXCOM Flutter — Credit Score Screen
/// Displays the user's credit score, tier, and contributing factors.
class CreditScoreScreen extends ConsumerStatefulWidget {
  const CreditScoreScreen({super.key});

  @override
  ConsumerState<CreditScoreScreen> createState() => _CreditScoreScreenState();
}

class _CreditScoreScreenState extends ConsumerState<CreditScoreScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _scoreData;
  String? _error;

  static const _bg = Color(0xFF0a0f1a);
  static const _surface = Color(0xFF111827);
  static const _border = Color(0xFF374151);
  static const _primary = Color(0xFF10b981);
  static const _warning = Color(0xFFf59e0b);
  static const _errorColor = Color(0xFFef4444);
  static const _textMuted = Color(0xFF9ca3af);

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('creditScoring/getMyScore');
      setState(() {
        _scoreData = result is Map<String, dynamic> ? result : null;
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  Color _scoreColor(int score) {
    if (score >= 750) return _primary;
    if (score >= 600) return _warning;
    return _errorColor;
  }

  String _tierLabel(String? tier) {
    switch (tier) {
      case 'PRIME': return 'Prime';
      case 'NEAR_PRIME': return 'Near Prime';
      case 'SUBPRIME': return 'Subprime';
      case 'DEEP_SUBPRIME': return 'Deep Subprime';
      default: return tier ?? '—';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _surface,
        title: const Text('Credit Score',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: _primary),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _primary))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: _errorColor)))
              : _scoreData == null
                  ? _buildNoScore()
                  : RefreshIndicator(
                      onRefresh: _loadData,
                      color: _primary,
                      child: SingleChildScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            _buildScoreCircle(),
                            const SizedBox(height: 24),
                            _buildDetailsCard(),
                            const SizedBox(height: 16),
                            if (_scoreData!['factors'] != null &&
                                (_scoreData!['factors'] as List).isNotEmpty)
                              _buildFactorsCard(),
                          ],
                        ),
                      ),
                    ),
    );
  }

  Widget _buildNoScore() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.credit_score, size: 64, color: _textMuted),
            const SizedBox(height: 16),
            const Text('No Credit Score',
                style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text(
              'Complete your KYC and make transactions to build your credit profile.',
              textAlign: TextAlign.center,
              style: TextStyle(color: _textMuted, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildScoreCircle() {
    final score = (_scoreData!['score'] as num?)?.toInt() ?? 0;
    final color = _scoreColor(score);
    return Center(
      child: Container(
        width: 160,
        height: 160,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: _surface,
          border: Border.all(color: color, width: 6),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('$score',
                style: TextStyle(color: color, fontSize: 42, fontWeight: FontWeight.w800)),
            const Text('Credit Score', style: TextStyle(color: _textMuted, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailsCard() {
    final d = _scoreData!;
    final currency = d['currency']?.toString() ?? 'NGN';
    final maxLoan = d['maxLoanAmount'];
    final rate = d['interestRatePct'];
    final computedAt = d['computedAt'];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _border),
      ),
      child: Column(
        children: [
          _detailRow('Tier', _tierLabel(d['tier']?.toString())),
          _detailRow('Max Loan',
              maxLoan != null ? '$currency ${_fmt(maxLoan)}' : '—'),
          _detailRow('Interest Rate', rate != null ? '$rate%' : '—'),
          _detailRow('Last Updated',
              computedAt != null
                  ? DateTime.tryParse(computedAt.toString())?.toLocal().toString().split(' ')[0] ?? '—'
                  : '—'),
        ],
      ),
    );
  }

  Widget _buildFactorsCard() {
    final factors = List<Map<String, dynamic>>.from(_scoreData!['factors'] as List);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Contributing Factors',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(height: 12),
          ...factors.map((f) {
            final impact = f['impact']?.toString();
            final dotColor = impact == 'positive' ? _primary : impact == 'negative' ? _errorColor : _textMuted;
            final weight = f['weight'] as num?;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: dotColor)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(f['description']?.toString() ?? f['factor']?.toString() ?? '—',
                        style: const TextStyle(color: Colors.white, fontSize: 13)),
                  ),
                  if (weight != null)
                    Text(weight > 0 ? '+$weight' : '$weight',
                        style: TextStyle(color: dotColor, fontFamily: 'monospace', fontSize: 12)),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: _textMuted, fontSize: 13)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  String _fmt(dynamic v) {
    final n = double.tryParse(v.toString()) ?? 0;
    return n.toStringAsFixed(2).replaceAllMapped(
        RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},');
  }
}
