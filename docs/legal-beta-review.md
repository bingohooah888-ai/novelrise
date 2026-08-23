# NOVELIGHT β legal review

Reviewed: 2026-08-23

This document records the implementation basis and the remaining release blockers for the beta legal surfaces. It is an engineering/operations checklist, not a substitute for advice from a qualified Japanese attorney.

## Implemented public surfaces

- `terms.html`: service terms, author rights, platform license, exposure/result disclaimer, prohibited conduct, moderation, AI rules, billing references.
- `privacy.html`: collected data, purposes, processors, visitor-token analytics, payment identifiers, security, retention, data-subject requests.
- `content-guidelines.html`: rights, prohibited content, AI classification, abuse/visibility manipulation rules, beta adult-content rule.
- `billing-policy.html`: monthly renewal, plan changes, cancellation, payment failure, refund baseline.
- `commerce-disclosure.html`: 特定商取引法 disclosure draft.
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

## Release blockers that MUST be resolved before public beta

1. **Real legal/contact request channel**
   - `commerce-disclosure.html` currently contains an explicit blocker marker.
   - Before public beta, configure a real contact method that can receive requests for the operator's legal name/address/phone and provide them without delay.
   - Prefer a dedicated NOVELIGHT support/legal email or contact form rather than a personal address exposed on public pages.

2. **Adult-content policy decision**
   - MASTER says adult/extreme expression should not be blanket-banned and should generally be zoned, except where external rules require prohibition.
   - Stripe's current published restriction conflicts with allowing sexually explicit adult content while using Stripe.
   - The branch therefore uses a **beta-safe provisional rule**: sexually explicit/pornographic content whose primary purpose is sexual gratification is not allowed; other mature themes can use warnings/zoning.
   - This is a product-policy change and requires explicit approval before merge.

3. **Final Japanese legal review**
   - Have a qualified Japanese lawyer review the terms/privacy/billing/commerce disclosure once the operator/contact details and exact beta content policy are fixed.
   - Especially confirm consumer-contract limitation clauses, refund wording, minors, privacy requests, and the 特商法 disclosure/checkout flow.

4. **Footer/global discoverability**
   - Signup and pricing link the legal pages now.
   - Add legal links to the global footer during the final NOVELIGHT branding/mobile pass so the documents are reachable from all major pages.

## Notes

- Do not claim that paid exposure guarantees views, favorites, ratings, rankings, sales, or publication.
- Do not store raw card numbers in NOVELIGHT. Stripe handles card details.
- Keep privacy documentation aligned with actual data flows whenever analytics, advertising, email, moderation, or new processors are added.
