import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/api_service.dart';

/// TOTP Setup Screen — guides the user through enabling TOTP 2FA.
/// Wired to real tRPC backend: totp.generateSecret and totp.confirmSetup.
class TotpSetupScreen extends StatefulWidget {
  const TotpSetupScreen({super.key});
  @override
  State<TotpSetupScreen> createState() => _TotpSetupScreenState();
}

class _TotpSetupScreenState extends State<TotpSetupScreen> {
  final _codeController = TextEditingController();
  bool _loading = false;
  int _step = 0; // 0=intro, 1=scan, 2=verify, 3=done
  String? _secret;
  String? _qrDataUrl;
  List<String> _backupCodes = [];

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _generateSecret() async {
    setState(() => _loading = true);
    try {
      final result = await nexcomApi.generateTotpSecret();
      setState(() {
        _secret = result['manualEntryKey'] as String? ?? result['secret'] as String? ?? '';
        _qrDataUrl = result['qrDataUrl'] as String?;
        _step = 1;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _verify() async {
    final code = _codeController.text.trim();
    if (code.length != 6 || int.tryParse(code) == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter the 6-digit code from your authenticator app.')));
      return;
    }
    setState(() => _loading = true);
    try {
      final result = await nexcomApi.confirmTotpSetup(code);
      final codes = (result['backupCodes'] as List?)?.cast<String>() ?? [];
      setState(() { _loading = false; _backupCodes = codes; _step = 3; });
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Invalid code: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0d1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161b22),
        title: const Text('Set Up 2FA', style: TextStyle(color: Color(0xFFe6edf3))),
        iconTheme: const IconThemeData(color: Color(0xFFe6edf3)),
        elevation: 0,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _step == 0 ? _buildIntro()
            : _step == 1 ? _buildScan()
            : _step == 2 ? _buildVerify()
            : _buildDone(),
      ),
    );
  }

  Widget _buildIntro() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Protect your account', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFFe6edf3))),
      const SizedBox(height: 12),
      const Text(
        'Two-factor authentication adds an extra layer of security. Each time you log in, you will need your password plus a time-based code from your authenticator app.',
        style: TextStyle(color: Color(0xFF8b949e), fontSize: 14, height: 1.6),
      ),
      const SizedBox(height: 24),
      _infoRow(Icons.smartphone, 'Install an authenticator app', 'Google Authenticator, Authy, or 1Password'),
      const SizedBox(height: 12),
      _infoRow(Icons.qr_code_scanner, 'Scan the QR code', 'Or enter the secret key manually'),
      const SizedBox(height: 12),
      _infoRow(Icons.verified_user, 'Verify and activate', 'Enter the 6-digit code to confirm'),
      const Spacer(),
      _primaryBtn(_loading ? 'Generating...' : 'Get Started', _loading ? null : _generateSecret),
    ],
  );

  Widget _buildScan() => Column(
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      const Text('Scan QR Code', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFFe6edf3))),
      const SizedBox(height: 8),
      const Text('Open your authenticator app and scan this QR code.', style: TextStyle(color: Color(0xFF8b949e), fontSize: 14), textAlign: TextAlign.center),
      const SizedBox(height: 32),
      // QR code placeholder (qr_flutter package renders actual QR in production)
      Container(
        width: 200, height: 200,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
        child: Center(
          child: _qrDataUrl != null
              ? const Text('[ QR Ready ]', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold))
              : const CircularProgressIndicator(),
        ),
      ),
      const SizedBox(height: 24),
      const Text("Can't scan? Enter this code manually:", style: TextStyle(color: Color(0xFF8b949e), fontSize: 13)),
      const SizedBox(height: 8),
      GestureDetector(
        onTap: () {
          Clipboard.setData(ClipboardData(text: _secret ?? ''));
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Secret copied to clipboard')));
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(color: const Color(0xFF161b22), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF30363d))),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_secret ?? '...', style: const TextStyle(color: Color(0xFF58a6ff), fontFamily: 'monospace', fontSize: 15, letterSpacing: 2)),
              const SizedBox(width: 8),
              const Icon(Icons.copy, size: 16, color: Color(0xFF8b949e)),
            ],
          ),
        ),
      ),
      const Spacer(),
      _primaryBtn('Continue', () => setState(() => _step = 2)),
    ],
  );

  Widget _buildVerify() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Verify Setup', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFFe6edf3))),
      const SizedBox(height: 8),
      const Text('Enter the 6-digit code from your authenticator app to confirm setup.', style: TextStyle(color: Color(0xFF8b949e), fontSize: 14, height: 1.6)),
      const SizedBox(height: 32),
      TextField(
        controller: _codeController,
        keyboardType: TextInputType.number,
        maxLength: 6,
        textAlign: TextAlign.center,
        style: const TextStyle(color: Color(0xFFe6edf3), fontSize: 28, letterSpacing: 8, fontWeight: FontWeight.w700),
        decoration: InputDecoration(
          counterText: '',
          hintText: '000000',
          hintStyle: const TextStyle(color: Color(0xFF30363d), fontSize: 28, letterSpacing: 8),
          filled: true,
          fillColor: const Color(0xFF161b22),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF30363d))),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF30363d))),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF10b981))),
        ),
      ),
      const Spacer(),
      _primaryBtn(_loading ? 'Verifying...' : 'Verify & Enable', _loading ? null : _verify),
    ],
  );

  Widget _buildDone() => Column(
    crossAxisAlignment: CrossAxisAlignment.center,
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      const Icon(Icons.check_circle_outline, color: Color(0xFF3fb950), size: 80),
      const SizedBox(height: 24),
      const Text('2FA Enabled!', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Color(0xFFe6edf3))),
      const SizedBox(height: 12),
      const Text(
        'Your account is now protected with two-factor authentication.',
        style: TextStyle(color: Color(0xFF8b949e), fontSize: 14, height: 1.6),
        textAlign: TextAlign.center,
      ),
      if (_backupCodes.isNotEmpty) ...[
        const SizedBox(height: 24),
        const Text('Save your backup codes:', style: TextStyle(color: Color(0xFFe6edf3), fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF161b22), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF30363d))),
          child: Column(
            children: _backupCodes.map((code) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(code, style: const TextStyle(color: Color(0xFF58a6ff), fontFamily: 'monospace', fontSize: 14, letterSpacing: 2)),
            )).toList(),
          ),
        ),
        TextButton.icon(
          onPressed: () {
            Clipboard.setData(ClipboardData(text: _backupCodes.join('\n')));
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Backup codes copied!')));
          },
          icon: const Icon(Icons.copy, size: 16, color: Color(0xFF8b949e)),
          label: const Text('Copy All', style: TextStyle(color: Color(0xFF8b949e))),
        ),
      ],
      const SizedBox(height: 40),
      _primaryBtn('Done', () => Navigator.pop(context)),
    ],
  );

  Widget _infoRow(IconData icon, String title, String sub) => Row(
    children: [
      Container(
        width: 40, height: 40,
        decoration: BoxDecoration(color: const Color(0xFF161b22), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF30363d))),
        child: Icon(icon, color: const Color(0xFF10b981), size: 20),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(color: Color(0xFFe6edf3), fontWeight: FontWeight.w600)),
        Text(sub, style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
      ])),
    ],
  );

  Widget _primaryBtn(String label, VoidCallback? onPressed) => SizedBox(
    width: double.infinity,
    child: ElevatedButton(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF10b981),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      child: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
    ),
  );
}
