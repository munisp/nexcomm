import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _kycProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getKycStatus();
});

/// A KYC document slot the user can fill by picking + uploading a real file.
class _DocSpec {
  final String label;
  final String docId; // server docId (see server onboarding.uploadKycDocument)
  final bool required;
  const _DocSpec(this.label, this.docId, {this.required = false});
}

const _docSpecs = [
  _DocSpec('Government-issued ID', 'id_document', required: true),
  _DocSpec('Proof of Address', 'proof_of_address', required: true),
  _DocSpec('Business Registration', 'cac_certificate'),
];

class KycScreen extends ConsumerStatefulWidget {
  const KycScreen({super.key});

  @override
  ConsumerState<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends ConsumerState<KycScreen> {
  /// docId → uploaded document URL (returned by the server)
  final Map<String, String> _uploadedUrls = {};
  final Set<String> _uploading = {};
  bool _submitting = false;

  String _mimeTypeFor(String fileName) {
    final ext = fileName.split('.').last.toLowerCase();
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'jpg':
      case 'jpeg':
      default:
        return 'image/jpeg';
    }
  }

  Future<void> _pickAndUpload(_DocSpec spec) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
      withData: true,
    );
    final file = result?.files.first;
    if (file == null || file.bytes == null) return;
    if (file.size > 5 * 1024 * 1024) {
      _toast('File exceeds the 5 MB limit.', error: true);
      return;
    }
    setState(() => _uploading.add(spec.docId));
    try {
      final res = await nexcomApi.uploadKycDocument(
        docId: spec.docId,
        fileName: file.name,
        mimeType: _mimeTypeFor(file.name),
        base64Data: base64Encode(file.bytes!),
      );
      setState(() => _uploadedUrls[spec.docId] = res['url'] as String);
      _toast('${spec.label} uploaded');
    } catch (e) {
      _toast('Upload failed: $e', error: true);
    } finally {
      setState(() => _uploading.remove(spec.docId));
    }
  }

  bool get _requiredDocsUploaded =>
      _docSpecs.where((d) => d.required).every((d) => _uploadedUrls.containsKey(d.docId));

  Future<void> _submit(Map<String, dynamic> kyc) async {
    if (!_requiredDocsUploaded) {
      _toast('Please upload all required documents first.', error: true);
      return;
    }
    final profile = kyc['profile'] as Map<String, dynamic>?;
    if (profile == null) {
      // Honest error — onboarding personal info must exist before submitting.
      _toast(
        'No onboarding profile found. Please complete onboarding on the portal first.',
        error: true,
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final documentsUploaded = _uploadedUrls.entries
          .map((e) => {
                'type': e.key.toUpperCase(),
                'url': e.value,
                'name': _docSpecs.firstWhere((d) => d.docId == e.key).label,
              })
          .toList();
      await nexcomApi.submitKycApplication({
        'stakeholderType': profile['stakeholderType'] ?? 'TRADER',
        'personalInfo': {
          'firstName': profile['firstName'] ?? '',
          'lastName': profile['lastName'] ?? '',
          'email': profile['email'] ?? '',
          'phone': profile['phone'] ?? '',
          'country': profile['country'] ?? 'Nigeria',
          'state': profile['state'] ?? '',
          'address': profile['address'] ?? '',
          if (profile['bvn'] != null) 'bvn': profile['bvn'],
          if (profile['nin'] != null) 'nin': profile['nin'],
        },
        'stakeholderSpecific': <String, dynamic>{},
        'documentsUploaded': documentsUploaded,
        'agreedToTerms': true,
        'agreedToKyc': true,
      });
      _toast('KYC application submitted for review');
      ref.invalidate(_kycProvider);
    } catch (e) {
      _toast('Submission failed: $e', error: true);
    } finally {
      setState(() => _submitting = false);
    }
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? NexcomTheme.negative : NexcomTheme.positive,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final kycAsync = ref.watch(_kycProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('KYC Verification')),
      body: kycAsync.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList(count: 4)),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (kyc) {
          final status = kyc['kycStatus'] as String? ?? kyc['status'] as String? ?? 'PENDING';
          final statusColor = status == 'APPROVED' || status == 'VERIFIED'
              ? NexcomTheme.positive
              : status == 'REJECTED'
                  ? NexcomTheme.negative
                  : NexcomTheme.accent;
          final isApproved = status == 'APPROVED' || status == 'VERIFIED';
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: statusColor.withOpacity(0.3))),
              child: Row(children: [
                Icon(isApproved ? Icons.verified : status == 'REJECTED' ? Icons.cancel : Icons.pending, color: statusColor, size: 32),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('KYC Status: $status', style: TextStyle(color: statusColor, fontWeight: FontWeight.w700, fontSize: 16)),
                  Text(kyc['message'] as String? ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                ])),
              ]),
            ),
            const SizedBox(height: 24),
            if (!isApproved) ...[
              const Text('Required Documents', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              const SizedBox(height: 4),
              const Text('Tap a document to upload (PDF, JPG, PNG — max 5 MB).',
                  style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
              const SizedBox(height: 12),
              for (final spec in _docSpecs)
                _DocItem(
                  spec.label,
                  _uploadedUrls.containsKey(spec.docId),
                  uploading: _uploading.contains(spec.docId),
                  required: spec.required,
                  onTap: () => _pickAndUpload(spec),
                ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: _submitting ? null : () => _submit(kyc),
                child: Text(_submitting ? 'Submitting…' : 'Submit Documents'),
              ),
            ],
          ]);
        },
      ),
    );
  }
}

class _DocItem extends StatelessWidget {
  final String label;
  final bool uploaded;
  final bool uploading;
  final bool required;
  final VoidCallback? onTap;
  const _DocItem(this.label, this.uploaded, {this.uploading = false, this.required = false, this.onTap});
  @override
  Widget build(BuildContext context) => ListTile(
    onTap: uploading ? null : onTap,
    leading: uploading
        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
        : Icon(uploaded ? Icons.check_circle : Icons.upload_file, color: uploaded ? NexcomTheme.positive : const Color(0xFF6B7280)),
    title: Text(label + (required ? ' *' : '')),
    subtitle: Text(uploaded ? 'Uploaded' : 'Tap to upload', style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
    contentPadding: EdgeInsets.zero,
  );
}
