import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState<'INDIVIDUAL' | 'INSTITUTIONAL'>('INDIVIDUAL');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = () => {
    if (!email || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      router.replace('/tabs' as any);
    }, 1500);
  };

  const handleBiometric = () => {
    Alert.alert('Biometric Auth', 'Face ID / Fingerprint authentication would be triggered here in production.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoSection}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoIcon}>⚡</Text>
            </View>
            <Text style={styles.logoText}>NEXCOM</Text>
            <Text style={styles.logoSubtext}>Exchange</Text>
            <Text style={styles.tagline}>Africa's Premier Commodity Exchange</Text>
          </View>

          {/* Mode Toggle */}
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'login' && styles.modeBtnActive]}
              onPress={() => setMode('login')}
            >
              <Text style={[styles.modeBtnText, mode === 'login' && styles.modeBtnTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'register' && styles.modeBtnActive]}
              onPress={() => setMode('register')}
            >
              <Text style={[styles.modeBtnText, mode === 'register' && styles.modeBtnTextActive]}>
                Register
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {mode === 'register' && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Adebayo Okonkwo"
                    placeholderTextColor={COLORS.textDim}
                    autoCapitalize="words"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Phone Number</Text>
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+234 801 234 5678"
                    placeholderTextColor={COLORS.textDim}
                    keyboardType="phone-pad"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Account Type</Text>
                  <View style={styles.accountTypeRow}>
                    {(['INDIVIDUAL', 'INSTITUTIONAL'] as const).map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.accountTypeBtn,
                          accountType === type && styles.accountTypeBtnActive,
                        ]}
                        onPress={() => setAccountType(type)}
                      >
                        <Text style={styles.accountTypeIcon}>
                          {type === 'INDIVIDUAL' ? '👤' : '🏢'}
                        </Text>
                        <Text
                          style={[
                            styles.accountTypeText,
                            accountType === type && styles.accountTypeTextActive,
                          ]}
                        >
                          {type === 'INDIVIDUAL' ? 'Individual' : 'Institutional'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={COLORS.textDim}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                {mode === 'login' && (
                  <TouchableOpacity>
                    <Text style={styles.forgotLink}>Forgot?</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={COLORS.textDim}
                secureTextEntry
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isLoading}
            >
              <Text style={styles.submitBtnText}>
                {isLoading
                  ? 'Please wait...'
                  : mode === 'login'
                  ? 'Sign In to NEXCOM'
                  : 'Create Account'}
              </Text>
            </TouchableOpacity>

            {/* Biometric Login */}
            {mode === 'login' && (
              <TouchableOpacity style={styles.biometricBtn} onPress={handleBiometric}>
                <Text style={styles.biometricIcon}>🔒</Text>
                <Text style={styles.biometricText}>Sign in with Biometrics</Text>
              </TouchableOpacity>
            )}

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Demo Login */}
            <TouchableOpacity
              style={styles.demoBtn}
              onPress={() => router.replace('/tabs' as any)}
            >
              <Text style={styles.demoBtnText}>Continue with Demo Account</Text>
            </TouchableOpacity>
          </View>

          {/* Features */}
          <View style={styles.features}>
            {[
              { icon: '🔒', text: 'Bank-grade security & encryption' },
              { icon: '📊', text: 'Real-time commodity prices' },
              { icon: '🌍', text: 'Pan-African cross-border trading' },
              { icon: '🏭', text: 'Warehouse receipt financing' },
            ].map((feature) => (
              <View key={feature.text} style={styles.featureRow}>
                <Text style={styles.featureIcon}>{feature.icon}</Text>
                <Text style={styles.featureText}>{feature.text}</Text>
              </View>
            ))}
          </View>

          {/* Footer */}
          <Text style={styles.footer}>
            By continuing, you agree to NEXCOM's{' '}
            <Text style={styles.footerLink}>Terms of Service</Text> and{' '}
            <Text style={styles.footerLink}>Privacy Policy</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardView: { flex: 1 },
  scroll: { padding: 24, paddingTop: 40 },

  logoSection: { alignItems: 'center', marginBottom: 32 },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: `${COLORS.primary}20`,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoIcon: { fontSize: 36 },
  logoText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes['3xl'],
    fontWeight: '800',
    letterSpacing: 4,
  },
  logoSubtext: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '600',
    letterSpacing: 2,
    marginTop: -4,
  },
  tagline: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginTop: 8,
    textAlign: 'center',
  },

  modeToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: `${COLORS.primary}20` },
  modeBtnText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },
  modeBtnTextActive: { color: COLORS.primary },

  form: { marginBottom: 24 },
  field: { marginBottom: 16 },
  label: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  forgotLink: { color: COLORS.primary, fontSize: TYPOGRAPHY.sizes.sm },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    padding: 14,
  },

  accountTypeRow: { flexDirection: 'row', gap: 12 },
  accountTypeBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    gap: 6,
  },
  accountTypeBtnActive: {
    backgroundColor: `${COLORS.primary}20`,
    borderColor: COLORS.primary,
  },
  accountTypeIcon: { fontSize: 24 },
  accountTypeText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
  },
  accountTypeTextActive: { color: COLORS.primary },

  submitBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
  },

  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
    marginBottom: 16,
  },
  biometricIcon: { fontSize: 20 },
  biometricText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.textDim, fontSize: TYPOGRAPHY.sizes.sm },

  demoBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
    backgroundColor: `${COLORS.primary}10`,
    alignItems: 'center',
  },
  demoBtnText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
  },

  features: { marginBottom: 24, gap: 10 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIcon: { fontSize: 18 },
  featureText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
  },

  footer: {
    color: COLORS.textDim,
    fontSize: TYPOGRAPHY.sizes.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerLink: { color: COLORS.primary },
});
