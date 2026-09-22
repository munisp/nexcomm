/**
 * NEXCOM Mobile — shared async screen state.
 * Uniform loading / error / empty handling with retry, replacing the
 * silent-empty-list pattern across screens.
 */
import React from "react";
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from "react-native";
import { COLORS, FONTS, SPACING } from "../constants/config";

interface ScreenStateProps {
  loading?: boolean;
  error?: { message: string } | null;
  /** When true (and not loading/error), render the empty state. */
  isEmpty?: boolean;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function ScreenState({
  loading,
  error,
  isEmpty,
  emptyIcon = "📭",
  emptyTitle = "Nothing here yet",
  emptyMessage,
  onRetry,
  children,
}: ScreenStateProps) {
  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.icon}>⚠️</Text>
        <Text style={s.errorTitle}>Something went wrong</Text>
        <Text style={s.message}>{error.message}</Text>
        {onRetry && (
          <TouchableOpacity style={s.retryBtn} onPress={onRetry}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  if (isEmpty) {
    return (
      <View style={s.center}>
        <Text style={s.icon}>{emptyIcon}</Text>
        <Text style={s.emptyTitle}>{emptyTitle}</Text>
        {emptyMessage ? <Text style={s.message}>{emptyMessage}</Text> : null}
        {onRetry && (
          <TouchableOpacity style={s.retryBtn} onPress={onRetry}>
            <Text style={s.retryText}>Refresh</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  return <>{children}</>;
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, minHeight: 200 },
  icon: { fontSize: 48, marginBottom: SPACING.md },
  errorTitle: { ...FONTS.heading, color: COLORS.error, fontSize: 17, marginBottom: 6, textAlign: "center" },
  emptyTitle: { ...FONTS.heading, color: COLORS.text, fontSize: 17, marginBottom: 6, textAlign: "center" },
  message: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13, textAlign: "center", marginBottom: SPACING.lg },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md },
  retryText: { ...FONTS.heading, color: "#000", fontSize: 14 },
});

export default ScreenState;
