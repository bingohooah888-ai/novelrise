# Stripe production bootstrap

NOVELIGHTのStripe本番準備は、`.github/workflows/stripe-production-bootstrap.yml` を使って実行する。

目的は、Stripe DashboardとVercel Dashboardでの反復手作業を最小化しつつ、ライブ課金の変更をGitHub Environment承認の内側に置くことである。通常の本番整合・修復では、同じ承認済みworkflowの中でVercel Production設定同期、再deploy、Webhook到達確認、no-charge制御テストまで完了させる。

## 一度だけ必要な手動設定

GitHubの `production-approval` Environment secretsへ次を登録する。

- `STRIPE_LIVE_SECRET_KEY`: StripeのライブSecret Key。`sk_live_` で始まるもの。
- `VERCEL_TOKEN`: `ranobe1 / novelrise` を管理できるVercel Personal Access Token。
- `SUPABASE_SECRET_KEY`: 本番Supabase project `fiepaguycecrredwrcwx` のserver-side Secret Key。

これらの値をissue、PR、チャット、repository file、workflow logへ貼らない。

Standaloneの `NOVELIGHT Production Webhook Control` を診断・復旧用途で手動実行する場合のみ、同Environmentの `STRIPE_STANDARD_PRICE_ID` も使用する。通常のProduction Bootstrap内の制御テストはStripe bootstrap outputからStandard Price IDを取得するため、この手動維持値には依存しない。

`production-approval` EnvironmentにはRequired reviewerを設定し、管理者によるbypassは無効のまま維持する。

## workflowが自動で行うこと

承認後、workflowは以下を順番に実行する。

1. ライブStripe key、本番Supabase Secret Keyの存在、canonical Supabase URL、Vercel tokenをfail-closedで確認する。
2. Vercelの `ranobe1 / novelrise` projectへ明示的にlinkする。
3. Standard月額980円とPremium月額1,980円のライブPriceをlookup keyで冪等に確認・作成する。
4. NOVELIGHT専用Customer Portal configurationを作成または更新する。
5. Customer Portalで支払方法更新、請求履歴、期間末解約、Standard/Premiumのprice変更を可能にする。
6. `https://novelrise.vercel.app/api/stripe-webhook` のライブWebhook endpointを確認または作成する。
7. Vercel Productionへ本番変数を同期する。Secret類はログへ出さずsensitive variableとして扱い、`SUPABASE_URL` は非秘密値としてcanonical URLを同期する。
   - `STRIPE_SECRET_KEY`
   - `STRIPE_STANDARD_PRICE_ID`
   - `STRIPE_PREMIUM_PRICE_ID`
   - `STRIPE_PORTAL_CONFIGURATION_ID`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_URL=https://fiepaguycecrredwrcwx.supabase.co`
   - `NOVELIGHT_APP_URL`
8. Vercel Productionを再deployする。
9. Checkout APIとWebhook APIの公開route contractが復旧したことを確認する。
10. Webhook signing secret rotation時は、新deploymentが到達可能になった後で旧Webhook endpointを削除する。
11. 最終deploy状態に対して `scripts/production-webhook-control.mjs` を実行し、Stripe Live → Production Webhook → Supabase entitlement反映と解約反映を実課金なしで確認する。
12. 制御テストだけが失敗した場合は、Stripe/Vercel同期やdeployをやり直さず、15秒後に制御テストだけを1回再試行する。2回目も失敗した場合はworkflowを失敗扱いにする。
13. signing secretを含み得る一時bootstrap outputは、後段の検証失敗時を含めて必ず削除する。

## Stripe object safety

Priceは次のlookup keyを正式キーとする。

- Standard: `novelight_standard_monthly_jpy`
- Premium: `novelight_premium_monthly_jpy`

同じlookup keyが既に存在する場合、workflowは金額・通貨・課金周期を検証し、不一致なら新しいPriceを勝手に作らず停止する。

Customer Portal configurationはmetadata `novelight_managed=true` を持つものだけを更新対象とする。複数存在する場合は曖昧な更新を避けて停止する。

Webhook URLが既に存在する場合、通常実行ではイベント設定だけを同期する。Stripeは既存endpointのsigning secretをAPIから再取得できないため、通常実行ではVercelに `STRIPE_WEBHOOK_SECRET` が既に存在することを条件に再利用する。Endpointだけ存在してVercel secretが無い状態では停止し、秘密値を推測・上書きしない。

## Webhook signing secret repair

Stripe側のライブWebhook endpointとVercel Productionの `STRIPE_WEBHOOK_SECRET` が不一致、欠落、または古い可能性がある場合は、`NOVELIGHT Stripe Production Bootstrap` の `rotate_webhook_secret` を明示的に有効化して修復する。

