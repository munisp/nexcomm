# BBC Deepfake Attack Analysis & NEXCOM Platform Security Recommendations

**Document type:** Internal Security Advisory  
**Prepared for:** NEXCOM Exchange — Platform Security Team  
**Date:** March 2026  
**Classification:** Confidential — Internal Use Only

---

## 1. Background: The BBC Deepfake Attack Vector

In 2023–2025, the BBC and multiple financial institutions reported a surge in AI-generated deepfake attacks targeting financial platforms. The primary attack patterns observed were:

| Attack Type | Description | Target |
|---|---|---|
| **Voice deepfake** | Synthetic audio replicating a known executive or customer voice to authorise high-value transfers | Phone-based verification, voice-auth systems |
| **Video deepfake** | Real-time or pre-recorded synthetic video used to bypass liveness checks in KYC onboarding | Video KYC, identity verification |
| **Document deepfake** | AI-generated identity documents (passports, NIN slips) that pass OCR and basic visual checks | KYC document upload |
| **Social engineering + deepfake combo** | Deepfake video/audio used to impersonate a trusted party in a live call to authorise a withdrawal | High-value withdrawal approval |

The BBC specifically documented a case where a Hong Kong-based firm lost US$25 million after an employee was deceived by a deepfake video call impersonating the company's CFO, authorising a wire transfer.

---

## 2. NEXCOM Platform Threat Model

NEXCOM is exposed to the following deepfake-related threat vectors given its architecture:

**High-risk surfaces:**
- KYC onboarding (document upload + selfie liveness check)
- Large cash withdrawal approval flow
- Cooperative bulk listing authorisation (high-value commodity lots)
- Admin KYC review and approval decisions
- Broker/Market Maker onboarding (regulatory document submission)

