/**
 * NEXCOM Exchange — Drizzle ORM Relations (Round 69 — comprehensive expansion)
 *
 * Extended from 6 to 80+ relations covering all major table groups.
 * Enables type-safe db.query.* calls with `with:` eager loading.
 */
import { relations } from "drizzle-orm";
import {
  users, profiles, watchlist, priceAlerts, notifications, kycQueue,
  orders, orderAmendments, positions, settlements, settlementDisputes,
  disputeAuditLog, disputeEvidence, warehouseReceipts, depositRequests,
  deliveryOrders, apiKeys, portfolioSnapshots, marginAccounts, collateralItems,
  collateralLedger, securityEvents, deviceSessions, amlFlags, sarReports,
  settlementCycles, settlementInstructions, settlementFails, regulatoryReports,
  marketMakerProfiles, marketMakerObligations, marketMakerQuoteSnapshots,
  marketMakerPerformanceReports, clearingAccounts, tradeFills, preTradRiskChecks,
  corporateActions, brokerClients, brokerCommissions, brokerLedgerEntries,
  fixedIncomeTrades, workbenchFarms, workbenchCropPlans, workbenchSoilTests,
  inputFinancingLoans, inputFinancingRepayments, fieldAgents, fieldVisits,
  bankAccounts, bankTransactions, creditScores, cropInsurancePolicies,
  loanRepaymentSchedules, loanLifecycleEvents, loanLedgerEntries,
  marginLedgerEntries, crossBorderLedgerEntries, receiptLedgerEntries,
  clearingLedgerEntries, settlementLedgerEntries, exchangeOperators,
  operatorInstruments, operatorFees, operatorSettlementRules, traceSnapshots,
  workflowExecutions, fluvioEventLog, daprPubsubLog, pushTokens, ussdSessions,
  whatsappContacts, whatsappMessages, telegramContacts, telegramMessages,
  auditLog, tbTransferLog, keycloakUserSync, refreshTokens, webauthnCredentials,
  webauthnChallenges, userMfaSettings, mfaOtpCodes, totpSecrets, velocityLedger,
  withdrawalVerifications, kycLivenessSessions, pbacPolicies, aiSearchHistory,
  mojaloopParties, mojaloopQuotes, mojaloopTransfers, mojaloopCallbacks,
  dfspKycRecords, collateralRegistry, savedOrders, userPreferences,
  cooperativeBulkUploads, rateLimitCounters, webhookConfigs, ipAllowlist,
} from "./schema";

// ── Users ────────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  watchlist: many(watchlist),
  priceAlerts: many(priceAlerts),
  notifications: many(notifications),
  orders: many(orders),
  positions: many(positions),
  apiKeys: many(apiKeys),
  portfolioSnapshots: many(portfolioSnapshots),
  marginAccounts: many(marginAccounts),
  deviceSessions: many(deviceSessions),
  securityEvents: many(securityEvents),
  amlFlags: many(amlFlags),
  bankAccounts: many(bankAccounts),
  creditScores: many(creditScores),
  pushTokens: many(pushTokens),
  auditLog: many(auditLog),
  refreshTokens: many(refreshTokens),
  webauthnCredentials: many(webauthnCredentials),
  userMfaSettings: one(userMfaSettings, { fields: [users.id], references: [userMfaSettings.userId] }),
  totpSecrets: many(totpSecrets),
  velocityLedger: many(velocityLedger),
  withdrawalVerifications: many(withdrawalVerifications),
  savedOrders: many(savedOrders),
  userPreferences: one(userPreferences, { fields: [users.id], references: [userPreferences.userId] }),
  aiSearchHistory: many(aiSearchHistory),
  pbacPolicies: many(pbacPolicies),
  keycloakUserSync: one(keycloakUserSync, { fields: [users.id], references: [keycloakUserSync.userId] }),
  kycLivenessSessions: many(kycLivenessSessions),
  tbTransferLog: many(tbTransferLog),
  crossBorderLedgerEntries: many(crossBorderLedgerEntries),
}));

