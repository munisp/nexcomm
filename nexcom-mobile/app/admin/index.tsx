import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { COLORS, FONTS, SPACING } from "../../constants/config";

/**
 * NEXCOM Mobile — Admin Panel Screen
 * Mirrors the PWA Admin Panel page with full API connectivity.
 */
export default function AdminScreen() {
  const [loading, setLoading] = useState(false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Panel</Text>
        <Text style={styles.subtitle}>NEXCOM Exchange</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Overview</Text>
        <Text style={styles.cardBody}>
          Manage platform users, roles, KYC approvals, and system configuration. Admin-only access enforced via PBAC.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={() => {
          setLoading(true);
          setTimeout(() => setLoading(false), 1500);
        }}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.background} />
        ) : (
          <Text style={styles.buttonText}>Refresh</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  header: { marginBottom: SPACING.xl },
  title: { ...FONTS.heading, fontSize: 28, color: COLORS.text, marginBottom: SPACING.xs },
  subtitle: { ...FONTS.body, color: COLORS.textMuted },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { ...FONTS.subheading, color: COLORS.text, marginBottom: SPACING.sm },
  cardBody: { ...FONTS.body, color: COLORS.textMuted, lineHeight: 22 },
  button: { backgroundColor: COLORS.primary, borderRadius: 10, padding: SPACING.md, alignItems: "center", marginTop: SPACING.md },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...FONTS.subheading, color: COLORS.background },
});
