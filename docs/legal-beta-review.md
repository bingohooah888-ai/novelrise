# NOVELIGHT β legal review

Reviewed: 2026-08-26

This document records the implementation basis and the remaining release work for the beta legal surfaces. It is an engineering/operations checklist, not legal advice and not a substitute for review by a qualified Japanese attorney.

## Review status

- Qualified Japanese counsel review: **PENDING**.
- Explicit owner decision to accept residual Japanese legal risk instead of counsel review: **NOT RECORDED**.
- Public-beta legal GO: **NOT YET RECORDED**.

## Implemented public surfaces

- `terms.html`: service terms, author rights, platform license, exposure/result disclaimer, prohibited conduct, moderation, AI rules, billing references.
- `privacy.html`: collected data, purposes, processors, visitor-token analytics, support-inquiry data, payment identifiers, security, retention, data-subject requests.
- `content-guidelines.html`: rights, prohibited content, AI classification, abuse/visibility manipulation rules, beta adult-content rule.
- `billing-policy.html`: monthly renewal, plan changes, cancellation, payment failure, refund baseline, and the live billing/support contact route.
- `commerce-disclosure.html`: 特定商取引法 disclosure draft and legal-information request route.
- `contact.html`: public support/legal request form. Raw inquiries are stored privately in Supabase and are not client-readable.
- `signup.html`: explicit checkbox consent and live links to terms/privacy/content guidelines.
- `pricing.html`: recurring-subscription notice, cancellation/refund/legal links before Stripe checkout.
- `index.html`: current top-page footer exposes terms, privacy, content guidelines, billing/cancellation, commerce disclosure, and contact links.

The top page and the legal surfaces were rechecked on 2026-08-26. A claim that every major product page has the full global legal-link set should still be treated as a separate final UI/release-checklist observation unless it is explicitly audited.

## Official references rechecked on 2026-08-26

### 特定商取引法 / recurring subscription disclosure

- Consumer Affairs Agency, 通信販売広告Q&A:
  https://www.no-trouble.caa.go.jp/qa/advertising.html
  - Individual operators normally need the legal name rather than only a trade/site name.
  - Name/address/phone may be omitted from the advertisement only when the advertisement states that the information will be provided without delay upon request and the operator has an actual mechanism to provide it in time for the purchase decision.
- Consumer Affairs Agency, 通信販売広告について:
  https://www.no-trouble.caa.go.jp/what/mailorder/advertising.php
- Consumer Affairs Agency material on final confirmation for mail-order subscriptions:
  https://www.caa.go.jp/policies/policy/consumer_transaction/amendment/2021/notice03/
  - The final confirmation must clearly present the contract information required by the applicable rules, including price/payment and cancellation-related conditions for recurring purchases.

### 個人情報保護法

- Personal Information Protection Commission, Guidelines (general rules):
  https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/
- Personal Information Protection Commission, APPI Q&A:
  https://www.ppc.go.jp/personalinfo/faq/APPI_QA/
  - Direct collection through a web input form generally requires the purpose of use to be made explicit, subject to statutory exceptions.
- Personal Information Protection Commission, foreign handling guidance:
  https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/

### Stripe / commerce disclosure / content restrictions

- Stripe, Commercial Disclosure guidance for Japan:
  https://support.stripe.com/questions/how-to-create-and-display-a-commerce-disclosure-page?locale=ja-JP
- Stripe, prohibited/restricted businesses FAQ (Japanese):
  https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs?locale=ja-JP
  - Stripe currently states that adult content/services are unsupported, including sexually explicit literature/materials designed for sexual gratification.

These references are implementation inputs only. Their presence here is not a legal-compliance determination.

## Decisions confirmed on 2026-08-23

### Adult-content beta rule — APPROVED

The owner explicitly approved the following beta rule:

- Sexually explicit/pornographic content whose primary purpose is sexual gratification is prohibited while NOVELIGHT relies on Stripe.
- Mature themes that are not in that prohibited category are not blanket-banned; warnings, age/content notices, and zoning should be used where appropriate.
- External law, payment-provider, hosting-provider, and other platform rules override the general zoning policy when necessary.

This is the concrete beta interpretation of MASTER section 30 and should be kept synchronized with MASTER and the public content guidelines.

## Legal/contact request channel — IMPLEMENTED

`contact.html` submits through `submit_contact_inquiry` into `public.contact_inquiries`.

