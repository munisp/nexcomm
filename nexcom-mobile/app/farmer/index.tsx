import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS, TYPOGRAPHY } from '../../constants/config';
import { trpc } from '../../lib/trpc';

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: COLORS.error,
  MEDIUM: COLORS.warning,
  LOW: COLORS.success,
};
const TASK_ICONS: Record<string, string> = {
  VISIT: '🚗', LOAN_ASSESSMENT: '💰', CROP_REPORT: '📋', KYC: '🪪',
  ONBOARDING: '➕', CROP_INSPECTION: '🌾', HARVEST_VERIFICATION: '✅',
  REPAYMENT_COLLECTION: '💳', FOLLOW_UP: '📞',
};

function OnboardFarmerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ fullName: '', phone: '', state: '', lga: '' });
  const utils = trpc.useUtils();
  const registerFarmer = trpc.inputFinancing.register.useMutation({
    onSuccess: () => { utils.inputFinancing.myProfile.invalidate(); Alert.alert('Success', 'Farmer registered!'); setForm({ fullName: '', phone: '', state: '', lga: '' }); onClose(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>➕ Onboard Farmer</Text>
          <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#6B7280" value={form.fullName} onChangeText={(v) => setForm(p => ({ ...p, fullName: v }))} />
          <TextInput style={styles.input} placeholder="Phone Number" placeholderTextColor="#6B7280" keyboardType="phone-pad" value={form.phone} onChangeText={(v) => setForm(p => ({ ...p, phone: v }))} />
          <TextInput style={styles.input} placeholder="State of Operation" placeholderTextColor="#6B7280" value={form.state} onChangeText={(v) => setForm(p => ({ ...p, state: v }))} />
          <TextInput style={styles.input} placeholder="LGA (optional)" placeholderTextColor="#6B7280" value={form.lga} onChangeText={(v) => setForm(p => ({ ...p, lga: v }))} />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.submitBtn, registerFarmer.isPending && { opacity: 0.6 }]} disabled={registerFarmer.isPending}
              onPress={() => { if (!form.fullName || !form.phone || !form.state) { Alert.alert('Validation', 'Full name, phone and state required'); return; } registerFarmer.mutate({ fullName: form.fullName, phone: form.phone, stateOfOperation: form.state, lgaOfOperation: form.lga || undefined }); }}>
              {registerFarmer.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Register</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CropReportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ farmId: '', cropType: '', season: '', plantingDate: '', expectedHarvestDate: '', estimatedYieldTons: '' });
  const utils = trpc.useUtils();
  const createReport = trpc.cropReports.create.useMutation({
    onSuccess: () => { utils.cropReports.list.invalidate(); Alert.alert('Success', 'Crop report submitted!'); setForm({ farmId: '', cropType: '', season: '', plantingDate: '', expectedHarvestDate: '', estimatedYieldTons: '' }); onClose(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>📋 Crop Report</Text>
          <TextInput style={styles.input} placeholder="Farm ID" placeholderTextColor="#6B7280" keyboardType="numeric" value={form.farmId} onChangeText={(v) => setForm(p => ({ ...p, farmId: v }))} />
          <TextInput style={styles.input} placeholder="Crop Type (e.g. Maize)" placeholderTextColor="#6B7280" value={form.cropType} onChangeText={(v) => setForm(p => ({ ...p, cropType: v }))} />
          <TextInput style={styles.input} placeholder="Season (e.g. 2025 Wet)" placeholderTextColor="#6B7280" value={form.season} onChangeText={(v) => setForm(p => ({ ...p, season: v }))} />
          <TextInput style={styles.input} placeholder="Planting Date (YYYY-MM-DD)" placeholderTextColor="#6B7280" value={form.plantingDate} onChangeText={(v) => setForm(p => ({ ...p, plantingDate: v }))} />
          <TextInput style={styles.input} placeholder="Expected Harvest (YYYY-MM-DD)" placeholderTextColor="#6B7280" value={form.expectedHarvestDate} onChangeText={(v) => setForm(p => ({ ...p, expectedHarvestDate: v }))} />
          <TextInput style={styles.input} placeholder="Est. Yield (tons)" placeholderTextColor="#6B7280" keyboardType="numeric" value={form.estimatedYieldTons} onChangeText={(v) => setForm(p => ({ ...p, estimatedYieldTons: v }))} />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.submitBtn, createReport.isPending && { opacity: 0.6 }]} disabled={createReport.isPending}
              onPress={() => { if (!form.farmId || !form.cropType || !form.season) { Alert.alert('Validation', 'Farm ID, crop type and season required'); return; } createReport.mutate({ farmId: parseInt(form.farmId, 10), cropType: form.cropType, season: form.season, plantingDate: form.plantingDate || undefined, expectedHarvestDate: form.expectedHarvestDate || undefined, estimatedYieldTons: form.estimatedYieldTons ? parseFloat(form.estimatedYieldTons) : undefined }); }}>
              {createReport.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Submit</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LoanRequestModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ farmerId: '', amount: '', purpose: '', tenorMonths: '12' });
  const utils = trpc.useUtils();
  const applyLoan = trpc.inputFinancing.applyForLoan.useMutation({
    onSuccess: () => { utils.inputFinancing.myLoans.invalidate(); Alert.alert('Success', 'Loan application submitted!'); setForm({ farmerId: '', amount: '', purpose: '', tenorMonths: '12' }); onClose(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>💰 Loan Application</Text>
          <TextInput style={styles.input} placeholder="Farmer ID" placeholderTextColor="#6B7280" keyboardType="numeric" value={form.farmerId} onChangeText={(v) => setForm(p => ({ ...p, farmerId: v }))} />
          <TextInput style={styles.input} placeholder="Amount (NGN)" placeholderTextColor="#6B7280" keyboardType="numeric" value={form.amount} onChangeText={(v) => setForm(p => ({ ...p, amount: v }))} />
          <TextInput style={styles.input} placeholder="Purpose (e.g. Input Purchase)" placeholderTextColor="#6B7280" value={form.purpose} onChangeText={(v) => setForm(p => ({ ...p, purpose: v }))} />
          <TextInput style={styles.input} placeholder="Tenor (months)" placeholderTextColor="#6B7280" keyboardType="numeric" value={form.tenorMonths} onChangeText={(v) => setForm(p => ({ ...p, tenorMonths: v }))} />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.submitBtn, applyLoan.isPending && { opacity: 0.6 }]} disabled={applyLoan.isPending}
              onPress={() => { if (!form.farmerId || !form.amount || !form.purpose) { Alert.alert('Validation', 'Farmer ID, amount and purpose required'); return; } applyLoan.mutate({ farmerId: parseInt(form.farmerId, 10), requestedAmount: parseFloat(form.amount), purpose: form.purpose, tenorMonths: parseInt(form.tenorMonths, 10) || 12 }); }}>
              {applyLoan.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Apply</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FieldVisitModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ farmerId: '', visitType: 'ONBOARDING', scheduledAt: '' });
  const utils = trpc.useUtils();
  const scheduleVisit = trpc.inputFinancing.scheduleVisit.useMutation({
    onSuccess: () => { utils.inputFinancing.myVisits.invalidate(); Alert.alert('Success', 'Field visit scheduled!'); setForm({ farmerId: '', visitType: 'ONBOARDING', scheduledAt: '' }); onClose(); },
    onError: (e) => Alert.alert('Error', e.message),
  });
  const visitTypes = ['ONBOARDING','CROP_INSPECTION','LOAN_ASSESSMENT','HARVEST_VERIFICATION','REPAYMENT_COLLECTION','FOLLOW_UP'];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>🗺️ Schedule Field Visit</Text>
          <TextInput style={styles.input} placeholder="Farmer ID" placeholderTextColor="#6B7280" keyboardType="numeric" value={form.farmerId} onChangeText={(v) => setForm(p => ({ ...p, farmerId: v }))} />
          <Text style={[styles.inputLabel, { marginBottom: 6 }]}>Visit Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {visitTypes.map((vt) => (
              <TouchableOpacity key={vt} style={[styles.chipBtn, form.visitType === vt && styles.chipBtnActive]} onPress={() => setForm(p => ({ ...p, visitType: vt }))}>
                <Text style={[styles.chipText, form.visitType === vt && styles.chipTextActive]}>{vt.replace(/_/g,' ')}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput style={styles.input} placeholder="Scheduled Date (YYYY-MM-DDTHH:mm)" placeholderTextColor="#6B7280" value={form.scheduledAt} onChangeText={(v) => setForm(p => ({ ...p, scheduledAt: v }))} />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.submitBtn, scheduleVisit.isPending && { opacity: 0.6 }]} disabled={scheduleVisit.isPending}
              onPress={() => { if (!form.farmerId || !form.scheduledAt) { Alert.alert('Validation', 'Farmer ID and date required'); return; } scheduleVisit.mutate({ farmerId: parseInt(form.farmerId, 10), visitType: form.visitType as any, scheduledAt: form.scheduledAt }); }}>
              {scheduleVisit.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Schedule</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function FieldAgentScreen() {
  const [activeTab, setActiveTab] = useState<'tasks' | 'farmers' | 'reports'>('tasks');
  const [modal, setModal] = useState<'onboard' | 'crop' | 'loan' | 'visit' | null>(null);

  const statsQuery = trpc.inputFinancing.networkStats.useQuery();
  const visitsQuery = trpc.inputFinancing.myVisits.useQuery();
  const reportsQuery = trpc.cropReports.list.useQuery({ limit: 20 });

  const stats = statsQuery.data ?? { totalAgents: 0, activeAgents: 0, statesCovered: 0, pendingVisits: 0 };
  const visits = (visitsQuery.data ?? []) as any[];
  const reports = (reportsQuery.data ?? []) as any[];

  const handleStartVisit = (task: any) => {
    Alert.alert('Start Visit', `Navigate to farmer #${task.farmerId}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Maps', onPress: () => Alert.alert('Navigation', 'Opening maps app...') },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.statsGrid}>
          {[
            { label: 'Agents', value: String(stats.totalAgents ?? 0), icon: '👨‍🌾' },
            { label: 'Active', value: String(stats.activeAgents ?? 0), icon: '✅' },
            { label: 'States', value: String(stats.statesCovered ?? 0), icon: '🌾' },
            { label: 'Pending', value: String(visits.filter((v) => v.status === 'SCHEDULED').length), icon: '📍' },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statIcon}>{stat.icon}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.quickActions}>
          {[
            { icon: '➕', label: 'Onboard Farmer', onPress: () => setModal('onboard') },
            { icon: '📋', label: 'Crop Report', onPress: () => setModal('crop') },
            { icon: '💰', label: 'Loan Request', onPress: () => setModal('loan') },
            { icon: '🗺️', label: 'Field Visit', onPress: () => setModal('visit') },
          ].map((action) => (
            <TouchableOpacity key={action.label} style={styles.quickActionBtn} onPress={action.onPress}>
              <View style={styles.quickActionIcon}><Text style={styles.quickActionEmoji}>{action.icon}</Text></View>
              <Text style={styles.quickActionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.tabSelector}>
          {(['tasks', 'farmers', 'reports'] as const).map((tab) => (
            <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'tasks' ? `Visits (${visits.length})` : tab === 'farmers' ? 'Reports' : 'Summary'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'tasks' && (
          <View style={styles.section}>
            {visitsQuery.isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} /> :
             visits.length === 0 ? <Text style={styles.emptyText}>No scheduled visits</Text> :
             visits.map((task) => (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <View style={styles.taskLeft}>
                    <Text style={styles.taskIcon}>{TASK_ICONS[task.visitType] ?? '🚗'}</Text>
                    <View>
                      <Text style={styles.taskType}>{(task.visitType ?? '').replace(/_/g,' ')}</Text>
                      <Text style={styles.taskFarmer}>Farmer #{task.farmerId}</Text>
                    </View>
                  </View>
                  <View style={[styles.priorityBadge, { backgroundColor: task.status === 'COMPLETED' ? '#16a34a20' : '#f59e0b20' }]}>
                    <Text style={[styles.priorityText, { color: task.status === 'COMPLETED' ? COLORS.success : COLORS.warning }]}>{task.status}</Text>
                  </View>
                </View>
                <View style={styles.taskDetails}>
                  <Text style={styles.taskDetail}>📅 {task.scheduledAt ? new Date(task.scheduledAt).toLocaleDateString() : 'TBD'}</Text>
                  {task.notes && <Text style={styles.taskDetail}>📝 {task.notes}</Text>}
                </View>
                <View style={styles.taskActions}>
                  <TouchableOpacity style={styles.taskActionBtn} onPress={() => handleStartVisit(task)}>
                    <Text style={styles.taskActionText}>🗺️ Navigate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.taskActionBtn, styles.taskActionBtnPrimary]} onPress={() => router.push(`/farmer/${task.id}` as any)}>
                    <Text style={[styles.taskActionText, { color: COLORS.primary }]}>📝 Report</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'farmers' && (
          <View style={styles.section}>
            {reportsQuery.isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} /> :
             reports.length === 0 ? <Text style={styles.emptyText}>No crop reports yet</Text> :
             reports.map((r: any) => (
              <View key={r.id} style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <View style={styles.taskLeft}>
                    <Text style={styles.taskIcon}>🌾</Text>
                    <View>
                      <Text style={styles.taskType}>{r.cropType}</Text>
                      <Text style={styles.taskFarmer}>Farm #{r.farmId} — {r.season}</Text>
                    </View>
                  </View>
                  <View style={[styles.priorityBadge, { backgroundColor: '#3b82f620' }]}>
                    <Text style={[styles.priorityText, { color: COLORS.primary }]}>{r.status ?? 'SUBMITTED'}</Text>
                  </View>
                </View>
                {r.estimatedYieldTons && <Text style={styles.taskDetail}>📦 Est. Yield: {r.estimatedYieldTons} tons</Text>}
              </View>
            ))}
          </View>
        )}

        {activeTab === 'reports' && (
          <View style={styles.section}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Agent Performance</Text>
              {[
                { label: 'Total Visits', value: visits.length },
                { label: 'Completed', value: visits.filter((v) => v.status === 'COMPLETED').length },
                { label: 'Crop Reports', value: reports.length },
                { label: 'Pending Visits', value: visits.filter((v) => v.status === 'SCHEDULED').length },
              ].map((item) => (
                <View key={item.label} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                  <Text style={styles.summaryValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        <View style={{ height: 30 }} />
      </ScrollView>

      <OnboardFarmerModal visible={modal === 'onboard'} onClose={() => setModal(null)} />
      <CropReportModal visible={modal === 'crop'} onClose={() => setModal(null)} />
      <LoanRequestModal visible={modal === 'loan'} onClose={() => setModal(null)} />
      <FieldVisitModal visible={modal === 'visit'} onClose={() => setModal(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  statsGrid: { flexDirection: 'row', padding: 16, paddingBottom: 8, gap: 8 },
  statCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  statIcon: { fontSize: 20, marginBottom: 4 },
  statValue: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 2 },
  statLabel: { color: COLORS.textMuted, fontSize: 11 },
  quickActions: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  quickActionBtn: { flex: 1, alignItems: 'center' },
  quickActionIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 6, borderWidth: 1, borderColor: COLORS.border },
  quickActionEmoji: { fontSize: 22 },
  quickActionLabel: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', fontWeight: '500' },
  tabSelector: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: COLORS.surface, borderRadius: 10, padding: 4, borderWidth: 1, borderColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: `${COLORS.primary}20` },
  tabText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: COLORS.primary, fontWeight: '700' },
  section: { paddingHorizontal: 16, gap: 12 },
  taskCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  taskLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskIcon: { fontSize: 24 },
  taskType: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  taskFarmer: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  priorityText: { fontSize: 11, fontWeight: '700' },
  taskDetails: { gap: 4, marginBottom: 12 },
  taskDetail: { color: COLORS.textMuted, fontSize: 13 },
  taskActions: { flexDirection: 'row', gap: 8 },
  taskActionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.surfaceAlt, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  taskActionBtnPrimary: { backgroundColor: `${COLORS.primary}15`, borderColor: `${COLORS.primary}40` },
  taskActionText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: COLORS.textMuted, marginTop: 40, fontSize: 14 },
  summaryCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  summaryTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  summaryLabel: { color: COLORS.textMuted, fontSize: 13 },
  summaryValue: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  input: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  inputLabel: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
  chipBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.background, marginRight: 8, borderWidth: 1, borderColor: COLORS.border },
  chipBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.background, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  cancelBtnText: { color: COLORS.textMuted, fontWeight: '600' },
  submitBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: '700' },
});