この修復モードも通常のbootstrapと同じ `production-approval` Environmentの承認内でのみ実行する。

修復モードでは、配送断を避けるため次の二段階の順序を固定する。

1. `https://novelrise.vercel.app/api/stripe-webhook` に一致するライブendpointが0件または1件であることを確認する。複数件なら曖昧なため停止する。
2. 既存endpointがある場合でも、まず同じURL・購読イベントを持つreplacement endpointを新規作成し、ライブendpointであることと新しいsigning secretが返されたことを確認する。旧endpointはこの時点では残す。
3. replacementの新しいsigning secretをVercel Productionの `STRIPE_WEBHOOK_SECRET` へsensitive variableとして上書きする。
4. Stripe/Supabase等の本番変数も既存bootstrapと同じ手順で同期し、Vercel Productionを再deployする。
5. 再deploy後に公開Stripe API route contractが到達可能になったことを確認する。
6. 新しいProduction deploymentが到達可能になった後でのみ旧endpointを削除する。削除に失敗した場合はworkflowを失敗扱いにし、replacementは維持する。
7. 旧endpoint削除後の最終状態に対してno-charge制御テストを実行する。

修復モードは、signing secretをチャット、repository、PR、ログへ表示しない。workflow outputの一時ファイルは検証失敗時を含めて最後に削除する。

replacement作成から旧endpoint削除までの短時間は同じStripe eventが2 endpointへ配送される可能性がある。NOVELIGHTのWebhook処理は契約状態の再同期を中心とし、監査eventはStripe event IDで重複抑止するため、唯一のendpointを先に削除して配送断を作るより、この短時間の重複可能性を許容する方を安全側とする。

## No-charge Production webhook control

通常のProduction Bootstrapでは、deployと必要なWebhook rotation cleanupの後にno-charge制御テストを自動実行する。

制御テストは一時的な本番SupabaseユーザーとStripe Live customerを作成し、Standardの1日trial subscriptionを支払方法なしで作る。実課金を発生させず、`customer.subscription.created` によるStandard entitlement反映、監査event記録、subscription cancelによるFree復帰を確認し、最後に一時データを削除する。

制御テストが一度失敗した場合、同じ承認済みBootstrap job内で制御テストだけを1回再試行する。再試行のために再度 `production-approval` を要求せず、Stripe object provisioning、Vercel env同期、Production deployを重複実行しない。2回目も失敗した場合はfail closedで停止する。

`.github/workflows/production-webhook-control.yml` は独立した診断・復旧用fallbackとして残す。自動push triggerは持たず、`workflow_dispatch` で明示起動した場合だけ `production-approval` を要求して実行する。通常運用ではBootstrap完了後にこのStandalone workflowを続けて実行しない。

## Webhook events

本番Webhookは現行server実装に合わせて次を購読する。

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.finalization_failed`

## Customer Portal policy

- 解約は `at_period_end` とし、現在期間の終了までは契約権利を維持する。
- 支払方法変更と請求履歴を有効にする。
- Standard / Premium間のprice変更を有効にする。
- 安いプランへの変更は期間末へscheduleし、上位プランへの変更ではprorationを利用する。
- Portal session作成時は `STRIPE_PORTAL_CONFIGURATION_ID` を明示し、Stripe Dashboardのdefault configurationに依存しない。

## 実行方法と承認境界

GitHub Actionsから `NOVELIGHT Stripe Production Bootstrap` を手動起動する。

通常の整合確認では `rotate_webhook_secret` を無効のまま実行する。Webhook signing secretの修復が必要な場合だけ、意図を確認したうえで `rotate_webhook_secret` を有効化する。

workflowは `production-approval` Environmentで一度停止し、Required reviewerの承認後にだけStripe/Vercelへ書き込む。その1回の承認は、そのworkflow実行内の設定同期、再deploy、Webhook cleanup、no-charge制御テスト、制御テストの最大1回の自動再試行までを対象とする。

別の日・別のworkflow run・Standalone診断など、新しいProduction実行を開始する場合は別の明示承認が必要である。Production承認そのものを無効化・自動承認する運用にはしない。

## 実行後の残るハードゲート

Bootstrap内のno-charge制御テストが成功すれば、Stripe Live → Production Webhook → Supabase entitlementの外部配送経路と解約反映は実課金なしで確認できる。ただし、この成功だけではβ公開GOにはしない。

実ユーザー相当の最終確認として、少なくとも次は別途確認する。

- 新規Checkout UIからの実遷移
- 実決済成功後のSupabase entitlement反映
- Customer Portal表示
- Standard / Premium変更
- 期間末解約
- 解約予約中の権利維持
- 契約終了後のFree復帰
- webhook event historyの記録

ライブ決済を伴う最終smokeは実際の課金を発生させるため、別の明示承認ポイントとして扱う。