// ── Profiles ─────────────────────────────────────────────────────────────────
export const profilesRelations = relations(profiles, ({ one, many }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
  kycQueue: many(kycQueue),
  fieldAgents: many(fieldAgents),
  workbenchFarms: many(workbenchFarms),
  inputFinancingLoans: many(inputFinancingLoans),
  brokerClients: many(brokerClients),
}));

// ── KYC ──────────────────────────────────────────────────────────────────────
export const kycQueueRelations = relations(kycQueue, ({ one }) => ({
  profile: one(profiles, { fields: [kycQueue.profileId], references: [profiles.id] }),
  user: one(users, { fields: [kycQueue.userId], references: [users.id] }),
}));
export const kycLivenessSessionsRelations = relations(kycLivenessSessions, ({ one }) => ({
  user: one(users, { fields: [kycLivenessSessions.userId], references: [users.id] }),
}));

// ── Orders ───────────────────────────────────────────────────────────────────
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  fills: many(tradeFills),
  amendments: many(orderAmendments),
  preTradRiskChecks: many(preTradRiskChecks),
}));
export const orderAmendmentsRelations = relations(orderAmendments, ({ one }) => ({
  order: one(orders, { fields: [orderAmendments.orderId], references: [orders.id] }),
}));
export const tradeFillsRelations = relations(tradeFills, ({ one }) => ({
  order: one(orders, { fields: [tradeFills.orderId], references: [orders.id] }),
  user: one(users, { fields: [tradeFills.userId], references: [users.id] }),
}));
export const preTradRiskChecksRelations = relations(preTradRiskChecks, ({ one }) => ({
  order: one(orders, { fields: [preTradRiskChecks.orderId], references: [orders.id] }),
  user: one(users, { fields: [preTradRiskChecks.userId], references: [users.id] }),
}));
export const positionsRelations = relations(positions, ({ one }) => ({
  user: one(users, { fields: [positions.userId], references: [users.id] }),
}));

// ── Watchlist / Alerts / Notifications ───────────────────────────────────────
export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, { fields: [watchlist.userId], references: [users.id] }),
}));
export const priceAlertsRelations = relations(priceAlerts, ({ one }) => ({
  user: one(users, { fields: [priceAlerts.userId], references: [users.id] }),
}));
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
export const savedOrdersRelations = relations(savedOrders, ({ one }) => ({
  user: one(users, { fields: [savedOrders.userId], references: [users.id] }),
}));

// ── Warehouse ─────────────────────────────────────────────────────────────────
export const warehouseReceiptsRelations = relations(warehouseReceipts, ({ one, many }) => ({
  user: one(users, { fields: [warehouseReceipts.userId], references: [users.id] }),
  ledgerEntries: many(receiptLedgerEntries),
}));
export const depositRequestsRelations = relations(depositRequests, ({ one }) => ({
  user: one(users, { fields: [depositRequests.userId], references: [users.id] }),
}));
export const deliveryOrdersRelations = relations(deliveryOrders, ({ one }) => ({
  user: one(users, { fields: [deliveryOrders.userId], references: [users.id] }),
}));

// ── Settlements ───────────────────────────────────────────────────────────────
export const settlementsRelations = relations(settlements, ({ one, many }) => ({
  buyer: one(users, { fields: [settlements.buyerId], references: [users.id] }),
  seller: one(users, { fields: [settlements.sellerId], references: [users.id] }),
  ledgerEntries: many(settlementLedgerEntries),
}));
export const settlementDisputesRelations = relations(settlementDisputes, ({ one, many }) => ({
  settlement: one(settlements, { fields: [settlementDisputes.settlementId], references: [settlements.id] }),
  auditLog: many(disputeAuditLog),
  evidence: many(disputeEvidence),
}));
export const disputeAuditLogRelations = relations(disputeAuditLog, ({ one }) => ({
  dispute: one(settlementDisputes, { fields: [disputeAuditLog.disputeId], references: [settlementDisputes.id] }),
}));
export const disputeEvidenceRelations = relations(disputeEvidence, ({ one }) => ({
  dispute: one(settlementDisputes, { fields: [disputeEvidence.disputeId], references: [settlementDisputes.id] }),
}));
export const settlementCyclesRelations = relations(settlementCycles, ({ many }) => ({
  instructions: many(settlementInstructions),
}));
export const settlementInstructionsRelations = relations(settlementInstructions, ({ one, many }) => ({
  cycle: one(settlementCycles, { fields: [settlementInstructions.cycleId], references: [settlementCycles.id] }),
  fails: many(settlementFails),
}));
export const settlementFailsRelations = relations(settlementFails, ({ one }) => ({
  instruction: one(settlementInstructions, { fields: [settlementFails.instructionId], references: [settlementInstructions.id] }),
}));