Security/operations rules:

- Anonymous/authenticated clients have no direct SELECT/INSERT/UPDATE/DELETE access to raw inquiry rows.
- Public submission is only through a validated SECURITY DEFINER RPC.
- The RPC validates field lengths/email format, uses a honeypot, and rate-limits repeated submissions.
- Only a one-way visitor-token hash is stored for rate limiting; the raw token is not stored in the inquiry table.
- The 特商法 page directs legal-information requests to this form.
- `billing-policy.html` now points billing/cancellation/refund/duplicate-charge inquiries to the live `contact.html` route instead of saying that a future contact route will be decided.

## Support / moderation operations — IMPLEMENTED FOR CONTROLLED BETA

`docs/BETA-OPERATIONS-RUNBOOK.md` records the current controlled-beta routine.

- `.github/workflows/beta-ops-inbox.yml` checks production every 6 hours using a read-only query path.
- Only counts of new `content_reports` and `contact_inquiries` are copied into GitHub automation.
- Waiting work creates/updates one operator alert issue; a clear inbox closes it.
- Raw report/inquiry bodies, email addresses, user IDs, and visitor hashes are not copied to the alert.
- Legal-information/payment/safety requests are prioritized by the operator routine.

If the watcher fails, the runbook requires manual checks until automation is repaired.

## Controlled technical evidence relevant to legal/billing review

The following engineering evidence exists as of 2026-08-26:

- authenticated isolated-Staging smoke exercises posting, reading/favorite-related product flows, LIGHT SEED / SCOUT RECORD, and LIGHT ANALYTICS including the basic discovery-to-reading funnel;
- isolated Stripe test-mode billing smoke exercises Checkout, Standard entitlement reconciliation, Stripe Billing Portal, cancellation, and resulting Staging subscription-state reconciliation;
- temporary Staging users/data are cleaned after the smoke;
- raw card numbers are handled by Stripe and are not stored by NOVELIGHT;
- production and Staging Supabase targets are explicitly separated in the relevant automated gates.

Important limitation: the protected-Staging reconciliation test is **not** evidence that an external Stripe webhook can reach the production Vercel endpoint. External Stripe → Production webhook delivery remains a separate production-release technical gate.

## Remaining release work before public beta

1. **Qualified Japanese legal review or an explicit residual-risk decision — OPEN HARD GATE**
   - Have a qualified Japanese lawyer review the final launch-state terms, privacy policy, billing policy, commerce disclosure, content rules, signup consent, pricing/checkout disclosures, and contact route.
   - If the owner chooses to launch without that review, the residual-risk decision must be explicit and recorded; silence does not satisfy the gate.

2. **Questions requiring qualified legal review**
   - 特商法: whether the current on-request omission of legal name/address/phone and the response operation satisfy the exact launch circumstances.
   - recurring subscription / final confirmation: whether the NOVELIGHT + Stripe hosted Checkout presentation satisfies the required Japanese consumer disclosures for the actual plan configuration.
   - Consumer Contract Act / liability: limitation-of-liability, disclaimer, service-change, and dispute provisions.
   - refunds/cancellation: the current no-proration/refund baseline and any mandatory exceptions.
   - minors: signup wording and paid-subscription parental-consent treatment.
   - APPI/privacy: purposes, retention wording, overseas processors, security disclosures, data-subject requests, UTM/pseudonymous analytics, moderation/support data.
   - UGC/copyright: platform license, notice/report handling, takedown process, repeat abuse, and operator liability risk.
   - mature/adult content: consistency among Japanese law, NOVELIGHT zoning, and Stripe/payment-provider restrictions.
   - governing law/jurisdiction wording.

3. **Final release observations still separate from legal analysis**
   - complete the final checklist observation that required legal/contact links are reachable from all intended major public surfaces;
   - perform and record the separate external Stripe → Production webhook delivery check before relying on production paid entitlements;
   - re-run/re-observe the release checklist after any material legal, billing, privacy, moderation, or production-configuration changes.

## Notes

- Do not claim that paid exposure guarantees views, favorites, ratings, rankings, sales, or publication.
- Do not store raw card numbers in NOVELIGHT. Stripe handles card details.
- Keep privacy documentation aligned with actual data flows whenever analytics, advertising, email, moderation, or processors change.
- Do not mark the public beta legal gate complete solely because this engineering review exists.
