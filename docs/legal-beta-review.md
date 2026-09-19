# NOVELIGHT β legal review

Reviewed: 2026-09-20

This document records the implementation basis and release status for the beta legal surfaces. It is an engineering/operations status document, not legal advice and not a substitute for review by qualified Japanese counsel.

## Review status

- Qualified Japanese counsel review: **DEFERRED BY OWNER UNTIL AFTER CONTROLLED BETA LAUNCH / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- Controlled public-beta GO: **RECORDED 2026-08-28** in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.
- Decision baseline revision: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.
- Current 2026-09-20 recovery posture: **the backup/restore recovery blocker is cleared**. The fresh disposable restore, current-schema replay, structural/RLS/RPC/data-restoration checks, cleanup, and cost-stop verification are complete. Supabase's provider-defined non-database Auth settings/API-key reconfiguration is now treated as a fail-closed service-reopen step rather than missing backup content. Future launch cutovers remain separately operationally gated. This is an engineering/recovery finding, not a legal-sufficiency finding.

The current counsel handoff is `docs/LEGAL-COUNSEL-HANDOFF-2026-08-28.md` and remains available for later use.

The controlled-beta GO is an operational release decision under the explicitly accepted residual legal uncertainty. It is not a legal-sufficiency finding and does not convert the deferred counsel review into a completed gate.

## Implemented public surfaces

- `terms.html`: service terms, author rights, platform license, exposure/result disclaimer, prohibited conduct, moderation, AI rules, billing references.
- `privacy.html`: collected data, purposes, processors, visitor-token analytics, support-inquiry data, payment identifiers, security, retention, data-subject requests.
- `content-guidelines.html`: rights, prohibited content, AI classification, abuse/visibility-manipulation rules, beta adult-content rule.
- `billing-policy.html`: monthly renewal, plan changes, cancellation, payment failure, refund baseline, and the live billing/support contact route.
- `commerce-disclosure.html`: 特定商取引法 disclosure draft and legal-information request route.
- `contact.html`: public support/legal request form; raw inquiries are stored privately and are not ordinary-client readable.
- `signup.html`: explicit checkbox consent and live links to terms/privacy/content guidelines.
- `pricing.html`: recurring-subscription notice, cancellation/refund/legal links before Stripe Checkout.
- `api/_lib/checkout.js`: Premium Stripe Checkout custom text for the beta 480円/月 recurring contract; beta Standard uses the separate cardless 0円 activation path.
- `index.html`: top-page links to the public legal/contact surfaces.

Final-candidate read-only reachability was reconciled before GO using current Production surface evidence. This remains an engineering observation, not a legal conclusion.

## Legal-copy implementation status

The current beta implementation includes the following aligned pricing and paid-plan disclosures:

- Free: 0円/月;
- Standard: regular/formal price 980円/月, but **beta price 0円/月 with no credit-card registration and no charge**;
- Premium: regular/formal price 1,980円/月 and **beta special price 480円/月**;
- Premium is a monthly recurring contract and automatically renews until cancellation;
- Premium first charge occurs when the Stripe Checkout application completes;
- beta-end price-transition timing/conditions are disclosed as advance-notice items rather than silently converting the current beta terms;
- Premium availability follows payment/contract-state confirmation;
- Premium cancellation is available through Stripe Customer Portal;
- refund/no-proration baseline keeps legal/duplicate-charge/major NOVELIGHT billing-failure exceptions;
- parental/legal-representative consent wording applies to Premium subscription by minors;
- paid exposure does not guarantee views, ratings, rankings, revenue, or publication.

The older one-year payment-estimate wording is no longer part of the current public beta surfaces and is not treated as a current disclosure requirement in this engineering status document.

Regression coverage exists to keep Checkout/pricing/billing/commerce/privacy paid-plan wording aligned. Engineering alignment does not determine legal sufficiency.

## Decisions confirmed for beta

### Adult-content beta rule — APPROVED

- Sexually explicit/pornographic content whose primary purpose is sexual gratification is prohibited while NOVELIGHT relies on Stripe.
- Mature themes outside that prohibited category are not blanket-banned; warnings, age/content notices, and zoning are used where appropriate.
- Applicable law and payment/hosting/platform requirements override the general zoning policy where necessary.

