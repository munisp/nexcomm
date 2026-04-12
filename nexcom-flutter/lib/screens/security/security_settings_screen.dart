import 'package:flutter/material.dart';
import 'totp_setup_screen.dart';
import '../../services/api_service.dart';

/// Security Settings Screen for NEXCOM Flutter app.
/// Covers biometric auth toggle, PIN change, session revocation, and 2FA.
/// All session and TOTP operations are wired to the real tRPC backend.
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
  bool _loadingTotp = true;
  bool _loadingSessions = true;
  bool _revokingAll = false;
  List<dynamic> _sessions = [];

  @override
  void initState() {
    super.initState();
    _loadTotpStatus();
    _loadSessions();
  }

  Future<void> _loadTotpStatus() async {
    try {
      final result = await nexcomApi.getTotpStatus();
      if (mounted) setState(() { _twoFaEnabled = result['isEnabled'] as bool? ?? false; _loadingTotp = false; });
    } catch (_) {
      if (mounted) setState(() => _loadingTotp = false);
    }
  }

  Future<void> _loadSessions() async {
    try {
      final sessions = await nexcomApi.getDeviceSessions();
      if (mounted) setState(() { _sessions = sessions; _loadingSessions = false; });
    } catch (_) {
      if (mounted) setState(() => _loadingSessions = false);
    }
  }

  Future<void> _revokeOtherSessions() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF161b22),
        title: const Text('Revoke Sessions', style: TextStyle(color: Color(0xFFe6edf3))),
        content: const Text('All other active sessions will be signed out immediately.', style: TextStyle(color: Color(0xFF8b949e))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e)))),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Revoke All', style: TextStyle(color: Color(0xFFf85149)))),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _revokingAll = true);
    try {
      await nexcomApi.revokeAllOtherSessions();
      await _loadSessions();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('All other sessions revoked.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    } finally {
      if (mounted) setState(() => _revokingAll = false);
    }
  }

  Future<void> _revokeSession(String deviceId) async {
    try {
      await nexcomApi.revokeDeviceSession(deviceId);
      await _loadSessions();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Session revoked.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  void _showDisableTotpDialog() {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF161b22),
        title: const Text('Disable 2FA', style: TextStyle(color: Color(0xFFe6edf3))),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Enter your current TOTP code to disable 2FA.', style: TextStyle(color: Color(0xFF8b949e), fontSize: 13)),
          const SizedBox(height: 16),
          TextField(
            controller: controller, keyboardType: TextInputType.number, maxLength: 6, textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFe6edf3), fontSize: 24, letterSpacing: 6),
            decoration: const InputDecoration(counterText: '', hintText: '000000', hintStyle: TextStyle(color: Color(0xFF30363d)), filled: true, fillColor: Color(0xFF0d1117), border: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF30363d)))),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e)))),
          TextButton(
            onPressed: () async {
              Navigator.pop(context);
              try {
                await nexcomApi.disableTotp(controller.text.trim());
                await _loadTotpStatus();
                if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('2FA disabled.')));
              } catch (e) {
                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
              }
            },
            child: const Text('Disable', style: TextStyle(color: Color(0xFFf85149))),
          ),
        ],
      ),
    );
  }

  String _formatDate(dynamic ts) {
    if (ts == null) return 'Unknown';
    try { return DateTime.fromMillisecondsSinceEpoch(ts is int ? ts : int.parse(ts.toString())).toLocal().toString().substring(0, 16); }
    catch (_) { return ts.toString().length > 10 ? ts.toString().substring(0, 10) : ts.toString(); }
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
            _switchTile('Biometric Login', 'Use Face ID or fingerprint to sign in', _biometric, (v) => setState(() => _biometric = v)),
            _divider(),
            ListTile(
              title: const Text('Change PIN', style: TextStyle(color: Color(0xFFe6edf3))),
              subtitle: const Text('Update your 6-digit transaction PIN', style: TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
              trailing: const Icon(Icons.chevron_right, color: Color(0xFF8b949e)),
              onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('PIN change flow — coming soon.'))),
            ),
          ]),
          const SizedBox(height: 16),
          _sectionHeader('Two-Factor Authentication'),
          _card([
            _loadingTotp
                ? const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator(color: Color(0xFF10b981))))
                : _switchTile(
                    'Authenticator App (TOTP)',
                    _twoFaEnabled ? 'Enabled — tap to manage' : 'Not enabled',
                    _twoFaEnabled,
                    (v) {
                      if (v) {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const TotpSetupScreen())).then((_) => _loadTotpStatus());
                      } else {
                        _showDisableTotpDialog();
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
              title: Text(_revokingAll ? 'Revoking...' : 'Revoke All Other Sessions',
                  style: TextStyle(color: _revokingAll ? const Color(0xFF8b949e) : const Color(0xFFf85149))),
              subtitle: const Text('Sign out from all other devices', style: TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
              trailing: _revokingAll
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFf85149)))
                  : const Icon(Icons.chevron_right, color: Color(0xFFf85149)),
              onTap: _revokingAll ? null : _revokeOtherSessions,
            ),
          ]),
          if (_loadingSessions)
            const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator(color: Color(0xFF10b981))))
          else if (_sessions.isNotEmpty) ...[
            const SizedBox(height: 8),
            ..._sessions.map((session) {
              final isCurrent = session['isCurrent'] as bool? ?? false;
              final deviceId = session['deviceId']?.toString() ?? '';
              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(color: const Color(0xFF161b22), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF30363d))),
                child: ListTile(
                  title: Text(session['deviceName']?.toString() ?? 'Unknown Device', style: const TextStyle(color: Color(0xFFe6edf3), fontSize: 14)),
                  subtitle: Text('${session['platform'] ?? 'Unknown'} · Last seen ${_formatDate(session['lastSeenAt'] ?? session['createdAt'])}', style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
                  trailing: isCurrent
                      ? Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(color: const Color(0x2010b981), borderRadius: BorderRadius.circular(6)),
                          child: const Text('Current', style: TextStyle(color: Color(0xFF10b981), fontSize: 11)),
                        )
                      : TextButton(
                          onPressed: () => _revokeSession(deviceId),
                          style: TextButton.styleFrom(foregroundColor: const Color(0xFFf85149)),
                          child: const Text('Revoke', style: TextStyle(fontSize: 13)),
                        ),
                ),
              );
            }),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title) => Padding(
    padding: const EdgeInsets.only(bottom: 8, left: 4),
    child: Text(title.toUpperCase(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF8b949e), letterSpacing: 1)),
  );
  Widget _card(List<Widget> children) => Container(
    decoration: BoxDecoration(color: const Color(0xFF161b22), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF30363d))),
    child: Column(children: children),
  );
  Widget _switchTile(String title, String sub, bool value, ValueChanged<bool> onChanged) => SwitchListTile(
    title: Text(title, style: const TextStyle(color: Color(0xFFe6edf3), fontSize: 15)),
    subtitle: Text(sub, style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12)),
    value: value, onChanged: onChanged, activeColor: const Color(0xFF10b981),
  );
  Widget _divider() => const Divider(height: 1, color: Color(0xFF21262d), indent: 16, endIndent: 16);
}
