import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/api_service.dart';

/// NEXCOM Flutter — Distributed Tracing Screen
/// Admin view of OTel trace spans, service map, and slow operations.
class DistributedTracingScreen extends ConsumerStatefulWidget {
  const DistributedTracingScreen({super.key});

  @override
  ConsumerState<DistributedTracingScreen> createState() =>
      _DistributedTracingScreenState();
}

class _DistributedTracingScreenState
    extends ConsumerState<DistributedTracingScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  List<Map<String, dynamic>> _traces = [];
  List<Map<String, dynamic>> _services = [];
  List<Map<String, dynamic>> _slowOps = [];
  String? _error;

  static const _bg = Color(0xFF0a0f1a);
  static const _surface = Color(0xFF111827);
  static const _surfaceAlt = Color(0xFF1f2937);
  static const _border = Color(0xFF374151);
  static const _primary = Color(0xFF10b981);
  static const _warning = Color(0xFFf59e0b);
  static const _error = Color(0xFFef4444);
  static const _textMuted = Color(0xFF9ca3af);

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
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final tracesRes = await api.get('tracing/getTraces?limit=30');
      final serviceRes = await api.get('tracing/getServiceMap');
      final slowRes = await api.get('tracing/getSlowOperations?limit=20');
      setState(() {
        _traces = List<Map<String, dynamic>>.from(
          tracesRes is List ? tracesRes : (tracesRes['traces'] ?? tracesRes['result'] ?? []),
        );
        final svcData = serviceRes is Map ? serviceRes : {};
        _services = List<Map<String, dynamic>>.from(svcData['services'] ?? []);
        _slowOps = List<Map<String, dynamic>>.from(
          slowRes is List ? slowRes : (slowRes['operations'] ?? slowRes['result'] ?? []),
        );
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _surface,
        title: const Text('Distributed Tracing',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: _primary),
            onPressed: _loadData,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: _primary,
          labelColor: _primary,
          unselectedLabelColor: _textMuted,
          tabs: const [
            Tab(text: 'Traces'),
            Tab(text: 'Services'),
            Tab(text: 'Slow Ops'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _primary))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: _error)))
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildTracesList(),
                    _buildServicesList(),
                    _buildSlowOpsList(),
                  ],
                ),
    );
  }

  Widget _buildTracesList() {
    if (_traces.isEmpty) {
      return const Center(child: Text('No traces found.', style: TextStyle(color: _textMuted)));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      color: _primary,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _traces.length,
        itemBuilder: (ctx, i) {
          final t = _traces[i];
          final dur = t['durationMs'] as num?;
          final durColor = (dur ?? 0) > 500 ? _warning : _primary;
          final isError = t['statusCode'] == 'ERROR';
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(t['serviceName']?.toString() ?? '—',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isError ? _error : _primary,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(t['statusCode']?.toString() ?? 'OK',
                          style: const TextStyle(color: Colors.white, fontSize: 10)),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(t['operationName']?.toString() ?? '—',
                    style: const TextStyle(color: _textMuted, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Text(dur != null ? '${dur}ms' : '—',
                    style: TextStyle(color: durColor, fontSize: 12, fontFamily: 'monospace')),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildServicesList() {
    if (_services.isEmpty) {
      return const Center(child: Text('No service data.', style: TextStyle(color: _textMuted)));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      color: _primary,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _services.length,
        itemBuilder: (ctx, i) {
          final svc = _services[i];
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(svc['name']?.toString() ?? 'Unknown',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _statBox('Spans', svc['spanCount']?.toString() ?? '0', Colors.white),
                    _statBox('Errors', svc['errorCount']?.toString() ?? '0', _error),
                    _statBox('Avg', svc['avgDurationMs'] != null ? '${svc['avgDurationMs']}ms' : '—', Colors.white),
                    _statBox('P99', svc['p99DurationMs'] != null ? '${svc['p99DurationMs']}ms' : '—', _warning),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSlowOpsList() {
    if (_slowOps.isEmpty) {
      return const Center(child: Text('No slow operations.', style: TextStyle(color: _textMuted)));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      color: _primary,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _slowOps.length,
        itemBuilder: (ctx, i) {
          final op = _slowOps[i];
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(op['operationName']?.toString() ?? '—',
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                      Text(op['serviceName']?.toString() ?? '—',
                          style: const TextStyle(color: _textMuted, fontSize: 11)),
                    ],
                  ),
                ),
                Text(op['durationMs'] != null ? '${op['durationMs']}ms' : '—',
                    style: const TextStyle(color: _error, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _statBox(String label, String value, Color valueColor) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: valueColor, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: _textMuted, fontSize: 11)),
      ],
    );
  }
}