// ── Margin & Collateral ───────────────────────────────────────────────────────
export const marginAccountsRelations = relations(marginAccounts, ({ one, many }) => ({
  user: one(users, { fields: [marginAccounts.userId], references: [users.id] }),
  collateralItems: many(collateralItems),
  ledgerEntries: many(marginLedgerEntries),
}));
export const collateralItemsRelations = relations(collateralItems, ({ one, many }) => ({
  marginAccount: one(marginAccounts, { fields: [collateralItems.marginAccountId], references: [marginAccounts.id] }),
  ledger: many(collateralLedger),
}));
export const collateralLedgerRelations = relations(collateralLedger, ({ one }) => ({
  collateralItem: one(collateralItems, { fields: [collateralLedger.collateralItemId], references: [collateralItems.id] }),
}));

// ── Market Makers ─────────────────────────────────────────────────────────────
export const marketMakerProfilesRelations = relations(marketMakerProfiles, ({ one, many }) => ({
  user: one(users, { fields: [marketMakerProfiles.userId], references: [users.id] }),
  obligations: many(marketMakerObligations),
  quoteSnapshots: many(marketMakerQuoteSnapshots),
  performanceReports: many(marketMakerPerformanceReports),
}));
export const marketMakerObligationsRelations = relations(marketMakerObligations, ({ one }) => ({
  profile: one(marketMakerProfiles, { fields: [marketMakerObligations.marketMakerId], references: [marketMakerProfiles.id] }),
}));
export const marketMakerQuoteSnapshotsRelations = relations(marketMakerQuoteSnapshots, ({ one }) => ({
  profile: one(marketMakerProfiles, { fields: [marketMakerQuoteSnapshots.marketMakerId], references: [marketMakerProfiles.id] }),
}));
export const marketMakerPerformanceReportsRelations = relations(marketMakerPerformanceReports, ({ one }) => ({
  profile: one(marketMakerProfiles, { fields: [marketMakerPerformanceReports.marketMakerId], references: [marketMakerProfiles.id] }),
}));

// ── Clearing ──────────────────────────────────────────────────────────────────
export const clearingAccountsRelations = relations(clearingAccounts, ({ one, many }) => ({
  user: one(users, { fields: [clearingAccounts.userId], references: [users.id] }),
  ledgerEntries: many(clearingLedgerEntries),
}));

// ── AML / Security ────────────────────────────────────────────────────────────
export const amlFlagsRelations = relations(amlFlags, ({ one }) => ({
  user: one(users, { fields: [amlFlags.userId], references: [users.id] }),
}));
export const sarReportsRelations = relations(sarReports, ({ one }) => ({
  submittedBy: one(users, { fields: [sarReports.submittedBy], references: [users.id] }),
}));
export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
  user: one(users, { fields: [securityEvents.userId], references: [users.id] }),
}));

// ── Regulatory ────────────────────────────────────────────────────────────────
export const regulatoryReportsRelations = relations(regulatoryReports, ({ one }) => ({
  generatedBy: one(users, { fields: [regulatoryReports.generatedBy], references: [users.id] }),
}));

// ── Brokers ───────────────────────────────────────────────────────────────────
export const brokerClientsRelations = relations(brokerClients, ({ one, many }) => ({
  profile: one(profiles, { fields: [brokerClients.profileId], references: [profiles.id] }),
  commissions: many(brokerCommissions),
  ledgerEntries: many(brokerLedgerEntries),
}));
export const brokerCommissionsRelations = relations(brokerCommissions, ({ one }) => ({
  brokerClient: one(brokerClients, { fields: [brokerCommissions.brokerClientId], references: [brokerClients.id] }),
}));

