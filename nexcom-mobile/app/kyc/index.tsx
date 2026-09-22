/**
 * KYC Screen — NEXCOM Mobile
 * Full onboarding: account type → personal info (incl. BVN/NIN + state) →
 * real document upload (expo-document-picker + base64 via uploadKycDocument)
 * → review → submit. Mirrors the portal Onboarding.tsx contract.
 */
import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal, FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
// SDK 52 (expo-file-system 18): the classic API is the main export —
// "expo-file-system/legacy" only exists on SDK 54+.
import * as FileSystem from "expo-file-system";
import { COLORS, FONTS, SPACING } from "../../constants/config";
import { trpc } from "../../lib/trpc";

type KycStep = "intro" | "personal" | "documents" | "review" | "submitted";
type AccountType = "INDIVIDUAL" | "COMPANY" | "COOPERATIVE";

// Portal mapping (client/src/pages/Register.tsx)
const ACCOUNT_TYPE_MAP: Record<AccountType, { stakeholderType: string; label: string; desc: string }> = {
  INDIVIDUAL: { stakeholderType: "TRADER", label: "Individual Trader", desc: "Personal commodity trading" },
  COMPANY: { stakeholderType: "TRADER", label: "Corporate Entity", desc: "Registered business trading" },
  COOPERATIVE: { stakeholderType: "FARMER", label: "Farmer Cooperative", desc: "Cooperatives & farmer groups" },
};

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT - Abuja","Gombe",
  "Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos",
  "Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto",
  "Taraba","Yobe","Zamfara",
];

interface DocSlot {
  key: string;
  type: string;
  label: string;
  required: boolean;
  url: string | null;
  uploading: boolean;
}

const initialDocs: DocSlot[] = [
  { key: "id_document", type: "ID_DOCUMENT", label: "Government-issued ID (NIN slip, passport, driver's license)", required: true, url: null, uploading: false },
  { key: "proof_of_address", type: "ADDRESS_PROOF", label: "Proof of Address (utility bill, ≤ 3 months)", required: true, url: null, uploading: false },
  { key: "bank_statement", type: "BANK_STATEMENT", label: "Bank Statement (optional)", required: false, url: null, uploading: false },
  { key: "cac_certificate", type: "CAC_CERTIFICATE", label: "CAC Certificate (companies only)", required: false, url: null, uploading: false },
];

