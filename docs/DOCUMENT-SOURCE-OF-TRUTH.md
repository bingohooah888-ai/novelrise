# NOVELIGHT Document Source of Truth Registry

**STATUS: CURRENT**

This file is the machine-readable registry for formal NOVELIGHT documentation. The JSON block between the fixed markers is authoritative for document status selection. Human prose, filenames, dates, chat history, local copies, and Git timestamps must not override it.

<!-- NOVELIGHT_DOCUMENT_REGISTRY_BEGIN -->
```json
{
  "schemaVersion": 1,
  "registryStatus": "CURRENT",
  "registryPath": "docs/DOCUMENT-SOURCE-OF-TRUTH.md",
  "masterPath": "docs/NOVELIGHT-MASTER.md",
  "normalFlow": ["fresh-origin-main", "fast-registry-check", "work"],
  "startupRequiredCurrent": [
    "docs/NOVELIGHT-MASTER.md",
    "docs/WORK-EXECUTION-PREFLIGHT.md",
    "docs/EXECUTION-TURN-CARD-GATE.md",
    "docs/EVIDENCE-FRESHNESS-GATE.md",
    "docs/IMAGE-EXECUTION-GATE.md",
    "AGENTS.md",
    "docs/CODEX-FIRST-EXECUTION-GATE.md",
    "docs/development-workflow.md",
    "docs/DOCUMENT-FRESHNESS.md",
    "docs/DOCUMENT-SOURCE-OF-TRUTH.md"
  ],
  "deleteCandidates": [],
  "holdCandidates": [],
  "documents": [
    {"path":"AGENTS.md","status":"CURRENT","role":"repository-agent-contract","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/AUTOMATION-CONTINUATION-GATE.md","status":"CURRENT","role":"automation-continuation-gate","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BACKUP-RESTORE-RUNBOOK.md","status":"CURRENT","role":"production-backup-restore-runbook","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BETA-DATA-FOUNDATIONS.md","status":"CURRENT","role":"beta-data-foundations","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BETA-OPERATIONS-RUNBOOK.md","status":"CURRENT","role":"beta-operations-runbook","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BETA-RELEASE-CHECKLIST.md","status":"CURRENT","role":"beta-release-checklist","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":["docs/BETA-RELEASE-DECISION-2026-08-28.md"]},
    {"path":"docs/BETA-RELEASE-DECISION-2026-08-28.md","status":"ARCHIVED","role":"beta-release-decision-history","singletonRole":false,"classification":"ARCHIVE_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BETA-RELEASE-EVIDENCE-2026-08-23.md","status":"ARCHIVED","role":"beta-release-evidence-snapshot","singletonRole":false,"classification":"ARCHIVE_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BETA-RELEASE-EVIDENCE-2026-08-26.md","status":"ARCHIVED","role":"beta-release-evidence-snapshot","singletonRole":false,"classification":"ARCHIVE_CANDIDATE","historicalReferences":[]},
    {"path":"docs/BETA-RELEASE-EVIDENCE-LATEST.md","status":"CURRENT","role":"beta-release-evidence-current","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":["docs/BETA-RELEASE-DECISION-2026-08-28.md"]},
    {"path":"docs/CHAT-HANDOFF-PREFLIGHT.md","status":"CURRENT","role":"chat-handoff-preflight","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/CODEX-FIRST-EXECUTION-GATE.md","status":"CURRENT","role":"codex-first-gate","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/DOCUMENT-FRESHNESS.md","status":"CURRENT","role":"document-freshness-policy","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/DOCUMENT-SOURCE-OF-TRUTH.md","status":"CURRENT","role":"document-source-of-truth-registry","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/EVIDENCE-FRESHNESS-GATE.md","status":"CURRENT","role":"external-evidence-freshness-gate","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/EXECUTION-TURN-CARD-GATE.md","status":"CURRENT","role":"execution-turn-card-gate","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/IMAGE-EXECUTION-GATE.md","status":"CURRENT","role":"image-execution-gate","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/LEGAL-COUNSEL-HANDOFF-2026-08-28.md","status":"CURRENT","role":"legal-counsel-current-handoff","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":["docs/LEGAL-REVIEW-PACKET-2026-08-26.md"]},
    {"path":"docs/LEGAL-REVIEW-PACKET-2026-08-26.md","status":"ARCHIVED","role":"legal-review-packet-history","singletonRole":false,"classification":"ARCHIVE_CANDIDATE","historicalReferences":[]},
    {"path":"docs/MECHANICAL-CORRECTION-POLICY.md","status":"CURRENT","role":"mechanical-correction-policy","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/NOCTER-IMAGE-TOOL-GUARD.md","status":"CURRENT","role":"nocter-image-tool-guard","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/NOCTER-PREFLIGHT.md","status":"CURRENT","role":"nocter-preflight","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/NOCTER-VISUAL-GUIDE.md","status":"CURRENT","role":"nocter-visual-guide","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/NOVELIGHT-ADMIN.md","status":"CURRENT","role":"admin-guide","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/NOVELIGHT-MASTER.md","status":"CURRENT","role":"master","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/PREVIEW-STAGING-AUTOMATION.md","status":"CURRENT","role":"preview-staging-automation","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/PRODUCTION-BILLING-INCIDENT-RUNBOOK.md","status":"CURRENT","role":"production-billing-incident-runbook","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/PRODUCTION-CHAT-DISPATCH.md","status":"CURRENT","role":"production-chat-dispatch","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/STAGING-MIGRATION-SYNC.md","status":"CURRENT","role":"staging-migration-sync","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/STAGING-RUNBOOK.md","status":"CURRENT","role":"staging-runbook","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/STRIPE-PRODUCTION-BOOTSTRAP.md","status":"CURRENT","role":"stripe-production-bootstrap","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/SUPABASE-PRODUCTION-DEPLOY.md","status":"CURRENT","role":"supabase-production-deploy","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/WORK-EXECUTION-PREFLIGHT.md","status":"CURRENT","role":"work-execution-preflight","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/development-workflow.md","status":"CURRENT","role":"development-workflow","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/exposure-allocation-beta-v2.md","status":"CURRENT","role":"exposure-allocation-current","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/exposure-allocation-beta.md","status":"SUPERSEDED","role":"exposure-allocation-current","singletonRole":false,"classification":"SUPERSEDED_CANDIDATE","supersededBy":"docs/exposure-allocation-beta-v2.md","historicalReferences":[]},
    {"path":"docs/legal-beta-review.md","status":"CURRENT","role":"legal-beta-current-status","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":["docs/BETA-RELEASE-DECISION-2026-08-28.md","docs/LEGAL-REVIEW-PACKET-2026-08-26.md"]},
    {"path":"docs/main-branch-protection.md","status":"CURRENT","role":"main-branch-protection","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]},
    {"path":"docs/master-management.md","status":"CURRENT","role":"master-management","singletonRole":true,"classification":"CURRENT_CANDIDATE","historicalReferences":[]}
  ]
}
```
<!-- NOVELIGHT_DOCUMENT_REGISTRY_END -->

Rules and audit behavior are defined in `docs/DOCUMENT-FRESHNESS.md`.
