# NOVELIGHT β legal review

Reviewed: 2026-08-28

This document records the implementation basis and remaining release work for the beta legal surfaces. It is an engineering/operations status document, not legal advice and not a substitute for review by qualified Japanese counsel.

## Review status

- Qualified Japanese counsel review: **DEFERRED BY OWNER UNTIL AFTER CONTROLLED BETA LAUNCH / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- Public-beta legal GO: **NOT YET RECORDED — final release observations and non-deferred hard gates remain**.
- Current baseline revision for this review: `39d75d8f6022587c5ce35c7bc63cb7b76ec4e933`.

The current counsel handoff is `docs/LEGAL-COUNSEL-HANDOFF-2026-08-28.md` and remains available for later use.

## Implemented public surfaces

- `terms.html`: service terms, author rights, platform license, exposure/result disclaimer, prohibited conduct, moderation, AI rules, billing references.
- `privacy.html`: collected data, purposes, processors, visitor-token analytics, support-inquiry data, payment identifiers, security, retention, data-subject requests.
- `content-guidelines.html`: rights, prohibited content, AI classification, abuse/visibility-manipulation rules, beta adult-content rule.
- `billing-policy.html`: monthly renewal, plan changes, cancellation, payment failure, refund baseline, and the live billing/support contact route.
- `commerce-disclosure.html`: 特定商取引法 disclosure draft and legal-information request route.
- `contact.html`: public support/legal request form; raw inquiries are stored privately and are not ordinary-client readable.
- `signup.html`: explicit checkbox consent and live links to terms/privacy/content guidelines.
- `pricing.html`: recurring-subscription notice, cancellation/refund/legal links before Stripe Checkout.
- `api/_lib/checkout.js`: Stripe Checkout custom text with recurring-contract details by paid plan.
- `index.html`: top-page links to the public legal/contact surfaces.

The final claim that every intended public surface exposes all required legal/contact links remains a **final-candidate read-only observation**, not something inferred from an older checklist checkbox.

## Legal-copy implementation status

The current implementation includes the following aligned paid-plan disclosures:

- Standard: 980円/月; Premium: 1,980円/月;
- monthly recurring contract;
- automatic renewal until cancellation with no renewal-count cap;
- initial charge at application completion;
- one-year payment estimates (Standard 11,760円 / Premium 23,760円) stated as estimates rather than one-year contract terms;
- service availability after payment/contract-state confirmation;
- cancellation through Stripe Customer Portal;
- refund/no-proration baseline with legal/duplicate-charge/major NOVELIGHT billing-failure exceptions;
- parental/legal-representative consent wording for paid subscription by minors;
- explicit statement that paid exposure does not guarantee views, ratings, rankings, revenue, or publication.

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

Existing successful Production Authenticated Smoke evidence remains accepted as `current` for its proved scope under `docs/EVIDENCE-FRESHNESS-GATE.md`. Later main changes do not by themselves require another Production execution.

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

A freshness comparison through the review baseline found no material change to the decisive webhook-handler boundary that would invalidate that proof. Therefore the same Production proof **must not be repeated merely because `main` advanced**.

## Official-reference baseline

The engineering review has used the following official sources as implementation inputs. Their presence does not establish compliance:

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

## Final release observations before controlled beta

The owner decision above changes the timing of qualified-counsel review but does not automatically declare the beta ready. Before recording controlled public-beta GO:

1. apply Evidence Freshness analysis only to scopes actually affected by later changes;
2. confirm the latest Supabase Production backup/recovery point through the approved read-only route;
3. perform final read-only Production observation of legal/public surfaces and intended legal/contact links;
4. refresh `docs/BETA-RELEASE-EVIDENCE-LATEST.md` against the then-current final candidate;
5. resolve any truly unknown non-deferred hard checklist item using current evidence rather than historical unchecked boxes;
6. record controlled public-beta GO only when every non-deferred hard gate is satisfied and the deferred-counsel status remains explicit.

Production/Secret/Stripe live/Supabase Production/Vercel Production mutations remain approval-gated. Existing current Staging/Production proofs are not to be repeated for convenience.