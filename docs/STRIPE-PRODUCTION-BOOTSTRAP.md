# Stripe production bootstrap

NOVELIGHTのStripe本番準備は、`.github/workflows/stripe-production-bootstrap.yml` を使って実行する。

目的は、Stripe DashboardとVercel Dashboardでの反復手作業を最小化しつつ、ライブ課金に関わる変更をGitHub Environment承認の内側に置くことである。β期間中は、**Standardを0円・カード登録不要の非Stripe entitlementとして提供し、Premiumだけを月額480円のStripe継続課金として扱う**。通常の本番整合・修復では、同じ承認済みworkflowの中でVercel Production設定同期、再deploy、既存契約のβ価格移行、Webhook到達確認、**実課金なしのβ billing control proof**まで完了させる。

Production billing障害の切り分け・自動化・修復は `docs/PRODUCTION-BILLING-INCIDENT-RUNBOOK.md` を併用する。

## 一度だけ必要な手動設定

GitHubの `production-approval` Environment secretsへ次を登録する。

- `STRIPE_LIVE_SECRET_KEY`: StripeのライブSecret Key。`sk_live_` で始まるもの。
- `VERCEL_TOKEN`: `ranobe1 / novelrise` を管理できるVercel Personal Access Token。
- `SUPABASE_SECRET_KEY`: 本番Supabase project `fiepaguycecrredwrcwx` のserver-side Secret Key。

これらの値をissue、PR、チャット、repository file、workflow logへ貼らない。

Standaloneの `NOVELIGHT Production Webhook Control` を手動実行する場合は、同Environmentの `STRIPE_PREMIUM_PRICE_ID` も使用する。Legacy Cleanupはcanonical billing状態の確認に必要なProduction secretsを同Environmentから取得する。

`production-approval` EnvironmentにはRequired reviewerを設定し、管理者によるbypassは無効のまま維持する。

## Production Bootstrapが自動で行うこと

承認後、workflowは以下を順番に実行する。

1. ライブStripe key、本番Supabase Secret Key、canonical Supabase URL、Vercel tokenをfail-closedで確認する。
2. Vercelの `ranobe1 / novelrise` projectへ明示的にlinkする。
3. β版Premium月額480円のライブPriceを専用lookup keyで冪等に確認・作成する。Standard月額980円の既存Priceは、新規申込みには使用せず、β無料化時の既存Standard契約停止対象を識別するためにのみ参照する。
4. 旧Premium月額1,980円のlive Priceが存在する場合は、金額・通貨・課金周期を検証し、既存Premium契約の移行元として識別する。
5. NOVELIGHT専用Customer Portal configurationを作成または更新する。β期間中はStandardが非Stripe entitlementのため、Portal内のStandard/Premium price切替は無効にする。
6. `https://novelrise.vercel.app/api/stripe-webhook` のライブWebhook endpointを確認または作成する。
7. 古いNOVELIGHT Vercel alias等へ向いたactiveなlive webhook endpointがあれば検出し、安全なcleanup候補として記録する。
8. Vercel Productionへ本番変数を同期する。Secret類はログへ出さずsensitive variableとして扱う。
   - `STRIPE_SECRET_KEY`
   - `STRIPE_STANDARD_PRICE_ID`（既存Standard 980円契約の移行識別用。新規Standard Checkoutには使用しない）
   - `STRIPE_PREMIUM_PRICE_ID`（β版Premium 480円）
   - `STRIPE_PREMIUM_LEGACY_PRICE_ID`（旧Premium 1,980円Priceが存在する場合）
   - `STRIPE_PORTAL_CONFIGURATION_ID`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_URL=https://fiepaguycecrredwrcwx.supabase.co`
   - `NOVELIGHT_APP_URL`
   - `NOVELIGHT_BETA_STANDARD_FREE=true`
9. Vercel Productionを再deployする。
10. Premium Checkout API、Standard β無料activation API、Webhook APIの公開route contractが到達可能であることを確認する。
11. redeploy後、既存の非terminal Standard 980円subscriptionを `invoice_now=false` / `prorate=false` で停止し、以後980円が自動請求されないようにする。Webhookはβ期間中Standard無料へ復帰させる。
12. 旧Premium 1,980円subscriptionが存在する場合、`proration_behavior=none` でPremium 480円Priceへ移し、移行時の追加請求・日割り請求を発生させず次回更新以降を480円にする。
13. signing secret rotation時は、新deploymentが到達可能になった後で旧canonical endpointを削除する。
14. 最終deploy状態に対して `scripts/production-beta-billing-control.mjs` を実行する。
15. control proofだけが失敗した場合は、Stripe/Vercel同期や契約移行をやり直さず15秒後にcontrol proofだけを1回再試行する。
16. Production Billing Health Auditで最終整合性をread-only確認する。
17. signing secretを含み得る一時bootstrap outputは、後段の検証失敗時を含めて必ず削除する。

