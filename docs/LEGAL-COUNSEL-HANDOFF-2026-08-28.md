# NOVELIGHT β — Qualified Japanese Counsel Handoff

Prepared: 2026-08-28 JST

Base revision: `0ba72358b5213ff409aed2fca24e3af7bf1ff025`

This document is a factual engineering/operations handoff for qualified Japanese counsel. It is **not legal advice** and does not itself establish compliance.

It supersedes the technical-status portions of `docs/LEGAL-REVIEW-PACKET-2026-08-26.md` where later same-scope evidence exists. The older dated packet remains useful for background and the original legal question set.

## 1. Current gate state

| Scope | Freshness | Current state |
| --- | --- | --- |
| Current `main` | `current` | `0ba72358b5213ff409aed2fca24e3af7bf1ff025` |
| CI | `current` | run #833, success |
| CodeQL | `current` | run #773, success |
| Staging product/auth/billing lifecycle | `current` | Staging Smoke #98 / run `33135672826`, success |
| Production Authenticated Smoke | `current` | existing successful proof remains accepted; do not repeat solely because `main` advanced |
| Production external Stripe webhook proof | `current` | run `33065836764`, proof SHA `944c2232a577ebeae32798c29a508b8540a26807`; no-charge live-event proof and final audit succeeded |
| Legal-copy implementation | `current` | merged and covered by regression tests |
| Qualified Japanese counsel review | `unknown / open hard gate` | not completed |
| Owner residual-risk decision | `unknown / not recorded` | not a substitute for identifying legal requirements |
| Public-beta legal GO | `unknown / not recorded` | fail closed |
| Final Production legal/public-surface observation | `refresh-required at final candidate` | perform read-only immediately before GO |
| Latest Production backup/recovery-point observation | `refresh-required at final candidate` | perform immediately before GO |
| `docs/BETA-RELEASE-EVIDENCE-LATEST.md` | `refresh-required` | rolling index still names older main and should be refreshed only at the final release-evidence stage |

The technical scopes marked `current` above must not be re-executed merely to make the SHA look newer. Apply `docs/EVIDENCE-FRESHNESS-GATE.md`: invalidate only after a material same-scope change.

## 2. Launch-state public legal surfaces

Counsel should review the actual launch-state files, not only this summary:

- `terms.html`
- `privacy.html`
- `content-guidelines.html`
- `billing-policy.html`
- `commerce-disclosure.html`
- `pricing.html`
- `signup.html`
- `contact.html`
- `api/_lib/checkout.js`
- `docs/legal-beta-review.md`
- `docs/LEGAL-REVIEW-PACKET-2026-08-26.md`
- `docs/BETA-OPERATIONS-RUNBOOK.md`
- relevant sections of `docs/NOVELIGHT-MASTER.md`

Current implementation includes:

- author copyright remains with the author;
- a non-exclusive platform license for operation/display/search/recommendation/announcement/backup and rights-abuse handling;
- paid plans sell additional discovery opportunities and analytics, not guaranteed ratings, rankings, readers, revenue, or publication;
- explicit signup consent to terms/privacy/content guidelines;
- recurring-contract disclosures before Checkout and in Stripe Checkout custom text;
- monthly price, automatic renewal, no renewal-count cap, initial payment timing, one-year payment estimate, cancellation/refund baseline, and minor-consent wording;
- a public commerce-disclosure page and a dedicated legal-information request category in `contact.html`;
- beta content rules that prohibit sexually explicit/pornographic material whose primary purpose is sexual gratification while Stripe is used, while retaining zoning/warnings for other mature themes;
- private support/moderation data handling rather than exposing raw inquiry/report rows to ordinary clients.

## 3. P0 questions for qualified Japanese counsel

Please classify every finding as `BLOCKER`, `HIGH`, `MEDIUM`, or `LOW`, identify the affected file/section, and provide either proposed wording or an operational requirement.

### A. 特定商取引法 / operator disclosure

1. Given NOVELIGHT's **actual operator form and launch circumstances**, may legal name/operator name, address and phone be omitted from direct web display and supplied without delay on request?
2. Is the wording and placement in `commerce-disclosure.html` sufficient?
3. Is the request mechanism in `contact.html` sufficient for a user to obtain the information with enough time before deciding to purchase?
4. What response target/SLA should operations follow?
5. What exact operator information must be supplied privately to counsel before this can be answered conclusively?

Private facts must **not** be committed to the public repository. Provide them to counsel through a secure channel.

### B. Recurring subscription / final confirmation