**Medium-risk surfaces:**
- Trade order confirmation for large orders (> 10× user's 30-day average)
- Settlement dispute resolution (evidence submission)
- Warehouse receipt pledge/unpledge (collateral manipulation)

---

## 3. Mitigations Already Implemented on NEXCOM

The following controls are already live in the platform:

| Control | Implementation | Location |
|---|---|---|
| **Withdrawal challenge** | Typed name + date challenge required above ₦500k threshold | `WithdrawalChallengeModal.tsx`, `withdrawalVerificationRouter.ts` |
| **TOTP 2FA** | Time-based one-time password required for high-value actions | `TotpSetup.tsx`, `totp_secrets` table |
| **Velocity limits** | Per-user daily/weekly withdrawal caps enforced server-side | `VelocityLimits.tsx`, `velocityLimitsRouter.ts` |
| **IP allowlist** | Per-scope CIDR allowlist for admin and liquidation actions | `IpAllowlist.tsx`, `ipAllowlistRouter.ts` |
| **Security event webhooks** | Outbound HTTP POST for HIGH/CRITICAL security events | `WebhookConfig.tsx`, `webhookConfigsRouter.ts` |
| **Anomalous order detection** | Orders > 10× user's 30-day average flagged automatically | `amlRouter.ts` (AML rules engine) |
| **Admin audit log** | All admin actions logged with reviewer, timestamp, decision | `kycAuditLog` table, `kycAudit.getLog` procedure |
| **Device session management** | Active sessions listed; remote logout available | `DeviceSessions.tsx`, `deviceSessionsRouter.ts` |
| **Suspicious login alert** | New IP/device triggers in-app notification | `securityAuditLog` table |

---

## 4. Recommended Additional Controls

### 4.1 Liveness Detection for KYC Document Upload

**Risk:** Document deepfakes bypass static image checks.  
**Recommendation:** Integrate a liveness detection API (e.g., iProov, Onfido, or Smile Identity for Nigerian market) into the KYC onboarding flow. Require a real-time selfie video challenge (blink, turn head) before accepting identity documents.  
**Priority:** High — affects all 5 stakeholder types.

### 4.2 Out-of-Band Confirmation for Large Withdrawals

**Risk:** Deepfake voice/video call convinces an operator to approve a withdrawal.  
**Recommendation:** For withdrawals above ₦5 million, require a second-factor confirmation via a **different channel** (SMS OTP to registered phone, or email magic link). The current typed-name challenge is a good first layer but is insufficient alone against a sophisticated social engineering attack.  
**Priority:** High.

### 4.3 AI-Generated Document Detection

**Risk:** AI-generated NIN slips, BVN documents, and corporate registration certificates are visually indistinguishable from genuine documents.  
**Recommendation:** Integrate a document authenticity API (e.g., Veriff, Jumio, or NIMC's verification API for NIN) that cross-checks submitted document data against government databases rather than relying on visual inspection alone.  
**Priority:** High for Farmer/Trader KYC; Medium for Broker/Market Maker.

### 4.4 Deepfake-Resistant Video KYC

**Risk:** Video KYC sessions can be spoofed with real-time deepfake tools.  
**Recommendation:** Use a certified liveness detection provider that runs challenge-response tests (random head movements, lighting changes) and embeds cryptographic proof of the session. Avoid static photo-based KYC for high-value stakeholders (Brokers, Market Makers).  
**Priority:** Medium — implement for Broker and Market Maker onboarding first.

### 4.5 Cooperative Bulk Listing Dual Authorisation

**Risk:** A compromised cooperative admin account could trigger bulk listings for hundreds of farmers simultaneously.  
**Recommendation:** Require a second cooperative admin to countersign bulk listings above a configurable threshold (e.g., > 50 members or > ₦10 million aggregate value). Implement a `bulkListingApproval` workflow with a pending state.  
**Priority:** Medium.

### 4.6 Periodic Re-KYC for High-Value Users

**Risk:** A legitimate account is taken over after initial KYC approval.  
**Recommendation:** Require re-KYC every 12 months for Traders, Brokers, and Market Makers with > ₦50 million in annual trading volume. Trigger re-KYC automatically based on the `kycApprovedAt` timestamp.  
**Priority:** Medium.

### 4.7 Deepfake Awareness Training for Admin Staff

**Risk:** Human reviewers in the KYC approval queue are the last line of defence.  
**Recommendation:** Conduct quarterly training sessions for all admin staff on identifying deepfake documents and synthetic media. Establish a "second opinion" protocol for any KYC submission that triggers uncertainty.  
**Priority:** Low (operational, not technical).

---

## 5. Incident Response Playbook

In the event of a suspected deepfake-enabled fraud attempt:

1. **Immediate:** Suspend the affected user account via `admin.suspendUser` and revoke all active sessions via `deviceSessions.adminRevokeAll`.
2. **Within 1 hour:** File a Suspicious Activity Report (SAR) via the AML module (`aml.fileSar`). Notify the platform owner via `system.notifyOwner`.
3. **Within 24 hours:** Escalate to the Nigerian Financial Intelligence Unit (NFIU) if the amount exceeds ₦5 million. Preserve all evidence (uploaded documents, IP logs, session replays) in the `securityAuditLog`.
4. **Within 72 hours:** Conduct a root cause analysis and update IP allowlists, velocity limits, and withdrawal thresholds as appropriate.
5. **Post-incident:** Review and update this document with lessons learned.

---

## 6. Regulatory Compliance Notes

NEXCOM operates under the oversight of the Securities and Exchange Commission (SEC) Nigeria and is subject to:

- **NFIU AML/CFT Regulations 2022** — requires transaction monitoring and SAR filing for suspicious transactions.
- **CBN KYC Manual 2023** — requires identity verification for all financial service customers.
- **NDPC Data Protection Regulation 2023** — requires data minimisation and breach notification within 72 hours.

The deepfake controls described above directly support compliance with all three frameworks by strengthening identity assurance and transaction monitoring.

---

*This document should be reviewed and updated quarterly by the NEXCOM Platform Security Team.*