// ── Fixed Income ──────────────────────────────────────────────────────────────
export const fixedIncomeTradesRelations = relations(fixedIncomeTrades, ({ one }) => ({
  user: one(users, { fields: [fixedIncomeTrades.userId], references: [users.id] }),
}));

// ── WorkBench / AgriSME ───────────────────────────────────────────────────────
export const workbenchFarmsRelations = relations(workbenchFarms, ({ one, many }) => ({
  profile: one(profiles, { fields: [workbenchFarms.userId], references: [profiles.userId] }),
  cropPlans: many(workbenchCropPlans),
  soilTests: many(workbenchSoilTests),
}));
export const workbenchCropPlansRelations = relations(workbenchCropPlans, ({ one }) => ({
  farm: one(workbenchFarms, { fields: [workbenchCropPlans.farmId], references: [workbenchFarms.id] }),
}));
export const workbenchSoilTestsRelations = relations(workbenchSoilTests, ({ one }) => ({
  farm: one(workbenchFarms, { fields: [workbenchSoilTests.farmId], references: [workbenchFarms.id] }),
}));

// ── Input Financing ───────────────────────────────────────────────────────────
export const inputFinancingLoansRelations = relations(inputFinancingLoans, ({ one, many }) => ({
  profile: one(profiles, { fields: [inputFinancingLoans.profileId], references: [profiles.id] }),
  repayments: many(inputFinancingRepayments),
  lifecycleEvents: many(loanLifecycleEvents),
  ledgerEntries: many(loanLedgerEntries),
  repaymentSchedules: many(loanRepaymentSchedules),
}));
export const inputFinancingRepaymentsRelations = relations(inputFinancingRepayments, ({ one }) => ({
  loan: one(inputFinancingLoans, { fields: [inputFinancingRepayments.loanId], references: [inputFinancingLoans.id] }),
}));
export const loanLifecycleEventsRelations = relations(loanLifecycleEvents, ({ one }) => ({
  loan: one(inputFinancingLoans, { fields: [loanLifecycleEvents.loanId], references: [inputFinancingLoans.id] }),
}));
export const loanRepaymentSchedulesRelations = relations(loanRepaymentSchedules, ({ one }) => ({
  loan: one(inputFinancingLoans, { fields: [loanRepaymentSchedules.loanId], references: [inputFinancingLoans.id] }),
}));

// ── Field Agents ──────────────────────────────────────────────────────────────
export const fieldAgentsRelations = relations(fieldAgents, ({ one, many }) => ({
  profile: one(profiles, { fields: [fieldAgents.profileId], references: [profiles.id] }),
  visits: many(fieldVisits),
}));
export const fieldVisitsRelations = relations(fieldVisits, ({ one }) => ({
  agent: one(fieldAgents, { fields: [fieldVisits.agentId], references: [fieldAgents.id] }),
}));

// ── Banking ───────────────────────────────────────────────────────────────────
export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  user: one(users, { fields: [bankAccounts.userId], references: [users.id] }),
  transactions: many(bankTransactions),
}));
export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  account: one(bankAccounts, { fields: [bankTransactions.accountId], references: [bankAccounts.id] }),
}));
export const creditScoresRelations = relations(creditScores, ({ one }) => ({
  user: one(users, { fields: [creditScores.userId], references: [users.id] }),
}));
export const cropInsurancePoliciesRelations = relations(cropInsurancePolicies, ({ one }) => ({
  user: one(users, { fields: [cropInsurancePolicies.userId], references: [users.id] }),
}));

// ── Ledger Entries ────────────────────────────────────────────────────────────
export const loanLedgerEntriesRelations = relations(loanLedgerEntries, ({ one }) => ({
  loan: one(inputFinancingLoans, { fields: [loanLedgerEntries.loanId], references: [inputFinancingLoans.id] }),
}));
export const marginLedgerEntriesRelations = relations(marginLedgerEntries, ({ one }) => ({
  marginAccount: one(marginAccounts, { fields: [marginLedgerEntries.accountId], references: [marginAccounts.id] }),
}));
export const crossBorderLedgerEntriesRelations = relations(crossBorderLedgerEntries, ({ one }) => ({
  user: one(users, { fields: [crossBorderLedgerEntries.userId], references: [users.id] }),
}));
export const receiptLedgerEntriesRelations = relations(receiptLedgerEntries, ({ one }) => ({
  receipt: one(warehouseReceipts, { fields: [receiptLedgerEntries.receiptId], references: [warehouseReceipts.id] }),
}));
export const clearingLedgerEntriesRelations = relations(clearingLedgerEntries, ({ one }) => ({
  clearingAccount: one(clearingAccounts, { fields: [clearingLedgerEntries.accountId], references: [clearingAccounts.id] }),
}));
export const settlementLedgerEntriesRelations = relations(settlementLedgerEntries, ({ one }) => ({
  settlement: one(settlements, { fields: [settlementLedgerEntries.settlementId], references: [settlements.id] }),
}));