1. Does the combined path `pricing.html -> NOVELIGHT checkout-session creation -> Stripe hosted Checkout` satisfy Japanese recurring-purchase disclosure/final-confirmation requirements for the actual Standard/Premium configuration?
2. Are price, initial charge timing, monthly renewal, indefinite continuation until cancellation, annual payment estimate, service-start timing, cancellation, refund baseline and minor-consent information shown at the right time and with sufficient prominence?
3. Which facts, if any, must be displayed by NOVELIGHT itself rather than relying on Stripe-hosted UI?
4. Does the current Checkout custom text in `api/_lib/checkout.js` create any ambiguity or missing mandatory disclosure?

### C. Refunds, cancellation and contract changes

1. Is the current no-proration/no-refund baseline lawful and appropriately qualified?
2. What mandatory exceptions should be written explicitly rather than handled only operationally?
3. Should cancellation effectiveness, access through the paid period, plan changes and failed-payment handling be more precise?
4. If Stripe Portal wording and NOVELIGHT documents differ, what hierarchy or conflict rule is appropriate?

### D. Consumer Contract Act / liability

Review `terms.html` for:

- disclaimer and limitation-of-liability wording;
- exclusion for intentional misconduct/gross negligence and other non-waivable liability;
- service, price and exposure-logic changes;
- external-service failures and data loss;
- paid exposure being an opportunity rather than an outcome guarantee.

Identify any clause that is too broad, ineffective, misleading or likely to require rewriting before beta.

### E. Minors

1. Is the current distinction between free registration and paid subscription sufficient?
2. Is parental/legal-representative consent wording sufficient for paid plans?
3. Does beta need a minimum age, age declaration, stronger parental-consent mechanism, or purchase-flow control?
4. How should minor-cancellation risk interact with mature-content zoning?

### F. APPI / privacy / processors

Review `privacy.html` against actual flows and determine whether the current descriptions are sufficient for:

- account email/display name/profile;
- posted works/episodes/AI-use classification/content warnings;
- plan/payment state and Stripe customer/subscription identifiers;
- exposure, work-page arrival, reading, favorite, LIGHT SEED and revisit events;
- UTM, first landing path and referrer host;
- reports and support inquiries;
- IP/device/access/security information processed through service providers;
- Cookie/Local Storage/visitor-token based measurement;
- Supabase, Vercel and Stripe processing, including overseas handling where applicable;
- retention periods;
- data-subject access/correction/deletion/restriction procedures;
- the information that must be made available under APPI for the personal-information handling business operator.

Please identify where a generic retention statement is insufficient and where category-specific periods or a retention schedule are required.

### G. UGC / copyright / moderation

1. Is the non-exclusive platform license sufficiently scoped and durable for hosting, display, recommendation, backup and abuse/rightsholder handling?
2. Is the uploader rights warranty sufficient?
3. What notice-and-takedown, evidence-preservation, counter-notice/appeal, repeat-infringer or emergency procedure should exist before beta?
4. Are the current moderation powers — warning, zoning change, exposure stop, unpublishing, deletion, feature restriction, account suspension — sufficiently documented?
5. Is any additional Japanese intermediary/provider-liability procedure required for this controlled beta?

### H. Mature content / payment-provider boundary

Review consistency between `content-guidelines.html`, `pricing.html`, MASTER policy and Stripe constraints. Confirm whether the current beta prohibition and zoning boundary is adequate, and identify any category that must be more explicit before launch.

### I. AI-assisted/generated works

Review whether the present AI classification and uploader responsibility need stronger provisions concerning copyright, third-party rights, similarity, training-source claims, misrepresentation or mass-generated abuse.

### J. Governing law, jurisdiction and dispute handling

Review the current Japan-law clause and the statement that jurisdiction will be determined under Japanese law. State whether a more specific forum/jurisdiction clause is advisable and enforceable for the intended beta users.

## 4. Data-processing inventory for review

This table is an engineering summary only. Counsel should validate it against the underlying implementation and determine the legal characterization and required disclosures.