古いalias endpointの削除は、通常のbootstrapとは別に `NOVELIGHT Production Webhook Legacy Cleanup` を使える。これはcanonical endpointを維持したまま、削除直前にもlegacy条件を再検証し、cleanup後にno-charge controlとBilling Health Auditを実行する。

## Stripe object safety

β期間中のPrice識別は次を正式キーとする。

- Standard legacy: `novelight_standard_monthly_jpy` — 月額980円。**β中の新規Standard申込みには使わず、既存有料Standard契約の停止対象識別専用**。
- Premium beta: `novelight_premium_beta_2026_monthly_jpy` — 月額480円。β期間中の新規Premium申込みと更新に使用する。
- Premium legacy: `novelight_premium_monthly_jpy` — 月額1,980円。既存Premium契約の移行元識別専用。

同じlookup keyが複数存在する、想定金額・通貨・課金周期と一致しない、または対象subscriptionが単一itemの想定NOVELIGHT契約として確認できない場合は、勝手に修復・移行せずfail closedで停止する。

既存Standard有料subscriptionの停止は `invoice_now=false` / `prorate=false` とし、β無料化のための追加請求や日割り請求を発生させない。旧Premiumから480円への移行は `proration_behavior=none` とし、移行時の即時差額請求を発生させない。

Customer Portal configurationはmetadata `novelight_managed=true` を持つものだけを更新対象とする。複数存在する場合は曖昧な更新を避けて停止する。β期間中はStandardがStripe subscriptionではないため、Portalのsubscription price切替機能は無効にする。

Webhook URLが既に存在する場合、通常実行ではイベント設定だけを同期する。Stripeは既存endpointのsigning secretをAPIから再取得できないため、通常実行ではVercelに `STRIPE_WEBHOOK_SECRET` が既に存在することを条件に再利用する。Endpointだけ存在してVercel secretが無い状態では停止し、秘密値を推測・上書きしない。

## Webhook signing secret repair

Stripe側のcanonical live webhook endpointとVercel Productionの `STRIPE_WEBHOOK_SECRET` が不一致、欠落、または古い可能性がある場合は、`NOVELIGHT Stripe Production Bootstrap` の `rotate_webhook_secret` を明示的に有効化して修復する。

修復モードも `production-approval` Environmentの承認内でのみ実行する。

修復モードでは配送断を避けるため次の順序を固定する。

1. canonical URLに一致するライブendpointが0件または1件であることを確認する。複数なら停止する。
2. 既存endpointがある場合でも、同じURL・購読イベントを持つreplacement endpointを先に作成する。
3. replacementのsigning secretをVercel Productionの `STRIPE_WEBHOOK_SECRET` へsensitive variableとして同期する。
4. Productionを再deployする。
5. 新deploymentのroute contractが到達可能になった後だけ旧canonical endpointを削除する。
6. 最終状態に対してno-charge beta billing control proofを実行する。

修復モードはsigning secretをチャット、repository、PR、ログへ表示しない。

## Legacy webhook endpoint cleanup

canonical endpointのcontrol proofが成功している一方、Vercel Runtime Logsに `StripeSignatureVerificationError` が連続する場合、古いStripe live endpointがVercelの旧aliasへ配送し、そのPOSTがcanonical routeへredirectされている可能性を確認する。

`NOVELIGHT Production Webhook Legacy Cleanup` は次を満たすendpointだけを削除する。

- canonical endpointそのものではない
- `/api/stripe-webhook` と同じpath
- active
- NOVELIGHT managed description、または `novelrise*.vercel.app` のURL
- 削除直前の再取得でも同じ条件を満たす

このcleanupはPrice、Customer、Subscription、Webhook secretを変更しない。canonical endpoint IDの削除は明示的に拒否する。

## No-charge Production beta billing control

Production controlでは、固定テスト作者を使い回さず、毎回一時Supabaseユーザーを作成する。

control proofは次を確認する。

1. 一時ユーザーを作成し、本番 `/api/activate-beta-standard` を認証付きで呼ぶ。
2. profileが `plan=standard` / `payment_status=beta_free` となり、Standard利用開始にStripe Customer、subscription、支払方法が不要であることを確認する。
3. 同じ作者で本番 `/api/create-checkout-session` からPremium申込みを開始する。
4. Stripe Liveのsubscription Checkout Sessionが`unpaid`で、β版Premium 480円のlive Priceと正しいuser referenceを持つことを確認し、支払い前にSessionをexpireする。
5. Webhook lifecycle確認専用に、支払方法なし・1日trialのPremium subscriptionを作成する。
6. `customer.subscription.created` によりPremium entitlementと監査状態が反映されることを確認する。
7. trial subscriptionをcancelし、β期間中のfallbackとして `plan=standard` / `payment_status=beta_free` へ戻ることを確認する。
8. control全体を通じてchargeとpaid invoiceが0であることを確認する。
9. 一時Stripe/Supabaseデータをcleanupする。

