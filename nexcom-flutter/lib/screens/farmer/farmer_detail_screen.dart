import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _farmerProvider = FutureProvider.family.autoDispose<Map<String, dynamic>, String>((ref, id) async {
  return nexcomApi.getFarmer(id);
});

class FarmerDetailScreen extends ConsumerWidget {
  final String farmerId;
  const FarmerDetailScreen({super.key, required this.farmerId});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final farmerAsync = ref.watch(_farmerProvider(farmerId));
    return Scaffold(
      appBar: AppBar(title: const Text('Farmer Profile')),
      body: farmerAsync.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList(count: 6)),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (f) => ListView(padding: const EdgeInsets.all(16), children: [
          Center(child: CircleAvatar(radius: 36, backgroundColor: NexcomTheme.primary.withOpacity(0.2), child: Text((f['name'] as String? ?? 'F').substring(0, 1), style: const TextStyle(fontSize: 28, color: NexcomTheme.primary, fontWeight: FontWeight.w700)))),
          const SizedBox(height: 12),
          Center(child: Text(f['name'] as String? ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600))),
          const SizedBox(height: 24),
          _Row('Phone', f['phone'] as String? ?? 'N/A'),
          _Row('Location', f['location'] as String? ?? 'N/A'),
          _Row('Farm Size', '${f['farmSize'] ?? 'N/A'} hectares'),
          _Row('Primary Crop', f['primaryCrop'] as String? ?? 'N/A'),
          _Row('KYC Status', f['kycStatus'] as String? ?? 'PENDING'),
          _Row('Registered', f['createdAt'] as String? ?? 'N/A'),
        ]),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  const _Row(this.label, this.value);
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(children: [
      SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Color(0xFF9CA3AF)))),
      Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
    ]),
  );
}