| Data / event | Main purpose described today | Primary system / processor | Public user access to raw data |
| --- | --- | --- | --- |
| Email, auth state | registration, login, account recovery | Supabase Auth | own account/session only |
| Display name/profile | user/account presentation | Supabase | service-dependent public/profile display |
| Works/episodes/content classification | publishing and discovery | Supabase | published content as designed |
| Stripe customer/subscription IDs and plan state | billing and entitlement reconciliation | Stripe + Supabase | not general raw access |
| Exposure / work view / reading / favorite / retention signals | LIGHT ANALYTICS, product improvement, discovery measurement | Supabase + client instrumentation | authors receive intended aggregates, not raw platform ledgers |
| UTM / landing path / referrer host | acquisition measurement | client + Supabase | no general raw access |
| Visitor token / derived identifier | anonymous measurement and anti-abuse/rate-limit support | browser storage + derived server-side values where applicable | raw private ledgers not exposed |
| Content reports | moderation and safety | Supabase | raw reports not ordinary-client readable |
| Contact inquiries | support, billing, privacy, legal requests | Supabase | raw inquiries not ordinary-client readable |
| IP/device/access/security logs | hosting/auth/security operations | service providers including Vercel/Supabase | provider/operator scope |
| Card number | payment processing | Stripe | NOVELIGHT does not store raw card numbers by design |

## 5. UGC moderation flow for review

Current engineering/operations flow:

1. User reports content through the work/episode reporting path or uses `contact.html` for matters unsuitable for the structured report UI.
2. The report/inquiry is stored in a private Supabase-backed path.
3. Ordinary clients cannot directly read raw report/inquiry rows.
4. Operations monitor new work and prioritize legal/payment/safety matters.
5. Depending on severity, NOVELIGHT may warn, alter zoning, stop exposure, unpublish, delete, restrict features or suspend the account.
6. Emergency law/payment/hosting-provider requirements may justify action without prior notice.

Counsel should specify any missing mandatory steps for copyright/privacy complaints, identity verification, evidence retention, user notice, appeal/counter-notice, repeated violations and emergency escalation.

## 6. Information counsel needs from the owner outside GitHub

Provide securely, not in the public repository:

- actual legal/operator identity and whether operation is individual or entity-based;
- exact address and phone intended for statutory disclosure;
- planned response method and practical response time for legal-information requests;
- intended beta audience/minimum-age position, if any;
- any operator-side retention policy not represented in code/docs;
- any planned email, external analytics, advertising or processor not already documented;
- any facts counsel requests to determine 特商法/APPI obligations.

## 7. Required counsel output format

For each finding, request this structure:

| Field | Expected value |
| --- | --- |
| Severity | `BLOCKER / HIGH / MEDIUM / LOW` |
| Legal topic | e.g. 特商法 / APPI / Consumer Contract Act / UGC |
| Affected file/flow | exact page, clause or operation |
| Problem | concise legal/operational issue |
| Required before beta? | `yes / no / conditional` |
| Proposed wording or requirement | concrete text or operational control |
| Residual risk after fix | concise description |

At minimum, counsel should explicitly state whether there is any unresolved `BLOCKER` or `HIGH` item preventing public beta.

## 8. Owner residual-risk decision — separate gate

A qualified-counsel review and an owner residual-risk decision are different controls.

Counsel determines the legal issues and recommended/required remediation. The owner decides whether to accept **remaining** risk after those issues are understood and after mandatory fixes are completed.

An owner decision must not be used to treat an unlawful requirement as satisfied. For NOVELIGHT's paid subscription + UGC + minors + personal-data + Stripe scope, the preferred release path is:

`qualified counsel review -> fix BLOCKER/HIGH as required -> verify affected surfaces -> record remaining risk -> owner accepts/rejects residual risk -> legal GO`.

Record only non-sensitive metadata in the repository:

- counsel review date;
- qualification verified: yes/no;
- BLOCKER count;
- HIGH count;
- pre-beta required fixes completed: yes/no/date;
- residual-risk summary without privileged/private detail;
- owner decision date;
- legal GO: `GO / CONDITIONAL GO / NO-GO`.

## 9. What remains after legal P0

Do **not** reopen current technical proofs without an Evidence Freshness invalidation reason.

After legal P0 is resolved and any required legal changes are merged:

1. re-evaluate evidence freshness for only the affected scopes;
2. confirm the latest Supabase Production backup/recovery point using the approved read-only route;
3. perform final read-only Production observation of legal/public surfaces;
4. refresh `docs/BETA-RELEASE-EVIDENCE-LATEST.md` to the then-current final candidate and attach the decisive evidence;
5. resolve any genuinely unknown hard checklist item through current evidence rather than historical checkbox state;
6. record final beta GO only if every hard gate is satisfied.

Production/Secret/Stripe live/Supabase Production/Vercel Production mutation remains approval-gated. Existing current Production and Staging smoke/proof operations must not be repeated for documentary convenience.