export default function KycScreen() {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<KycStep>("intro");
  const [accountType, setAccountType] = useState<AccountType>("INDIVIDUAL");
  const [info, setInfo] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    address: "", state: "", bvn: "", nin: "",
  });
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [docs, setDocs] = useState<DocSlot[]>(initialDocs);

  const statusQuery = trpc.onboarding.getStatus.useQuery();
  const kycStatus = statusQuery.data?.kycStatus ?? "NOT_STARTED";

  const uploadMutation = trpc.onboarding.uploadKycDocument.useMutation();
  const submitMutation = trpc.onboarding.submit.useMutation({
    onSuccess: () => {
      utils.onboarding.getStatus.invalidate();
      setStep("submitted");
    },
    onError: (err: any) => Alert.alert("Submission Error", err.message),
  });

  // ── document pick + upload ────────────────────────────────────────────────
  async function pickAndUpload(slot: DocSlot) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 5 * 1024 * 1024) {
        Alert.alert("File Too Large", "Maximum file size is 5 MB.");
        return;
      }
      setDocs((prev) => prev.map((d) => (d.key === slot.key ? { ...d, uploading: true } : d)));
      const base64Data = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const res = await uploadMutation.mutateAsync({
        docId: slot.key,
        fileName: asset.name ?? `${slot.key}.pdf`,
        mimeType: asset.mimeType ?? "application/pdf",
        base64Data,
      });
      setDocs((prev) => prev.map((d) => (d.key === slot.key ? { ...d, uploading: false, url: res.url } : d)));
    } catch (e) {
      setDocs((prev) => prev.map((d) => (d.key === slot.key ? { ...d, uploading: false } : d)));
      Alert.alert("Upload Failed", (e as Error).message);
    }
  }

  // ── submit ────────────────────────────────────────────────────────────────
  const requiredDocsUploaded = docs.filter((d) => d.required).every((d) => d.url);

  function submit() {
    if (!info.firstName || !info.lastName || !info.phone || !info.email || !info.address || !info.state) {
      Alert.alert("Missing Fields", "Please fill in all required fields including state.");
      return;
    }
    if (!requiredDocsUploaded) {
      Alert.alert("Documents Required", "Please upload all required documents before submitting.");
      return;
    }
    submitMutation.mutate({
      stakeholderType: ACCOUNT_TYPE_MAP[accountType].stakeholderType,
      personalInfo: {
        firstName: info.firstName,
        lastName: info.lastName,
        email: info.email,
        phone: info.phone,
        country: "Nigeria",
        state: info.state,
        address: info.address,
        ...(info.bvn ? { bvn: info.bvn } : {}),
        ...(info.nin ? { nin: info.nin } : {}),
      },
      businessInfo: {},
      stakeholderSpecific: {},
      documentsUploaded: docs
        .filter((d) => d.url)
        .map((d) => ({ type: d.type, url: d.url as string, name: d.label })),
      agreedToTerms: true,
      agreedToKyc: true,
    });
  }

  // ── status gates ──────────────────────────────────────────────────────────
  if (statusQuery.isLoading) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }
  if (statusQuery.isError) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <Text style={s.bigIcon}>⚠️</Text>
        <Text style={s.errorTitle}>Could not load KYC status</Text>
        <Text style={s.subtitle}>{statusQuery.error.message}</Text>
        <TouchableOpacity style={s.btn} onPress={() => statusQuery.refetch()}>
          <Text style={s.btnText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }
  if (["UNDER_REVIEW", "SUBMITTED", "VERIFIED"].includes(kycStatus) || step === "submitted") {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <Text style={s.bigIcon}>✅</Text>
        <Text style={s.submittedTitle}>Application Submitted</Text>
        <Text style={s.subtitle}>
          Your KYC application is under review. You'll receive a notification once a decision is made (typically 1–2 business days).
        </Text>
      </SafeAreaView>
    );
  }

  // ── intro ─────────────────────────────────────────────────────────────────
  if (step === "intro") {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <Text style={s.title}>Verify Your Identity</Text>
          <Text style={s.subtitle}>
            NEXCOM is a regulated exchange. We need to verify your identity before you can trade.
          </Text>
          {[
            { icon: "🪪", label: "Personal Details", desc: "Name, phone, address, BVN/NIN" },
            { icon: "📄", label: "Document Upload", desc: "Government ID + proof of address" },
            { icon: "⏱️", label: "Review", desc: "1–2 business days" },
          ].map((item) => (
            <View key={item.label} style={s.introRow}>
              <Text style={s.introIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.introLabel}>{item.label}</Text>
                <Text style={s.introDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity style={s.btn} onPress={() => setStep("personal")}>
            <Text style={s.btnText}>Start Verification</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── personal info ─────────────────────────────────────────────────────────
  if (step === "personal") {
    const canContinue =
      !!info.firstName && !!info.lastName && !!info.email && !!info.phone && !!info.address && !!info.state;
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>Personal Details</Text>

          <Text style={s.fieldLabel}>Account Type *</Text>
          <View style={s.accountTypeRow}>
            {(Object.keys(ACCOUNT_TYPE_MAP) as AccountType[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.accountTypeChip, accountType === t && s.accountTypeChipActive]}
                onPress={() => setAccountType(t)}
              >
                <Text style={[s.accountTypeText, accountType === t && { color: "#fff" }]}>
                  {ACCOUNT_TYPE_MAP[t].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {([
            ["firstName", "First Name *", "default"],
            ["lastName", "Last Name *", "default"],
            ["email", "Email *", "email-address"],
            ["phone", "Phone *", "phone-pad"],
            ["address", "Residential Address *", "default"],
            ["bvn", "BVN (optional)", "number-pad"],
            ["nin", "NIN (optional)", "number-pad"],
          ] as const).map(([key, label, keyboard]) => (
            <View key={key}>
              <Text style={s.fieldLabel}>{label}</Text>
              <TextInput
                style={s.input}
                value={info[key]}
                onChangeText={(v) => setInfo((prev) => ({ ...prev, [key]: v }))}
                placeholder={label.replace(" *", "").replace(" (optional)", "")}
                placeholderTextColor={COLORS.textDim}
                keyboardType={keyboard}
                autoCapitalize={key === "email" ? "none" : "words"}
                maxLength={key === "bvn" || key === "nin" ? 11 : 200}
              />
            </View>
          ))}

          <Text style={s.fieldLabel}>State *</Text>
          <TouchableOpacity style={s.input} onPress={() => setStatePickerOpen(true)}>
            <Text style={{ color: info.state ? COLORS.text : COLORS.textDim, fontSize: 15 }}>
              {info.state || "Select state"}
            </Text>
          </TouchableOpacity>

          <Modal visible={statePickerOpen} transparent animationType="slide">
            <View style={s.pickerOverlay}>
              <View style={s.pickerSheet}>
                <Text style={s.pickerTitle}>Select State</Text>
                <FlatList
                  data={NIGERIAN_STATES}
                  keyExtractor={(item) => item}
                  windowSize={7}
                  maxToRenderPerBatch={8}
                  initialNumToRender={10}
                  updateCellsBatchingPeriod={50}
                  removeClippedSubviews
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={s.pickerRow}
                      onPress={() => {
                        setInfo((prev) => ({ ...prev, state: item }));
                        setStatePickerOpen(false);
                      }}
                    >
                      <Text style={s.pickerRowText}>{item}</Text>
                    </TouchableOpacity>
                  )}
                />
                <TouchableOpacity style={s.pickerClose} onPress={() => setStatePickerOpen(false)}>
                  <Text style={s.btnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          <TouchableOpacity
            style={[s.btn, !canContinue && { opacity: 0.5 }]}
            disabled={!canContinue}
            onPress={() => setStep("documents")}
          >
            <Text style={s.btnText}>Continue to Documents</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── documents ─────────────────────────────────────────────────────────────
  if (step === "documents") {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <Text style={s.title}>Upload Documents</Text>
          <Text style={s.subtitle}>PDF, JPG or PNG · max 5 MB per document.</Text>
          {docs.map((doc) => (
            <TouchableOpacity
              key={doc.key}
              style={[s.docCard, doc.url && s.docCardDone]}
              onPress={() => pickAndUpload(doc)}
              disabled={doc.uploading}
            >
              <Text style={s.docIcon}>{doc.uploading ? "⏳" : doc.url ? "✅" : "📤"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.docLabel}>
                  {doc.label}{doc.required ? " *" : ""}
                </Text>
                <Text style={s.docState}>
                  {doc.uploading ? "Uploading…" : doc.url ? "Uploaded — tap to replace" : "Tap to upload"}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[s.btn, !requiredDocsUploaded && { opacity: 0.5 }]}
            disabled={!requiredDocsUploaded}
            onPress={() => setStep("review")}
          >
            <Text style={s.btnText}>Review Application</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.backBtn} onPress={() => setStep("personal")}>
            <Text style={s.backBtnText}>← Edit Details</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── review ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <Text style={s.title}>Review & Submit</Text>
        <Text style={s.subtitle}>Please confirm your details before submitting.</Text>
        <View style={s.reviewCard}>
          {[
            ["Account Type", ACCOUNT_TYPE_MAP[accountType].label],
            ["Name", `${info.firstName} ${info.lastName}`],
            ["Email", info.email],
            ["Phone", info.phone],
            ["Address", info.address],
            ["State", info.state],
            ["BVN", info.bvn ? "•••••••" + info.bvn.slice(-4) : "—"],
            ["NIN", info.nin ? "•••••••" + info.nin.slice(-4) : "—"],
            ["Documents", `${docs.filter((d) => d.url).length} uploaded`],
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
        <TouchableOpacity style={s.backBtn} onPress={() => setStep("documents")}>
          <Text style={s.backBtnText}>← Edit Documents</Text>
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
  errorTitle: { fontSize: 18, fontWeight: "700", color: COLORS.error, textAlign: "center", marginBottom: 8 },
  title: { ...FONTS.heading, fontSize: 22, color: COLORS.text, marginBottom: 8 },
  subtitle: { ...FONTS.body, color: COLORS.textMuted, textAlign: "center", marginBottom: 20, lineHeight: 20 },
  introRow: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 12 },
  introIcon: { fontSize: 24, marginRight: 14 },
  introLabel: { ...FONTS.subheading, color: COLORS.text, fontSize: 15 },
  introDesc: { ...FONTS.body, color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  fieldLabel: { ...FONTS.body, color: COLORS.textMuted, fontSize: 12, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, padding: 14, color: COLORS.text, fontSize: 15, justifyContent: "center" },
  accountTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  accountTypeChip: { borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.surface },
  accountTypeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  accountTypeText: { ...FONTS.body, color: COLORS.textMuted, fontSize: 13 },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "70%", padding: 16 },
  pickerTitle: { ...FONTS.heading, color: COLORS.text, fontSize: 16, marginBottom: 12 },
  pickerRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  pickerRowText: { ...FONTS.body, color: COLORS.text, fontSize: 15 },
  pickerClose: { backgroundColor: COLORS.surfaceAlt, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 12 },
  docCard: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 12 },
  docCardDone: { borderColor: COLORS.primary },
  docIcon: { fontSize: 22, marginRight: 14 },
  docLabel: { ...FONTS.subheading, color: COLORS.text, fontSize: 14 },
  docState: { ...FONTS.body, color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  reviewCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 20 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  reviewLabel: { ...FONTS.body, color: COLORS.textMuted, fontSize: 14 },
  reviewValue: { ...FONTS.subheading, color: COLORS.text, fontSize: 14, maxWidth: "60%", textAlign: "right" },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 16 },
  btnText: { ...FONTS.heading, color: "#000", fontSize: 16 },
  backBtn: { alignItems: "center", marginTop: 12, padding: 8 },
  backBtnText: { ...FONTS.body, color: COLORS.textMuted, fontSize: 14 },
});
