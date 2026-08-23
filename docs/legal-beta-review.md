# NOVELIGHT β legal review

Reviewed: 2026-08-23

This document records the implementation basis and the remaining release work for the beta legal surfaces. It is an engineering/operations checklist, not a substitute for advice from a qualified Japanese attorney.

## Implemented public surfaces

- `terms.html`: service terms, author rights, platform license, exposure/result disclaimer, prohibited conduct, moderation, AI rules, billing references.
- `privacy.html`: collected data, purposes, processors, visitor-token analytics, support-inquiry data, payment identifiers, security, retention, data-subject requests.
- `content-guidelines.html`: rights, prohibited content, AI classification, abuse/visibility manipulation rules, beta adult-content rule.
- `billing-policy.html`: monthly renewal, plan changes, cancellation, payment failure, refund baseline.
- `commerce-disclosure.html`: 特定商取引法 disclosure draft and legal-information request route.
- `contact.html`: public support/legal request form. Raw inquiries are stored privately in Supabase and are not client-readable.
- `signup.html`: explicit checkbox consent and live links to terms/privacy/content guidelines.
- `pricing.html`: recurring-subscription notice, cancellation/refund/legal links before Stripe checkout.

## Official references checked

### 特定商取引法 / recurring subscription disclosure

- Consumer Affairs Agency, 通信販売広告Q&A:
  https://www.no-trouble.caa.go.jp/qa/advertising.html
  - Individual operators must normally disclose the legal name rather than only a trade/site name.
  - Name/address/phone may be omitted from the advertisement only when the page states that the information will be provided without delay upon request and the operator has a real mechanism to do so in time for the purchase decision.
- Consumer Affairs Agency, 定期購入・最終確認画面:
  https://www.caa.go.jp/policies/policy/consumer_transaction/amendment/2021/notice03/
  - The final confirmation screen must clearly present key contract terms such as price/payment and cancellation conditions.

### 個人情報保護法

- Personal Information Protection Commission, Guidelines (general rules):
  https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/
  - Purposes should be specific and disclosed/notified.
  - Direct collection through web forms should make purposes reasonably visible.
- Personal Information Protection Commission, APPI Q&A:
  https://www.ppc.go.jp/personalinfo/faq/APPI_QA/
- Personal Information Protection Commission, foreign handling guidance:
  https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/

### Stripe / content restrictions

- Stripe, prohibited/restricted businesses FAQ (Japanese):
  https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs?locale=ja-JP
  - Stripe currently states that businesses offering adult content/services are unsupported, including sexually explicit literature/materials designed for sexual gratification.

## Decisions confirmed on 2026-08-23

### Adult-content beta rule — APPROVED

The owner explicitly approved the following beta rule:

- Sexually explicit/pornographic content whose primary purpose is sexual gratification is prohibited while NOVELIGHT relies on Stripe.
- Mature themes that are not in that prohibited category are not blanket-banned; warnings, age/content notices, and zoning should be used where appropriate.
- External law, payment-provider, hosting-provider, and other platform rules override the general zoning policy when necessary.

This is the concrete beta interpretation of MASTER section 30 and should be kept synchronized with MASTER and the public content guidelines.

### Legal/contact request channel — IMPLEMENTED

`contact.html` submits through `submit_contact_inquiry` into `public.contact_inquiries`.

Security/operations rules:

- Anonymous/authenticated clients have no direct SELECT/INSERT/UPDATE/DELETE access to raw inquiry rows.
- Public submission is only through a validated SECURITY DEFINER RPC.
- The RPC validates field lengths/email format, uses a honeypot, and rate-limits repeated submissions.
- Only a one-way visitor-token hash is stored for rate limiting; the raw token is not stored in the inquiry table.
- The 特商法 page directs legal-information requests to this form.
- Until automatic support notifications are added, the operator must check new inquiries frequently enough to answer legal-information requests without delay. For public beta, checking at least daily is the minimum operational baseline; legal-information requests should be prioritized immediately when discovered.

## Remaining release work before public beta

1. **Qualified Japanese legal review — strongly recommended**
   - Have a Japanese lawyer review the final terms/privacy/billing/commerce disclosure once the exact beta launch state is fixed.
   - Especially confirm consumer-contract limitation clauses, refund wording, minors, privacy requests, and the 特商法 disclosure/checkout flow.

2. **Footer/global discoverability**
   - Signup, pricing, privacy, commerce disclosure, and contact flows expose legal links.
   - Add legal/contact links to the global footer during the final NOVELIGHT branding/mobile pass so the documents are reachable from all major pages.

3. **Support operations hardening**
   - Before the beta grows beyond the initial controlled cohort, add notification/triage for new support inquiries so legal requests do not depend on manual Supabase checks.

## Notes

- Do not claim that paid exposure guarantees views, favorites, ratings, rankings, sales, or publication.
- Do not store raw card numbers in NOVELIGHT. Stripe handles card details.
- Keep privacy documentation aligned with actual data flows whenever analytics, advertising, email, moderation, or new processors are added.
