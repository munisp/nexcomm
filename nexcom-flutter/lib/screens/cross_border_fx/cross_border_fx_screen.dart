import 'package:flutter/material.dart';

// ── Data Models ───────────────────────────────────────────────────────────────

class Corridor {
  final String from;
  final String to;
  final String name;
  final String flag;
  final double rate;

  const Corridor({
    required this.from,
    required this.to,
    required this.name,
    required this.flag,
    required this.rate,
  });
}

class CrossBorderTransfer {
  final String id;
  final String corridor;
  final double amount;
  final String sourceCurrency;
  final String destCurrency;
  final double destAmount;
  final String status;
  final int currentStep;
  final DateTime createdAt;
  final String? workflowId;

  const CrossBorderTransfer({
    required this.id,
    required this.corridor,
    required this.amount,
    required this.sourceCurrency,
    required this.destCurrency,
    required this.destAmount,
    required this.status,
    required this.currentStep,
    required this.createdAt,
    this.workflowId,
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const _corridors = [
  Corridor(from: 'NGN', to: 'USD', name: 'Nigeria → USA', flag: '🇳🇬→🇺🇸', rate: 0.00063),
  Corridor(from: 'KES', to: 'USD', name: 'Kenya → USA', flag: '🇰🇪→🇺🇸', rate: 0.00776),
  Corridor(from: 'GHS', to: 'USD', name: 'Ghana → USA', flag: '🇬🇭→🇺🇸', rate: 0.0667),
  Corridor(from: 'ZAR', to: 'USD', name: 'South Africa → USA', flag: '🇿🇦→🇺🇸', rate: 0.0547),
  Corridor(from: 'ETB', to: 'USD', name: 'Ethiopia → USA', flag: '🇪🇹→🇺🇸', rate: 0.0175),
  Corridor(from: 'XOF', to: 'EUR', name: 'WAEMU → Europe', flag: '🌍→🇪🇺', rate: 0.00152),
];

const _transferSteps = [
  'KYC Validation',
  'Compliance Check',
  'FX Rate Lock',
  'Debit Source',
  'ILP Routing',
  'Credit Destination',
];

final _mockTransfers = [
  CrossBorderTransfer(
    id: 'TXN-001',
    corridor: 'Nigeria → USA',
    amount: 500000,
    sourceCurrency: 'NGN',
    destCurrency: 'USD',
    destAmount: 315.0,
    status: 'COMPLETED',
    currentStep: 6,
    createdAt: DateTime.now().subtract(const Duration(days: 1)),
    workflowId: 'wf-abc123',
  ),
  CrossBorderTransfer(
    id: 'TXN-002',
    corridor: 'Kenya → USA',
    amount: 50000,
    sourceCurrency: 'KES',
    destCurrency: 'USD',
    destAmount: 388.0,
    status: 'IN_PROGRESS',
    currentStep: 3,
    createdAt: DateTime.now().subtract(const Duration(hours: 1)),
    workflowId: 'wf-def456',
  ),
];

// ── Screen ────────────────────────────────────────────────────────────────────

class CrossBorderFxScreen extends StatefulWidget {
  const CrossBorderFxScreen({super.key});

  @override
  State<CrossBorderFxScreen> createState() => _CrossBorderFxScreenState();
}

class _CrossBorderFxScreenState extends State<CrossBorderFxScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Form state
  Corridor _selectedCorridor = _corridors.first;
  final _amountController = TextEditingController();
  final _recipientController = TextEditingController();
  final _recipientNameController = TextEditingController();
  String _purposeCode = 'FAMILY_SUPPORT';
  bool _loading = false;
  bool _showCorridorPicker = false;

  // History state
  List<CrossBorderTransfer> _transfers = List.from(_mockTransfers);
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _amountController.dispose();
    _recipientController.dispose();
    _recipientNameController.dispose();
    super.dispose();
  }

  double get _destAmount {
    final amt = double.tryParse(_amountController.text) ?? 0;
    return amt * _selectedCorridor.rate;
  }

  Future<void> _handleSend() async {
    final amt = double.tryParse(_amountController.text);
    if (amt == null || amt <= 0) {
      _showError('Please enter a valid amount.');
      return;
    }
    if (_recipientController.text.trim().isEmpty) {
      _showError('Please enter the recipient account.');
      return;
    }
    setState(() => _loading = true);
    await Future.delayed(const Duration(milliseconds: 1500));
    final newTransfer = CrossBorderTransfer(
      id: 'TXN-${DateTime.now().millisecondsSinceEpoch % 10000}',
      corridor: _selectedCorridor.name,
      amount: amt,
      sourceCurrency: _selectedCorridor.from,
      destCurrency: _selectedCorridor.to,
      destAmount: _destAmount,
      status: 'PENDING',
      currentStep: 0,
      createdAt: DateTime.now(),
      workflowId: 'wf-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}',
    );
    setState(() {
      _transfers = [newTransfer, ..._transfers];
      _loading = false;
      _amountController.clear();
      _recipientController.clear();
      _recipientNameController.clear();
    });
    _tabController.animateTo(1);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Transfer ${newTransfer.id} initiated!\nWorkflow: ${newTransfer.workflowId}'),
          backgroundColor: Colors.green,
        ),
      );
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  Future<void> _onRefresh() async {
    setState(() => _refreshing = true);
    await Future.delayed(const Duration(seconds: 1));
    setState(() => _refreshing = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161B22),
        foregroundColor: Colors.white,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Cross-Border FX', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text('Mojaloop ILP Transfers', style: TextStyle(fontSize: 12, color: Colors.white54)),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF1A73E8),
          labelColor: const Color(0xFF1A73E8),
          unselectedLabelColor: Colors.white54,
          tabs: const [
            Tab(text: 'Send Money'),
            Tab(text: 'History'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildSendTab(cs),
          _buildHistoryTab(),
        ],
      ),
    );
  }

  // ── Send Tab ────────────────────────────────────────────────────────────────

  Widget _buildSendTab(ColorScheme cs) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionLabel('Transfer Corridor'),
          _buildCorridorSelector(),
          const SizedBox(height: 16),
          _buildSectionLabel('Amount (${_selectedCorridor.from})'),
          _buildAmountField(),
          if (_amountController.text.isNotEmpty) _buildConversionPreview(),
          const SizedBox(height: 16),
          _buildSectionLabel('Recipient Account'),
          _buildTextField(_recipientController, 'IBAN / Account number / Mobile'),
          const SizedBox(height: 16),
          _buildSectionLabel('Recipient Name'),
          _buildTextField(_recipientNameController, 'Full legal name'),
          const SizedBox(height: 16),
          _buildSectionLabel('Purpose'),
          _buildPurposeChips(),
          const SizedBox(height: 16),
          _buildInfoBox(),
          const SizedBox(height: 16),
          _buildSendButton(),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildSectionLabel(String label) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          label.toUpperCase(),
          style: const TextStyle(fontSize: 11, color: Colors.white54, letterSpacing: 0.5),
        ),
      );

  Widget _buildCorridorSelector() {
    return Column(
      children: [
        GestureDetector(
          onTap: () => setState(() => _showCorridorPicker = !_showCorridorPicker),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF161B22),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFF30363D)),
            ),
            child: Row(
              children: [
                Text(_selectedCorridor.flag, style: const TextStyle(fontSize: 20)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_selectedCorridor.name,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                      Text(
                        'Rate: 1 ${_selectedCorridor.from} = ${_selectedCorridor.rate.toStringAsFixed(6)} ${_selectedCorridor.to}',
                        style: const TextStyle(fontSize: 11, color: Colors.white54),
                      ),
                    ],
                  ),
                ),
                Icon(
                  _showCorridorPicker ? Icons.expand_less : Icons.expand_more,
                  color: Colors.white54,
                ),
              ],
            ),
          ),
        ),
        if (_showCorridorPicker)
          Container(
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF161B22),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFF30363D)),
            ),
            child: Column(
              children: _corridors.map((corridor) {
                final isSelected = corridor.from == _selectedCorridor.from;
                return ListTile(
                  dense: true,
                  tileColor: isSelected ? const Color(0xFF1A73E8).withAlpha(30) : null,
                  leading: Text(corridor.flag, style: const TextStyle(fontSize: 18)),
                  title: Text(corridor.name,
                      style: const TextStyle(color: Colors.white, fontSize: 14)),
                  onTap: () => setState(() {
                    _selectedCorridor = corridor;
                    _showCorridorPicker = false;
                  }),
                );
              }).toList(),
            ),
          ),
      ],
    );
  }

  Widget _buildAmountField() {
    return TextField(
      controller: _amountController,
      keyboardType: TextInputType.number,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        hintText: 'Enter amount in ${_selectedCorridor.from}',
        hintStyle: const TextStyle(color: Colors.white38),
        filled: true,
        fillColor: const Color(0xFF161B22),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFF30363D)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFF30363D)),
        ),
      ),
      onChanged: (_) => setState(() {}),
    );
  }

  Widget _buildConversionPreview() {
    return Padding(
      padding: const EdgeInsets.only(top: 8, left: 4),
      child: Row(
        children: [
          const Icon(Icons.swap_horiz, size: 16, color: Color(0xFF58A6FF)),
          const SizedBox(width: 6),
          Text(
            '≈ ${_selectedCorridor.to} ${_destAmount.toStringAsFixed(2)}',
            style: const TextStyle(fontSize: 13, color: Color(0xFF58A6FF)),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String hint) {
    return TextField(
      controller: controller,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.white38),
        filled: true,
        fillColor: const Color(0xFF161B22),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFF30363D)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFF30363D)),
        ),
      ),
    );
  }

  Widget _buildPurposeChips() {
    const purposes = ['FAMILY_SUPPORT', 'TRADE', 'EDUCATION', 'MEDICAL', 'INVESTMENT'];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: purposes.map((code) {
        final isSelected = _purposeCode == code;
        return GestureDetector(
          onTap: () => setState(() => _purposeCode = code),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: isSelected ? const Color(0xFF1A73E8).withAlpha(40) : const Color(0xFF161B22),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isSelected ? const Color(0xFF1A73E8) : const Color(0xFF30363D),
              ),
            ),
            child: Text(
              code.replaceAll('_', ' '),
              style: TextStyle(
                fontSize: 12,
                color: isSelected ? const Color(0xFF1A73E8) : Colors.white54,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildInfoBox() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF58A6FF).withAlpha(18),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF58A6FF).withAlpha(50)),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 16, color: Color(0xFF58A6FF)),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Transfers use Temporal workflows with 6-phase Mojaloop ILP saga: KYC → Compliance → FX Lock → Debit → ILP Route → Credit',
              style: TextStyle(fontSize: 12, color: Colors.white54, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSendButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _loading ? null : _handleSend,
        icon: _loading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : const Icon(Icons.send, size: 18),
        label: Text(_loading ? 'Initiating...' : 'Initiate Transfer'),
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF1A73E8),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  // ── History Tab ─────────────────────────────────────────────────────────────

  Widget _buildHistoryTab() {
    return RefreshIndicator(
      onRefresh: _onRefresh,
      color: const Color(0xFF1A73E8),
      child: _transfers.isEmpty
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.swap_horiz_outlined, size: 48, color: Colors.white24),
                  SizedBox(height: 12),
                  Text('No transfers yet', style: TextStyle(color: Colors.white38)),
                ],
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _transfers.length,
              itemBuilder: (context, index) => _buildTransferCard(_transfers[index]),
            ),
    );
  }

  Widget _buildTransferCard(CrossBorderTransfer transfer) {
    final statusColors = {
      'PENDING': Colors.orange,
      'IN_PROGRESS': const Color(0xFF58A6FF),
      'COMPLETED': const Color(0xFF3FB950),
      'FAILED': Colors.red,
    };
    final statusColor = statusColors[transfer.status] ?? Colors.grey;

    return GestureDetector(
      onTap: () => showDialog(
        context: context,
        builder: (_) => AlertDialog(
          backgroundColor: const Color(0xFF161B22),
          title: Text('Transfer ${transfer.id}',
              style: const TextStyle(color: Colors.white, fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Workflow: ${transfer.workflowId ?? "N/A"}',
                  style: const TextStyle(color: Colors.white70)),
              Text('Status: ${transfer.status}',
                  style: const TextStyle(color: Colors.white70)),
              Text('Step: ${transfer.currentStep}/${_transferSteps.length}',
                  style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 8),
              ..._transferSteps.asMap().entries.map((e) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        Icon(
                          e.key < transfer.currentStep
                              ? Icons.check_circle
                              : e.key == transfer.currentStep
                                  ? Icons.radio_button_checked
                                  : Icons.radio_button_unchecked,
                          size: 14,
                          color: e.key < transfer.currentStep
                              ? const Color(0xFF3FB950)
                              : e.key == transfer.currentStep
                                  ? const Color(0xFF1A73E8)
                                  : Colors.white24,
                        ),
                        const SizedBox(width: 6),
                        Text(e.value,
                            style: TextStyle(
                              fontSize: 12,
                              color: e.key < transfer.currentStep
                                  ? const Color(0xFF3FB950)
                                  : Colors.white54,
                            )),
                      ],
                    ),
                  )),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close', style: TextStyle(color: Color(0xFF1A73E8))),
            ),
          ],
        ),
      ),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF161B22),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFF30363D)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(transfer.id,
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                    Text(transfer.corridor,
                        style: const TextStyle(color: Colors.white54, fontSize: 11)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusColor.withAlpha(35),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: statusColor.withAlpha(70)),
                  ),
                  child: Text(
                    transfer.status,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Sent', style: TextStyle(fontSize: 11, color: Colors.white54)),
                    Text(
                      '${transfer.sourceCurrency} ${transfer.amount.toStringAsFixed(0)}',
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ],
                ),
                const Icon(Icons.arrow_forward, size: 16, color: Colors.white38),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Received', style: TextStyle(fontSize: 11, color: Colors.white54)),
                    Text(
                      '${transfer.destCurrency} ${transfer.destAmount.toStringAsFixed(2)}',
                      style: const TextStyle(
                          color: Color(0xFF3FB950), fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ],
                ),
              ],
            ),
            if (transfer.status == 'IN_PROGRESS') ...[
              const SizedBox(height: 10),
              _buildProgressBar(transfer.currentStep, _transferSteps.length),
            ],
            const SizedBox(height: 8),
            Text(
              transfer.createdAt.toLocal().toString().substring(0, 16),
              style: const TextStyle(fontSize: 11, color: Colors.white24),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressBar(int current, int total) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Step $current of $total: ${current < total ? _transferSteps[current] : "Complete"}',
          style: const TextStyle(fontSize: 11, color: Color(0xFF58A6FF)),
        ),
        const SizedBox(height: 4),
        LinearProgressIndicator(
          value: current / total,
          backgroundColor: const Color(0xFF30363D),
          valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF1A73E8)),
          borderRadius: BorderRadius.circular(4),
          minHeight: 4,
        ),
      ],
    );
  }
}
