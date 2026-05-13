/**
 * NEXCOM Mobile — Farmer Detail Screen
 * Shows a specific farmer's profile and crop listings.
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

export default function FarmerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmerQ = trpc.farmer.getFarmerById.useQuery({ farmerId: Number(id) });
  const cropsQ = trpc.farmer.publicListCropListings.useQuery({ farmerId: Number(id) });

  const farmer = farmerQ.data as any;
  const crops: any[] = (cropsQ.data as any) ?? [];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {farmerQ.isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : farmerQ.error ? (
          <Text style={s.error}>Farmer not found</Text>
        ) : (
          <>
            <View style={s.header}>
              <Text style={s.title}>{farmer?.fullName ?? "Farmer"}</Text>
              <Text style={s.subtitle}>{farmer?.state ?? ""} {farmer?.country ?? ""}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Profile</Text>
              {[
                ["Farm Size", farmer?.totalFarmSizeHa ? `${farmer.totalFarmSizeHa} ha` : null],
                ["Primary Crop", farmer?.primaryCrop],
                ["Cooperative", farmer?.cooperativeName],
                ["Phone", farmer?.phone],
                ["Verified", farmer?.isVerified ? "Yes" : "No"],
              ].map(([label, value]) => (
                <View key={label} style={s.row}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={s.value}>{value ?? "—"}</Text>
                </View>
              ))}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Crop Listings ({crops.length})</Text>
              {cropsQ.isLoading ? <ActivityIndicator color={COLORS.primary} /> : crops.map((c: any) => (
                <View key={c.id} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.symbol}>{c.commodityCode}</Text>
                    <Text style={s.muted}>{Number(c.quantityMt).toLocaleString()} MT · {c.grade}</Text>
                  </View>
                  <Text style={s.price}>₦{Number(c.pricePerMtNgn).toLocaleString()}/MT</Text>
                </View>
              ))}
              {crops.length === 0 && !cropsQ.isLoading && <Text style={s.muted}>No listings</Text>}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { ...FONTS.heading, fontSize: 24, color: COLORS.text },
  subtitle: { ...FONTS.body, color: COLORS.textMuted, marginTop: 2 },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.lg, marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { ...FONTS.subheading, fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  label: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  value: { ...FONTS.subheading, color: COLORS.text, fontSize: 13 },
  symbol: { ...FONTS.subheading, color: COLORS.text, fontSize: 14 },
  muted: { ...FONTS.body, color: COLORS.textMuted, fontSize: 12 },
  price: { ...FONTS.mono, color: COLORS.primary, fontSize: 13 },
  error: { ...FONTS.body, color: COLORS.error, margin: SPACING.lg },
});
