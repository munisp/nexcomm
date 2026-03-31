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

type KycStep = "intro" | "personal" | "document" | "selfie" | "submitted";

interface PersonalInfo {
  firstName: string; lastName: string; dateOfBirth: string;
  nationality: string; phone: string; address: string;
}

export default function KycScreen() {
  const [step, setStep] = useState<KycStep>("intro");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<PersonalInfo>({
    firstName: "", lastName: "", dateOfBirth: "",
    nationality: "Nigerian", phone: "", address: "",
  });

  const submit = async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1500)); // simulate upload
      setStep("submitted");
    } catch {
      Alert.alert("Error", "Submission failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <Text style={s.title}>Identity Verification</Text>
          <Text style={s.sub}>Complete KYC to unlock full trading access</Text>
        </View>

        {/* Progress */}
        <View style={s.progress}>
          {(["intro", "personal", "document", "selfie"] as KycStep[]).map((st, i) => (
            <View key={st} style={[s.dot, step === st ? s.dotActive : (["personal","document","selfie","submitted"].indexOf(step) > i ? s.dotDone : {})]}>
              <Text style={s.dotText}>{i + 1}</Text>
            </View>
          ))}
        </View>

        {step === "intro" && (
          <View style={s.card}>
            <Text style={s.cardTitle}>What you will need</Text>
            {["Government-issued ID (NIN, Passport, or Driver's Licence)", "A clear selfie photo", "Proof of address (utility bill or bank statement)"].map((item) => (
              <View key={item} style={s.listItem}>
                <Text style={s.bullet}>•</Text>
                <Text style={s.listText}>{item}</Text>
              </View>
            ))}
            <TouchableOpacity style={s.btn} onPress={() => setStep("personal")}>
              <Text style={s.btnText}>Start Verification</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "personal" && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Personal Information</Text>
            {(["firstName", "lastName", "dateOfBirth", "nationality", "phone", "address"] as (keyof PersonalInfo)[]).map((field) => (
              <View key={field} style={s.fieldGroup}>
                <Text style={s.label}>{field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</Text>
                <TextInput
                  style={s.input}
                  value={info[field]}
                  onChangeText={(v) => setInfo((p) => ({ ...p, [field]: v }))}
                  placeholder={field === "dateOfBirth" ? "YYYY-MM-DD" : ""}
                  placeholderTextColor={COLORS.textDim}
                  keyboardType={field === "phone" ? "phone-pad" : "default"}
                />
              </View>
            ))}
            <TouchableOpacity style={s.btn} onPress={() => {
              if (!info.firstName || !info.lastName || !info.phone) {
                Alert.alert("Required", "Please fill in all required fields.");
                return;
              }
              setStep("document");
            }}>
              <Text style={s.btnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "document" && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Upload ID Document</Text>
            <Text style={s.bodyText}>Select your document type and upload a clear photo of both sides.</Text>
            {["National ID (NIN)", "International Passport", "Driver's Licence"].map((doc) => (
              <TouchableOpacity key={doc} style={s.docOption} onPress={() => setStep("selfie")}>
                <Text style={s.docText}>{doc}</Text>
                <Text style={{ color: COLORS.textMuted }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {step === "selfie" && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Take a Selfie</Text>
            <Text style={s.bodyText}>Position your face clearly in the frame. Ensure good lighting and no glasses.</Text>
            <View style={s.selfieBox}>
              <Text style={{ fontSize: 48 }}>📷</Text>
              <Text style={{ color: COLORS.textMuted, marginTop: 8 }}>Camera access required</Text>
            </View>
            <TouchableOpacity style={s.btn} onPress={submit} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Submit for Review</Text>}
            </TouchableOpacity>
          </View>
        )}

        {step === "submitted" && (
          <View style={[s.card, { alignItems: "center" }]}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>✅</Text>
            <Text style={s.cardTitle}>Submitted!</Text>
            <Text style={[s.bodyText, { textAlign: "center" }]}>Your documents are under review. You will be notified within 1–2 business days.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d1117" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#e6edf3" },
  sub: { fontSize: 14, color: "#8b949e", marginTop: 4 },
  progress: { flexDirection: "row", justifyContent: "center", gap: 12, paddingVertical: 16 },
  dot: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#21262d", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#30363d" },
  dotActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dotDone: { backgroundColor: "#1f6feb", borderColor: "#1f6feb" },
  dotText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  card: { margin: 16, padding: 20, backgroundColor: "#161b22", borderRadius: 12, borderWidth: 1, borderColor: "#30363d" },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#e6edf3", marginBottom: 12 },
  bodyText: { fontSize: 14, color: "#8b949e", lineHeight: 20, marginBottom: 16 },
  listItem: { flexDirection: "row", marginBottom: 8 },
  bullet: { color: COLORS.primary, marginRight: 8, fontSize: 16 },
  listText: { flex: 1, color: "#8b949e", fontSize: 14 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 13, color: "#8b949e", marginBottom: 4 },
  input: { backgroundColor: "#0d1117", borderWidth: 1, borderColor: "#30363d", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#e6edf3", fontSize: 15 },
  docOption: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#21262d" },
  docText: { fontSize: 15, color: "#e6edf3" },
  selfieBox: { height: 200, backgroundColor: "#0d1117", borderRadius: 12, borderWidth: 2, borderColor: "#30363d", borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginBottom: 16 },
});