これにより、**Standardカード不要・Premium 480円Checkout・Stripe Live → Webhook → Supabase反映・Premium解約後のβ無料Standard復帰**を、人工的な実課金なしで継続検証できる。

`.github/workflows/production-webhook-control.yml` は独立した診断・復旧用fallbackとして残す。自動push triggerは持たず、`workflow_dispatch` で明示起動した場合だけ `production-approval` を要求する。

## Billing consistency audit

`NOVELIGHT Production Billing Health` はStripe/Supabase/Webhookの状態差分をread-onlyで検査する。

β期間中は `plan=standard` / `payment_status=beta_free` を正常な**非Stripe entitlement**として扱う。この状態にStripeのactive/trialing等のentitled subscriptionが同時に残っている場合はdriftとして停止する。

検査例:

- Premium等のpaid profileなのにStripe Customerが存在しない
- Premium等のpaid profileなのにentitled Subscriptionが存在しない
- beta-free Standardなのにlive entitled subscriptionが残っている
- Free profileなのにactive/trialing等のSubscriptionが存在する
- 同一Customerを複数profileが参照する
- canonical webhook endpoint数・event設定の不整合
- activeなlegacy NOVELIGHT webhook endpoint

手動auditは `production-approval` で実行できる。定期auditは `production-observability` Environmentと `PRODUCTION_BILLING_AUDIT_READY=true` を安全に設定した後だけ有効化する。

Auditはread-onlyとし、修復は `NOVELIGHT Production Billing Repair` やLegacy Cleanup等の承認付きworkflowへ分離する。

## Webhook events

本番Webhookは次を購読する。

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.finalization_failed`

## Customer Portal policy

- β期間中、Stripe顧客ポータルはPremium subscriptionの契約管理に使用する。Standard β無料利用者はStripe顧客ポータルを必要としない。
- Premiumの解約は `at_period_end` とし、現在期間の終了まではPremium権利を維持する。
- Premium利用者の支払方法変更と請求履歴を有効にする。
- β期間中はStandard / Premium間のPortal price切替を無効にする。Standardへの復帰はPremium終了をWebhook同期した後、β無料entitlementとして処理する。
- Portal session作成時は `STRIPE_PORTAL_CONFIGURATION_ID` を明示し、Stripe Dashboardのdefault configurationに依存しない。

## 実行方法と承認境界

GitHub Actionsから `NOVELIGHT Stripe Production Bootstrap` を手動起動する。

通常の整合確認では `rotate_webhook_secret` を無効のまま実行する。Webhook signing secretの修復が必要な場合だけ、意図を確認したうえで有効化する。

workflowは `production-approval` Environmentで停止し、Required reviewerの承認後にだけProduction stateへ書き込む。その1回の承認は、そのworkflow run内のStripe βPrice作成・Vercel設定同期・redeploy・既存Standard/Premium subscriptionの承認されたβ価格移行・Webhook cleanup・no-charge control・最大1回のcontrol再試行・最終auditまでを対象とする。

別の日・別workflow run・別のProduction mutationには別の明示承認が必要である。Production承認そのものを無効化・自動承認する運用にはしない。

Supabase migrationのProduction適用はStripe bootstrapとは別の承認境界であり、`docs/SUPABASE-PRODUCTION-DEPLOY.md` のexact-main / migration-version / one-time challenge手順に従う。PR承認やStripe Environment承認をSupabase migration承認へ流用しない。

## β公開前の課金検証方針

運営者自身の実カードを使ったLive modeの「テスト決済」を通常の検証手段にしない。

β公開前の技術検証は次で構成する。

- Staging: isolatedなStripe test modeとSupabaseで、β版のStandard activation・Premium Checkout・Webhook同期・解約後fallback等、Productionへ入る同等経路を可能な範囲で検証する。
- Production: no-charge beta billing controlで、Standardカード不要activation、Premium 480円Checkout Session生成、Stripe Live → Webhook → Supabase反映、Premium cancel後のβ無料Standard復帰、cleanupを検証する。
- Production Billing Health AuditでStripe/Supabase/Webhookの整合性を検証する。

実際のβユーザーによる正規取引が発生した後は、決済情報そのものを取得・表示せず、Stripeの取引状態、Webhook event history、Supabase entitlementの一致を監査する。

**人工的な実決済をβ公開GO条件にしない。** 技術検証のために不要なLive chargeを発生させない。
