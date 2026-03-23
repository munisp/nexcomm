import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _kycProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getKycStatus();
});

class KycScreen extends ConsumerWidget {
  const KycScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kycAsync = ref.watch(_kycProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('KYC Verification')),
      body: kycAsync.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList(count: 4)),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (kyc) {
          final status = kyc['status'] as String? ?? 'PENDING';
          final statusColor = status == 'APPROVED' ? NexcomTheme.positive : status == 'REJECTED' ? NexcomTheme.negative : NexcomTheme.accent;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: statusColor.withOpacity(0.3))),
              child: Row(children: [
                Icon(status == 'APPROVED' ? Icons.verified : status == 'REJECTED' ? Icons.cancel : Icons.pending, color: statusColor, size: 32),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('KYC Status: $status', style: TextStyle(color: statusColor, fontWeight: FontWeight.w700, fontSize: 16)),
                  Text(kyc['message'] as String? ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                ])),
              ]),
            ),
            const SizedBox(height: 24),
            if (status != 'APPROVED') ...[
              const Text('Required Documents', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              const SizedBox(height: 12),
              _DocItem('Government-issued ID', kyc['idVerified'] == true),
              _DocItem('Proof of Address', kyc['addressVerified'] == true),
              _DocItem('Business Registration', kyc['businessVerified'] == true),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: () {}, child: const Text('Submit Documents')),
            ],
          ]);
        },
      ),
    );
  }
}

class _DocItem extends StatelessWidget {
  final String label;
  final bool verified;
  const _DocItem(this.label, this.verified);
  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(verified ? Icons.check_circle : Icons.radio_button_unchecked, color: verified ? NexcomTheme.positive : const Color(0xFF6B7280)),
    title: Text(label),
    contentPadding: EdgeInsets.zero,
  );
}