This policy must remain synchronized with MASTER and `content-guidelines.html`.

### Qualified-counsel timing / residual-risk decision — OWNER APPROVED 2026-08-28

The owner has decided not to require qualified Japanese counsel review before the initial controlled beta launch. The review remains pending and its timing will be reconsidered after observing real beta usage, user acquisition, and whether continued operation justifies the external legal-review cost and effort.

The owner explicitly recognizes that launching the controlled beta before qualified counsel review leaves unresolved legal uncertainty. This is a release-risk/timing decision only. It is **not** a conclusion that the current terms, privacy policy, billing disclosures, commerce disclosure, content rules, consent flow, or operations are legally sufficient.

This decision also does not waive or override mandatory law, regulator requirements, court orders, payment-provider rules, hosting/platform requirements, or any legal issue that becomes known before or during beta. If a material legal concern is identified, the affected launch or feature must be reassessed rather than relying on this residual-risk decision as a substitute for compliance.

The later counsel review should still cover the launch-state terms, privacy policy, billing policy, commerce disclosure, content rules, signup consent, pricing/Checkout disclosures, contact route and relevant operations, including the topics listed below.

### Controlled public-beta release decision — GO RECORDED 2026-08-28

The final operational GO decision is recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md` after re-fetching the then-current main and applying the Evidence Freshness Gate.

The GO was based on all non-deferred hard checklist scopes being current or supported by still-valid decisive evidence, with no newly unknown non-deferred hard gate identified. The qualified-counsel exception remains explicit and unresolved.

The GO does not authorize unrelated Production database, Stripe live, Secret/environment, destructive, or other separately approval-gated operations.

## Legal/contact request channel — IMPLEMENTED

`contact.html` provides categories including:

- 特定商取引法に基づく表示事項の開示請求
- 課金・解約
- 投稿・作品
- プライバシー
- 不具合・技術的な問題
- その他

Current engineering/operations controls include validated submission, anti-abuse measures, private raw inquiry storage, and operator prioritization for legal/payment/safety matters. Qualified counsel review remains the preferred later mechanism for determining any required identity-verification, response-time, retention and escalation rules that cannot be established by engineering evidence alone.

## Support / moderation operations — IMPLEMENTED FOR CONTROLLED BETA

`docs/BETA-OPERATIONS-RUNBOOK.md` records the controlled-beta routine. Production monitoring uses read-only observation, copies counts rather than raw sensitive bodies into GitHub automation, and prioritizes legal/payment/safety work. If automated observation fails, the runbook requires manual fallback until repaired.

## Controlled technical evidence relevant to legal/billing review

The following is technical evidence, not a legal conclusion.

### Current Staging product/auth/billing lifecycle

Staging Smoke #98, run `33135672826`, succeeded against main `0ba72358b5213ff409aed2fca24e3af7bf1ff025` and covered:

- read-only Staging deployment contract;
- read-only product smoke;
- authenticated Staging credentials;
- write-capable Staging deployment contract;
- authenticated product smoke;
- authenticated-data cleanup;
- fresh ephemeral billing user creation;
- complete Stripe **test-mode** billing smoke;
- billing-data cleanup;
- temporary-fixture removal.

This scope remains accepted as `current` unless later material changes invalidate it under `docs/EVIDENCE-FRESHNESS-GATE.md`. Do not repeat it solely for documentary freshness.

### Production Authenticated Smoke

The current decisive authenticated Production proof is Issue #723 / run `35449741256`, bound to exact application SHA `c9eaefd9baa941d2f20699a29c8e9ac233b64196`. Approval claim, deployed-page convergence, authenticated beta-critical flow checks, ephemeral-data cleanup, and the matching consumed-approval success record all completed successfully.

This is engineering evidence only. It does not establish legal sufficiency and does not justify repeating Production write-capable smoke solely for documentary freshness.

### Current Production billing consistency

Production Billing Health run `35449744107` queried the deployed current billing guard and returned the expected guard version with `issueCodes=[]`, `warningCodes=[]`, and no approval-requiring remediation. The decisive live Stripe bootstrap/control run remains `33612120034`, which completed live object provisioning, Vercel variable synchronization, subscription transition, no-charge beta billing control proof, and final billing consistency audit.

No later decisive checkout/webhook/portal boundary change was identified that would require repeating the live Stripe operation merely for SHA freshness.

### Production external Stripe webhook delivery — PASS / CURRENT

The earlier 2026-08-26 statement that external Stripe -> Production webhook delivery remained open is superseded.

Decisive later evidence:

- workflow: `NOVELIGHT Chat-Mediated Production Approval`;
- run `33065836764`;
- proof SHA `944c2232a577ebeae32798c29a508b8540a26807`;
- workflow conclusion: `success`;
- approval ledger: issue `#165` records the request as consumed successfully;
- completion contract required a no-charge webhook proof and zero final billing-audit issues.