// ── Exchange Operators ────────────────────────────────────────────────────────
export const exchangeOperatorsRelations = relations(exchangeOperators, ({ many }) => ({
  instruments: many(operatorInstruments),
  fees: many(operatorFees),
  settlementRules: many(operatorSettlementRules),
}));
export const operatorInstrumentsRelations = relations(operatorInstruments, ({ one }) => ({
  operator: one(exchangeOperators, { fields: [operatorInstruments.operatorId], references: [exchangeOperators.id] }),
}));
export const operatorFeesRelations = relations(operatorFees, ({ one }) => ({
  operator: one(exchangeOperators, { fields: [operatorFees.operatorId], references: [exchangeOperators.id] }),
}));
export const operatorSettlementRulesRelations = relations(operatorSettlementRules, ({ one }) => ({
  operator: one(exchangeOperators, { fields: [operatorSettlementRules.operatorId], references: [exchangeOperators.id] }),
}));

// ── Distributed Tracing ───────────────────────────────────────────────────────
export const traceSnapshotsRelations = relations(traceSnapshots, ({ one }) => ({
  initiatedBy: one(users, { fields: [traceSnapshots.initiatedBy], references: [users.id] }),
}));

// ── Temporal Workflows ────────────────────────────────────────────────────────
export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
  initiatedBy: one(users, { fields: [workflowExecutions.initiatedBy], references: [users.id] }),
}));

// ── Messaging ─────────────────────────────────────────────────────────────────
export const ussdSessionsRelations = relations(ussdSessions, ({ one }) => ({
  user: one(users, { fields: [ussdSessions.userId], references: [users.id] }),
}));
export const whatsappContactsRelations = relations(whatsappContacts, ({ one, many }) => ({
  user: one(users, { fields: [whatsappContacts.userId], references: [users.id] }),
  messages: many(whatsappMessages),
}));
export const whatsappMessagesRelations = relations(whatsappMessages, ({ one }) => ({
  contact: one(whatsappContacts, { fields: [whatsappMessages.contactId], references: [whatsappContacts.id] }),
}));
export const telegramContactsRelations = relations(telegramContacts, ({ one, many }) => ({
  user: one(users, { fields: [telegramContacts.userId], references: [users.id] }),
  messages: many(telegramMessages),
}));
export const telegramMessagesRelations = relations(telegramMessages, ({ one }) => ({
  contact: one(telegramContacts, { fields: [telegramMessages.contactId], references: [telegramContacts.id] }),
}));

// ── Auth / Security ───────────────────────────────────────────────────────────
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));
export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
export const webauthnCredentialsRelations = relations(webauthnCredentials, ({ one }) => ({
  user: one(users, { fields: [webauthnCredentials.userId], references: [users.id] }),
}));
export const webauthnChallengesRelations = relations(webauthnChallenges, ({ one }) => ({
  user: one(users, { fields: [webauthnChallenges.userId], references: [users.id] }),
}));
export const userMfaSettingsRelations = relations(userMfaSettings, ({ one }) => ({
  user: one(users, { fields: [userMfaSettings.userId], references: [users.id] }),
}));
export const mfaOtpCodesRelations = relations(mfaOtpCodes, ({ one }) => ({
  user: one(users, { fields: [mfaOtpCodes.userId], references: [users.id] }),
}));
export const totpSecretsRelations = relations(totpSecrets, ({ one }) => ({
  user: one(users, { fields: [totpSecrets.userId], references: [users.id] }),
}));
export const deviceSessionsRelations = relations(deviceSessions, ({ one }) => ({
  user: one(users, { fields: [deviceSessions.userId], references: [users.id] }),
}));
export const velocityLedgerRelations = relations(velocityLedger, ({ one }) => ({
  user: one(users, { fields: [velocityLedger.userId], references: [users.id] }),
}));
export const withdrawalVerificationsRelations = relations(withdrawalVerifications, ({ one }) => ({
  user: one(users, { fields: [withdrawalVerifications.userId], references: [users.id] }),
}));

