import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// TOTP Setup Screen — guides the user through enabling TOTP 2FA.
class TotpSetupScreen extends StatefulWidget {
  const TotpSetupScreen({super.key});

  @override
  State<TotpSetupScreen> createState() => _TotpSetupScreenState();
}

class _TotpSetupScreenState extends State<TotpSetupScreen> {
  // In production this secret is fetched from the server via tRPC
  static const _mockSecret = 'NEXCOM2FA2026ABCD';
  static const _mockOtpAuthUri =
      'otpauth://totp/NEXCOM%20Exchange?secret=NEXCOM2FA2026ABCD&issuer=NEXCOM';

  final _codeController = TextEditingController();
  bool _verified = false;
  bool _loading = false;
  int _step = 0; // 0=intro, 1=scan, 2=verify, 3=done

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final code = _codeController.text.trim();
    if (code.length != 6 || int.tryParse(code) == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the 6-digit code from your authenticator app.')),
      );
      return;
    }
    setState(() => _loading = true);
    await Future.delayed(const Duration(milliseconds: 800)); // simulate server call
    setState(() { _loading = false; _verified = true; _step = 3; });
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
      _step0Item(Icons.download_outlined, 'Install an authenticator app', 'e.g. Google Authenticator, Authy, or 1Password'),
      const SizedBox(height: 12),
      _step0Item(Icons.qr_code_scanner, 'Scan the QR code', 'We will show you a QR code to add your NEXCOM account'),
      const SizedBox(height: 12),
      _step0Item(Icons.verified_outlined, 'Confirm with a code', 'Enter the 6-digit code to complete setup'),
      const Spacer(),
      _primaryBtn('Get Started', () => setState(() => _step = 1)),
    ],
  );

  Widget _step0Item(IconData icon, String title, String sub) => Row(
    children: [
      Container(
        width: 40, height: 40,
        decoration: BoxDecoration(color: const Color(0xFF1f6feb).withOpacity(0.15), borderRadius: BorderRadius.circular(8)),
        child: Icon(icon, color: const Color(0xFF58a6ff), size: 20),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(color: Color(0xFFe6edf3), fontWeight: FontWeight.w600)),
          Text(sub, style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
        ],
      )),
    ],
  );

  Widget _buildScan() => Column(
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      const Text('Scan QR Code', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFFe6edf3))),
      const SizedBox(height: 8),
      const Text('Open your authenticator app and scan this QR code.', style: TextStyle(color: Color(0xFF8b949e), fontSize: 14), textAlign: TextAlign.center),
      const SizedBox(height: 32),
      // QR placeholder — in production use qr_flutter package
      Container(
        width: 200, height: 200,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
        child: const Center(child: Text('[ QR Code ]', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold))),
      ),
      const SizedBox(height: 24),
      const Text("Can't scan? Enter this code manually:", style: TextStyle(color: Color(0xFF8b949e), fontSize: 13)),
      const SizedBox(height: 8),
      GestureDetector(
        onTap: () {
          Clipboard.setData(const ClipboardData(text: _mockSecret));
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Secret copied to clipboard')));
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(color: const Color(0xFF161b22), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF30363d))),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: const [
              Text(_mockSecret, style: TextStyle(color: Color(0xFF58a6ff), fontFamily: 'monospace', fontSize: 15, letterSpacing: 2)),
              SizedBox(width: 8),
              Icon(Icons.copy, size: 16, color: Color(0xFF8b949e)),
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
      _primaryBtn(_loading ? '...' : 'Verify & Enable', _loading ? null : _verify),
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
      const Text('Your account is now protected with two-factor authentication. Keep your recovery codes in a safe place.', style: TextStyle(color: Color(0xFF8b949e), fontSize: 14, height: 1.6), textAlign: TextAlign.center),
      const SizedBox(height: 40),
      _primaryBtn('Done', () => Navigator.pop(context)),
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