The scoped proof is:

`Stripe Live event creation without artificial paid charge -> Production Vercel webhook -> Production Supabase entitlement/cancellation reflection -> final billing audit`.

A freshness comparison through the GO decision baseline found no material change to the decisive webhook-handler boundary that would invalidate that proof. Therefore the same Production proof **must not be repeated merely because `main` advanced**.

## Official-reference baseline

The engineering review used the following official sources as implementation inputs. Their presence does not establish compliance:

### 特定商取引法 / recurring subscription

- Consumer Affairs Agency, 通信販売広告Q&A: https://www.no-trouble.caa.go.jp/qa/advertising.html
- Consumer Affairs Agency, 通信販売広告について: https://www.no-trouble.caa.go.jp/what/mailorder/advertising.php
- Consumer Affairs Agency, final-confirmation materials: https://www.caa.go.jp/policies/policy/consumer_transaction/amendment/2021/notice03/

### 個人情報保護法

- Personal Information Protection Commission, general guidelines: https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/
- APPI Q&A: https://www.ppc.go.jp/personalinfo/faq/APPI_QA/
- foreign handling guidance: https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/

### Stripe

- Japan commerce-disclosure guidance: https://support.stripe.com/questions/how-to-create-and-display-a-commerce-disclosure-page?locale=ja-JP
- prohibited/restricted-business FAQ: https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs?locale=ja-JP

## Deferred qualified-counsel review scope

Qualified Japanese counsel review remains **PENDING / DEFERRED**, not completed.

Primary topics for the later review remain:

- 特商法: whether on-request omission of legal name/address/phone is permitted for the actual operator and launch circumstances;
- recurring subscription/final confirmation: whether NOVELIGHT + Stripe hosted Checkout satisfies the actual Japanese disclosure requirements;
- Consumer Contract Act / liability: disclaimer, limitation, service-change and dispute provisions;
- refunds/cancellation: no-proration/no-refund baseline, mandatory exceptions, cancellation effect;
- minors: free registration, paid subscription and parental-consent handling;
- APPI/privacy: purposes, retention, overseas processors, security disclosures, data-subject rights, UTM/pseudonymous analytics, support/moderation data;
- UGC/copyright: platform license, takedown/report procedures, evidence preservation, appeals/counter-notice, repeat abuse and operator liability;
- mature content: consistency of Japanese-law, NOVELIGHT zoning and Stripe constraints;
- AI-assisted/generated works: rights warranty, disclosure and abuse boundaries;
- governing law/jurisdiction wording.

Counsel findings, when the review is commissioned, should be classified as `BLOCKER / HIGH / MEDIUM / LOW`, with affected file/flow and proposed wording or operational requirement.

## Final release observations — SATISFIED FOR GO 2026-08-28

Before GO, the release process:

1. applied Evidence Freshness analysis only to scopes actually affected by later changes;
2. confirmed Production backup/recovery freshness through the approved read-only workflow (`33172222421`);
3. reconciled final read-only Production legal/public-surface evidence (`NOVELIGHT Production Readiness Smoke` run `33145249649`);
4. refreshed `docs/BETA-RELEASE-EVIDENCE-LATEST.md`;
5. resolved the non-deferred checklist with no newly unknown hard item;
6. recorded controlled public-beta GO in `docs/BETA-RELEASE-DECISION-2026-08-28.md` while keeping deferred counsel status explicit.

If the launch state materially changes after this decision, only the affected scope must be refreshed under `docs/EVIDENCE-FRESHNESS-GATE.md`.

Production/Secret/Stripe live/Supabase Production/Vercel Production mutations remain separately approval-gated. Existing current Staging/Production proofs are not to be repeated for convenience.