import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

// ── Constants ──────────────────────────────────────────────────────────────────

const COLORS = {
  primary: "#1A73E8",
  secondary: "#34A853",
  accent: "#FBBC04",
  danger: "#EA4335",
  background: "#0D1117",
  surface: "#161B22",
  surfaceAlt: "#21262D",
  border: "#30363D",
  text: "#E6EDF3",
  textMuted: "#8B949E",
  textDim: "#6E7681",
  success: "#3FB950",
  warning: "#D29922",
  info: "#58A6FF",
};

const SUPPORTED_CORRIDORS = [
  { from: "NGN", to: "USD", name: "Nigeria → USA", flag: "🇳🇬→🇺🇸", rate: 0.00063 },
  { from: "KES", to: "USD", name: "Kenya → USA", flag: "🇰🇪→🇺🇸", rate: 0.00776 },
  { from: "GHS", to: "USD", name: "Ghana → USA", flag: "🇬🇭→🇺🇸", rate: 0.0667 },
  { from: "ZAR", to: "USD", name: "South Africa → USA", flag: "🇿🇦→🇺🇸", rate: 0.0547 },
  { from: "ETB", to: "USD", name: "Ethiopia → USA", flag: "🇪🇹→🇺🇸", rate: 0.0175 },
  { from: "TZS", to: "USD", name: "Tanzania → USA", flag: "🇹🇿→🇺🇸", rate: 0.000385 },
  { from: "UGX", to: "USD", name: "Uganda → USA", flag: "🇺🇬→🇺🇸", rate: 0.000268 },
  { from: "XOF", to: "EUR", name: "WAEMU → Europe", flag: "🌍→🇪🇺", rate: 0.00152 },
];

const TRANSFER_STEPS = [
  "KYC Validation",
  "Compliance Check",
  "FX Rate Lock",
  "Debit Source",
  "ILP Routing",
  "Credit Destination",
];