// ── Audit / Observability ─────────────────────────────────────────────────────
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));
export const tbTransferLogRelations = relations(tbTransferLog, ({ one }) => ({
  user: one(users, { fields: [tbTransferLog.userId], references: [users.id] }),
}));
export const keycloakUserSyncRelations = relations(keycloakUserSync, ({ one }) => ({
  user: one(users, { fields: [keycloakUserSync.userId], references: [users.id] }),
}));
export const fluvioEventLogRelations = relations(fluvioEventLog, ({ one }) => ({
  user: one(users, { fields: [fluvioEventLog.userId], references: [users.id] }),
}));
export const daprPubsubLogRelations = relations(daprPubsubLog, ({ one }) => ({
  user: one(users, { fields: [daprPubsubLog.userId], references: [users.id] }),
}));

// ── Mojaloop ──────────────────────────────────────────────────────────────────
export const mojaloopQuotesRelations = relations(mojaloopQuotes, ({ one }) => ({
  party: one(mojaloopParties, { fields: [mojaloopQuotes.partyId], references: [mojaloopParties.id] }),
}));
export const mojaloopTransfersRelations = relations(mojaloopTransfers, ({ one }) => ({
  quote: one(mojaloopQuotes, { fields: [mojaloopTransfers.quoteId], references: [mojaloopQuotes.id] }),
}));
export const mojaloopCallbacksRelations = relations(mojaloopCallbacks, ({ one }) => ({
  transfer: one(mojaloopTransfers, { fields: [mojaloopCallbacks.transferId], references: [mojaloopTransfers.id] }),
}));
export const dfspKycRecordsRelations = relations(dfspKycRecords, ({ one }) => ({
  party: one(mojaloopParties, { fields: [dfspKycRecords.partyId], references: [mojaloopParties.id] }),
}));

// ── Misc ──────────────────────────────────────────────────────────────────────
export const portfolioSnapshotsRelations = relations(portfolioSnapshots, ({ one }) => ({
  user: one(users, { fields: [portfolioSnapshots.userId], references: [users.id] }),
}));
export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, { fields: [pushTokens.userId], references: [users.id] }),
}));
export const aiSearchHistoryRelations = relations(aiSearchHistory, ({ one }) => ({
  user: one(users, { fields: [aiSearchHistory.userId], references: [users.id] }),
}));
export const pbacPoliciesRelations = relations(pbacPolicies, ({ one }) => ({
  user: one(users, { fields: [pbacPolicies.userId], references: [users.id] }),
}));
export const collateralRegistryRelations = relations(collateralRegistry, ({ one }) => ({
  user: one(users, { fields: [collateralRegistry.userId], references: [users.id] }),
}));
export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, { fields: [userPreferences.userId], references: [users.id] }),
}));
export const cooperativeBulkUploadsRelations = relations(cooperativeBulkUploads, ({ one }) => ({
  user: one(users, { fields: [cooperativeBulkUploads.userId], references: [users.id] }),
}));
export const webhookConfigsRelations = relations(webhookConfigs, ({ one }) => ({
  user: one(users, { fields: [webhookConfigs.userId], references: [users.id] }),
}));
export const ipAllowlistRelations = relations(ipAllowlist, ({ one }) => ({
  user: one(users, { fields: [ipAllowlist.userId], references: [users.id] }),
}));
export const rateLimitCountersRelations = relations(rateLimitCounters, ({ one }) => ({
  user: one(users, { fields: [rateLimitCounters.userId], references: [users.id] }),
}));
export const corporateActionsRelations = relations(corporateActions, ({ one }) => ({
  processedBy: one(users, { fields: [corporateActions.processedBy], references: [users.id] }),
}));
