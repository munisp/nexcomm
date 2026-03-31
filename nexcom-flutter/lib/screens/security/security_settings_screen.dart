import 'package:flutter/material.dart';
import 'totp_setup_screen.dart';

/// Security Settings Screen for NEXCOM Flutter app.
/// Covers biometric auth toggle, PIN change, session revocation, and 2FA.
class SecuritySettingsScreen extends StatefulWidget {
  const SecuritySettingsScreen({super.key});

  @override
  State<SecuritySettingsScreen> createState() => _SecuritySettingsScreenState();
}

class _SecuritySettingsScreenState extends State<SecuritySettingsScreen> {
  bool _biometric = true;
  bool _loginAlerts = true;
  bool _tradeConfirm = true;
  bool _twoFaEnabled = false;

  void _revokeOtherSessions() {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF161b22),
        title: const Text('Revoke Sessions', style: TextStyle(color: Color(0xFFe6edf3))),
        content: const Text(
          'All other active sessions will be signed out immediately.',
          style: TextStyle(color: Color(0xFF8b949e)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e))),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('All other sessions revoked.')),
              );
            },
            child: const Text('Revoke All', style: TextStyle(color: Color(0xFFf85149))),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0d1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161b22),
        title: const Text('Security', style: TextStyle(color: Color(0xFFe6edf3))),
        iconTheme: const IconThemeData(color: Color(0xFFe6edf3)),
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _sectionHeader('Authentication'),
          _card([
            _switchTile(
              'Biometric Login',
              'Use Face ID or fingerprint to sign in',
              _biometric,
              (v) => setState(() => _biometric = v),
            ),
            _divider(),
            ListTile(
              title: const Text('Change PIN', style: TextStyle(color: Color(0xFFe6edf3))),
              subtitle: const Text('Update your 6-digit transaction PIN', style: TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
              trailing: const Icon(Icons.chevron_right, color: Color(0xFF8b949e)),
              onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('PIN change flow coming soon.')),
              ),
            ),
          ]),
          const SizedBox(height: 16),
          _sectionHeader('Two-Factor Authentication'),
          _card([
            _switchTile(
              'Authenticator App (TOTP)',
              _twoFaEnabled ? 'Enabled — tap to manage' : 'Not enabled',
              _twoFaEnabled,
              (v) {
                if (v) {
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const TotpSetupScreen())).then((_) {
                    setState(() => _twoFaEnabled = true);
                  });
                } else {
                  setState(() => _twoFaEnabled = false);
                }
              },
            ),
          ]),
          const SizedBox(height: 16),
          _sectionHeader('Alerts'),
          _card([
            _switchTile('Login Alerts', 'Notify me of new sign-ins', _loginAlerts, (v) => setState(() => _loginAlerts = v)),
            _divider(),
            _switchTile('Trade Confirmation', 'Require PIN before placing orders', _tradeConfirm, (v) => setState(() => _tradeConfirm = v)),
          ]),
          const SizedBox(height: 16),
          _sectionHeader('Sessions'),
          _card([
            ListTile(
              title: const Text('Revoke All Other Sessions', style: TextStyle(color: Color(0xFFf85149))),
              subtitle: const Text('Sign out from all other devices', style: TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
              trailing: const Icon(Icons.chevron_right, color: Color(0xFFf85149)),
              onTap: _revokeOtherSessions,
            ),
          ]),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title) => Padding(
    padding: const EdgeInsets.only(bottom: 8, left: 4),
    child: Text(title.toUpperCase(),
      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF8b949e), letterSpacing: 1)),
  );

  Widget _card(List<Widget> children) => Container(
    decoration: BoxDecoration(
      color: const Color(0xFF161b22),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xFF30363d)),
    ),
    child: Column(children: children),
  );

  Widget _switchTile(String title, String sub, bool value, ValueChanged<bool> onChanged) => SwitchListTile(
    title: Text(title, style: const TextStyle(color: Color(0xFFe6edf3), fontSize: 15)),
    subtitle: Text(sub, style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
    value: value,
    onChanged: onChanged,
    activeColor: const Color(0xFF10b981),
  );

  Widget _divider() => const Divider(height: 1, color: Color(0xFF21262d), indent: 16, endIndent: 16);
}