interface Transfer {
  id: string;
  corridor: string;
  amount: number;
  sourceCurrency: string;
  destCurrency: string;
  destAmount: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  currentStep: number;
  createdAt: string;
  workflowId?: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_TRANSFERS: Transfer[] = [
  {
    id: "TXN-001",
    corridor: "Nigeria → USA",
    amount: 500000,
    sourceCurrency: "NGN",
    destCurrency: "USD",
    destAmount: 315.0,
    status: "COMPLETED",
    currentStep: 6,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    workflowId: "wf-abc123",
  },
  {
    id: "TXN-002",
    corridor: "Kenya → USA",
    amount: 50000,
    sourceCurrency: "KES",
    destCurrency: "USD",
    destAmount: 388.0,
    status: "IN_PROGRESS",
    currentStep: 3,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    workflowId: "wf-def456",
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: Transfer["status"] }) => {
  const config = {
    PENDING: { color: COLORS.warning, label: "Pending" },
    IN_PROGRESS: { color: COLORS.info, label: "In Progress" },
    COMPLETED: { color: COLORS.success, label: "Completed" },
    FAILED: { color: COLORS.danger, label: "Failed" },
  }[status];

  return (
    <View style={[styles.badge, { backgroundColor: config.color + "22", borderColor: config.color + "44" }]}>
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
};

const ProgressSteps = ({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) => (
  <View style={styles.progressContainer}>
    {TRANSFER_STEPS.map((step, idx) => (
      <View key={step} style={styles.progressStep}>
        <View
          style={[
            styles.progressDot,
            idx < currentStep && styles.progressDotDone,
            idx === currentStep && styles.progressDotActive,
          ]}
        >
          {idx < currentStep ? (
            <Ionicons name="checkmark" size={10} color={COLORS.background} />
          ) : (
            <Text style={styles.progressDotNum}>{idx + 1}</Text>
          )}
        </View>
        {idx < totalSteps - 1 && (
          <View style={[styles.progressLine, idx < currentStep - 1 && styles.progressLineDone]} />
        )}
      </View>
    ))}
  </View>
);

const TransferCard = ({ transfer, onPress }: { transfer: Transfer; onPress: () => void }) => (
  <TouchableOpacity style={styles.transferCard} onPress={onPress}>
    <View style={styles.transferCardHeader}>
      <View>
        <Text style={styles.transferId}>{transfer.id}</Text>
        <Text style={styles.transferCorridor}>{transfer.corridor}</Text>
      </View>
      <StatusBadge status={transfer.status} />
    </View>
    <View style={styles.transferAmounts}>
      <View>
        <Text style={styles.amountLabel}>Sent</Text>
        <Text style={styles.amountValue}>
          {transfer.sourceCurrency} {transfer.amount.toLocaleString()}
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={16} color={COLORS.textMuted} />
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.amountLabel}>Received</Text>
        <Text style={[styles.amountValue, { color: COLORS.success }]}>
          {transfer.destCurrency} {transfer.destAmount.toFixed(2)}
        </Text>
      </View>
    </View>
    {transfer.status === "IN_PROGRESS" && (
      <ProgressSteps currentStep={transfer.currentStep} totalSteps={TRANSFER_STEPS.length} />
    )}
    <Text style={styles.transferDate}>{new Date(transfer.createdAt).toLocaleString()}</Text>
  </TouchableOpacity>
);

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function CrossBorderFxScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"send" | "history">("send");
  const [selectedCorridor, setSelectedCorridor] = useState(SUPPORTED_CORRIDORS[0]);
  const [amount, setAmount] = useState("");
  const [recipientAccount, setRecipientAccount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [purposeCode, setPurposeCode] = useState("FAMILY_SUPPORT");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>(MOCK_TRANSFERS);
  const [showCorridorPicker, setShowCorridorPicker] = useState(false);

  const destAmount = amount
    ? (parseFloat(amount) * selectedCorridor.rate).toFixed(2)
    : "0.00";

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 1000));
    setRefreshing(false);
  }, []);

  const handleSend = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount.");
      return;
    }
    if (!recipientAccount.trim()) {
      Alert.alert("Error", "Please enter the recipient account.");
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const newTransfer: Transfer = {
        id: `TXN-${Math.floor(Math.random() * 10000).toString().padStart(3, "0")}`,
        corridor: selectedCorridor.name,
        amount: parseFloat(amount),
        sourceCurrency: selectedCorridor.from,
        destCurrency: selectedCorridor.to,
        destAmount: parseFloat(destAmount),
        status: "PENDING",
        currentStep: 0,
        createdAt: new Date().toISOString(),
        workflowId: `wf-${Math.random().toString(36).slice(2, 8)}`,
      };
      setTransfers((prev) => [newTransfer, ...prev]);
      setAmount("");
      setRecipientAccount("");
      setRecipientName("");
      setActiveTab("history");
      Alert.alert("Transfer Initiated", `Transfer ${newTransfer.id} has been submitted.\nWorkflow: ${newTransfer.workflowId}`);
    } catch {
      Alert.alert("Error", "Transfer failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Cross-Border FX</Text>
          <Text style={styles.headerSubtitle}>Mojaloop ILP Transfers</Text>
        </View>
        <View style={styles.headerRight}>
          <Ionicons name="globe-outline" size={22} color={COLORS.info} />
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(["send", "history"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "send" ? "Send Money" : "History"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "send" ? (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Corridor Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Transfer Corridor</Text>
            <TouchableOpacity
              style={styles.corridorSelector}
              onPress={() => setShowCorridorPicker(!showCorridorPicker)}
            >
              <Text style={styles.corridorFlag}>{selectedCorridor.flag}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.corridorName}>{selectedCorridor.name}</Text>
                <Text style={styles.corridorRate}>
                  Rate: 1 {selectedCorridor.from} = {selectedCorridor.rate.toFixed(6)} {selectedCorridor.to}
                </Text>
              </View>
              <Ionicons
                name={showCorridorPicker ? "chevron-up" : "chevron-down"}
                size={18}
                color={COLORS.textMuted}
              />
            </TouchableOpacity>
            {showCorridorPicker && (
              <View style={styles.corridorDropdown}>
                {SUPPORTED_CORRIDORS.map((corridor) => (
                  <TouchableOpacity
                    key={`${corridor.from}-${corridor.to}`}
                    style={[
                      styles.corridorOption,
                      selectedCorridor.from === corridor.from && styles.corridorOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedCorridor(corridor);
                      setShowCorridorPicker(false);
                    }}
                  >
                    <Text style={styles.corridorFlag}>{corridor.flag}</Text>
                    <Text style={styles.corridorOptionText}>{corridor.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Amount */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Amount ({selectedCorridor.from})</Text>
            <TextInput
              style={styles.input}
              placeholder={`Enter amount in ${selectedCorridor.from}`}
              placeholderTextColor={COLORS.textDim}
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
            />
            {amount ? (
              <View style={styles.conversionBox}>
                <Ionicons name="swap-horizontal" size={16} color={COLORS.info} />
                <Text style={styles.conversionText}>
                  ≈ {selectedCorridor.to} {destAmount}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Recipient */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Recipient Account</Text>
            <TextInput
              style={styles.input}
              placeholder="IBAN / Account number / Mobile"
              placeholderTextColor={COLORS.textDim}
              value={recipientAccount}
              onChangeText={setRecipientAccount}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Recipient Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Full legal name"
              placeholderTextColor={COLORS.textDim}
              value={recipientName}
              onChangeText={setRecipientName}
            />
          </View>

          {/* Purpose Code */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Purpose</Text>
            <View style={styles.purposeGrid}>
              {["FAMILY_SUPPORT", "TRADE", "EDUCATION", "MEDICAL", "INVESTMENT"].map((code) => (
                <TouchableOpacity
                  key={code}
                  style={[styles.purposeChip, purposeCode === code && styles.purposeChipActive]}
                  onPress={() => setPurposeCode(code)}
                >
                  <Text style={[styles.purposeChipText, purposeCode === code && styles.purposeChipTextActive]}>
                    {code.replace("_", " ")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Workflow Info */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.info} />
            <Text style={styles.infoText}>
              Transfers use Temporal workflows with 6-phase Mojaloop ILP saga: KYC → Compliance → FX Lock → Debit → ILP Route → Credit
            </Text>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.sendBtn, loading && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.background} />
            ) : (
              <>
                <Ionicons name="send" size={18} color={COLORS.background} />
                <Text style={styles.sendBtnText}>Initiate Transfer</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={transfers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="swap-horizontal-outline" size={48} color={COLORS.textDim} />
              <Text style={styles.emptyText}>No transfers yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TransferCard
              transfer={item}
              onPress={() =>
                Alert.alert(
                  `Transfer ${item.id}`,
                  `Workflow: ${item.workflowId ?? "N/A"}\nStatus: ${item.status}\nStep: ${item.currentStep}/${TRANSFER_STEPS.length}`
                )
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  headerSubtitle: { fontSize: 12, color: COLORS.textMuted },
  headerRight: { marginLeft: "auto" },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { fontSize: 14, color: COLORS.textMuted },
  tabTextActive: { color: COLORS.primary, fontWeight: "600" },
  content: { padding: 16 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  corridorSelector: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 10,
  },
  corridorFlag: { fontSize: 20 },
  corridorName: { fontSize: 14, color: COLORS.text, fontWeight: "600" },
  corridorRate: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  corridorDropdown: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 4,
    overflow: "hidden",
  },
  corridorOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  corridorOptionSelected: { backgroundColor: COLORS.primary + "22" },
  corridorOptionText: { fontSize: 14, color: COLORS.text },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    color: COLORS.text,
    fontSize: 14,
  },
  conversionBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  conversionText: { fontSize: 13, color: COLORS.info },
  purposeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  purposeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  purposeChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "22" },
  purposeChipText: { fontSize: 12, color: COLORS.textMuted },
  purposeChipTextActive: { color: COLORS.primary },
  infoBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: COLORS.info + "11",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.info + "33",
  },
  infoText: { flex: 1, fontSize: 12, color: COLORS.textMuted, lineHeight: 18 },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { fontSize: 16, fontWeight: "700", color: COLORS.background },
  transferCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 12,
  },
  transferCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  transferId: { fontSize: 13, fontWeight: "700", color: COLORS.text },
  transferCorridor: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  transferAmounts: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  amountLabel: { fontSize: 11, color: COLORS.textMuted },
  amountValue: { fontSize: 14, fontWeight: "600", color: COLORS.text, marginTop: 2 },
  progressContainer: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  progressStep: { flexDirection: "row", alignItems: "center", flex: 1 },
  progressDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  progressDotDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  progressDotActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  progressDotNum: { fontSize: 9, color: COLORS.textMuted },
  progressLine: { flex: 1, height: 2, backgroundColor: COLORS.border },
  progressLineDone: { backgroundColor: COLORS.success },
  transferDate: { fontSize: 11, color: COLORS.textDim },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.textMuted },
});
