/**
 * KYC Screen — NEXCOM Mobile
 * Guides the user through identity verification steps.
 */
import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../constants/config";
import { trpc } from "../../lib/trpc";

type KycStep = "intro" | "personal" | "document" | "submitted";

interface PersonalInfo {
  firstName: string; lastName: string; dateOfBirth: string;
  nationality: string; phone: string; address: string; email: string;
}

export default function KycScreen() {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<KycStep>("intro");
  const [info, setInfo] = useState<PersonalInfo>({
    firstName: "", lastName: "", dateOfBirth: "",
    nationality: "Nigerian", phone: "", address: "", email: "",
  });

  const statusQuery = trpc.onboarding.getStatus.useQuery();
  const submitMutation = trpc.onboarding.submit.useMutation({
    onSuccess: () => {
      utils.onboarding.getStatus.invalidate();
      setStep("submitted");
    },
    onError: (err) => Alert.alert("Submission Error", err.message),
  });

  const kycStatus = statusQuery.data?.kycStatus ?? "NOT_STARTED";

  const submit = () => {
    if (!info.firstName || !info.lastName || !info.phone || !info.email || !info.address) {
      Alert.alert("Missing Fields", "Please fill in all required fields.");
      return;
    }
    submitMutation.mutate({
      stakeholderType: "TRADER",
      personalInfo: {
        firstName: info.firstName,
        lastName: info.lastName,
        email: info.email,
        phone: info.phone,
        country: info.nationality,
        state: "Lagos",
        address: info.address,
      },
      businessInfo: {},
      stakeholderSpecific: {},
      agreedToTerms: true,
      agreedToKyc: true,
    });
  };

  // If already submitted/approved
  if (kycStatus === "PENDING" || kycStatus === "APPROVED" || step === "submitted") {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}>
          <Text style={s.bigIcon}>{kycStatus === "APPROVED" ? "✅" : "⏳"}</Text>
          <Text style={s.submittedTitle}>
            {kycStatus === "APPROVED" ? "KYC Approved" : "Application Submitted"}
          </Text>
          <Text style={s.submittedSub}>
            {kycStatus === "APPROVED"
              ? "Your identity has been verified. Full trading access is enabled."
              : "Your application is under review. This usually takes 1–2 business days."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === "intro") {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <Text style={s.title}>Identity Verification</Text>
          <Text style={s.subtitle}>
            Complete KYC to unlock full trading access on NEXCOM Exchange.
          </Text>
          <View style={s.stepList}>
            {[
              { icon: "👤", label: "Personal Information", desc: "Name, phone, address" },
              { icon: "📄", label: "Document Upload", desc: "NIN, BVN, or passport" },
              { icon: "✅", label: "Review & Submit", desc: "Confirm your details" },
            ].map((item, i) => (
              <View key={i} style={s.stepItem}>
                <Text style={s.stepIcon}>{item.icon}</Text>
                <View style={s.stepText}>
                  <Text style={s.stepLabel}>{item.label}</Text>
                  <Text style={s.stepDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>
          <TouchableOpacity style={s.btn} onPress={() => setStep("personal")}>
            <Text style={s.btnText}>Start Verification</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === "personal") {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <Text style={s.title}>Personal Information</Text>
          {[
            { label: "First Name *", key: "firstName", placeholder: "e.g. Amara" },
            { label: "Last Name *", key: "lastName", placeholder: "e.g. Okafor" },
            { label: "Email *", key: "email", placeholder: "e.g. amara@example.com" },
            { label: "Phone *", key: "phone", placeholder: "e.g. 08012345678" },
            { label: "Address *", key: "address", placeholder: "e.g. 12 Lagos Road, Abuja" },
            { label: "Nationality", key: "nationality", placeholder: "e.g. Nigerian" },
          ].map(({ label, key, placeholder }) => (
            <View key={key} style={s.field}>
              <Text style={s.fieldLabel}>{label}</Text>
              <TextInput
                style={s.input}
                value={(info as any)[key]}
                onChangeText={(v) => setInfo((prev) => ({ ...prev, [key]: v }))}
                placeholder={placeholder}
                placeholderTextColor={COLORS.textMuted}
                keyboardType={key === "phone" ? "phone-pad" : key === "email" ? "email-address" : "default"}
              />
            </View>
          ))}
          <TouchableOpacity style={s.btn} onPress={() => setStep("document")}>
            <Text style={s.btnText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // document step
  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <Text style={s.title}>Review & Submit</Text>
        <Text style={s.subtitle}>Please confirm your details before submitting.</Text>
        <View style={s.reviewCard}>
          {[
            ["Name", `${info.firstName} ${info.lastName}`],
            ["Email", info.email],
            ["Phone", info.phone],
            ["Address", info.address],
            ["Nationality", info.nationality],
          ].map(([label, value]) => (
            <View key={label} style={s.reviewRow}>
              <Text style={s.reviewLabel}>{label}</Text>
              <Text style={s.reviewValue}>{value || "—"}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          style={[s.btn, submitMutation.isPending && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.btnText}>Submit Application</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={s.backBtn} onPress={() => setStep("personal")}>
          <Text style={s.backBtnText}>← Edit Details</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  bigIcon: { fontSize: 64, marginBottom: 16 },
  submittedTitle: { fontSize: 24, fontWeight: "700", color: COLORS.text, textAlign: "center", marginBottom: 12 },
  submittedSub: { fontSize: 15, color: COLORS.textMuted, textAlign: "center", lineHeight: 22 },
  title: { fontSize: 24, fontWeight: "700", color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: COLORS.textMuted, marginBottom: 24, lineHeight: 22 },
  stepList: { gap: 12, marginBottom: 32 },
  stepItem: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  stepIcon: { fontSize: 28 },
  stepText: {},
  stepLabel: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  stepDesc: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 13, color: COLORS.text, fontSize: 15 },
  reviewCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between" },
  reviewLabel: { fontSize: 13, color: COLORS.textMuted, fontWeight: "600" },
  reviewValue: { fontSize: 13, color: COLORS.text, fontWeight: "500", flex: 1, textAlign: "right" },
  btn: { backgroundColor: COLORS.primary, borderRadius: 14, padding: 16, alignItems: "center", marginBottom: 12 },
  btnText: { color: "#000", fontSize: 16, fontWeight: "700" },
  backBtn: { alignItems: "center", padding: 12 },
  backBtnText: { color: COLORS.textMuted, fontSize: 14 },
});
