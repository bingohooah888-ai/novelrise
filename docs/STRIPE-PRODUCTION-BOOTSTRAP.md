# Stripe production bootstrap

NOVELIGHTのStripe本番準備は、`.github/workflows/stripe-production-bootstrap.yml` を使って実行する。

目的は、Stripe DashboardとVercel Dashboardでの反復手作業を最小化しつつ、ライブ課金の変更をGitHub Environment承認の内側に置くことである。

## 一度だけ必要な手動設定

GitHubの `production-approval` Environment secretsへ次の2つだけ登録する。

- `STRIPE_LIVE_SECRET_KEY`: StripeのライブSecret Key。`sk_live_` で始まるもの。
- `VERCEL_TOKEN`: `ranobe1 / novelrise` を管理できるVercel Personal Access Token。

これらの値をissue、PR、チャット、repository file、workflow logへ貼らない。

`production-approval` EnvironmentにはRequired reviewerを設定し、管理者によるbypassは無効のまま維持する。

## workflowが自動で行うこと

承認後、workflowは以下を順番に実行する。

1. ライブStripe keyであることを確認する。
2. Vercelの `ranobe1 / novelrise` projectへ明示的にlinkする。
3. Standard月額980円とPremium月額1,980円のライブPriceをlookup keyで冪等に確認・作成する。
4. NOVELIGHT専用Customer Portal configurationを作成または更新する。
5. Customer Portalで支払方法更新、請求履歴、期間末解約、Standard/Premiumのprice変更を可能にする。
6. `https://novelrise.vercel.app/api/stripe-webhook` のライブWebhook endpointを確認または作成する。
7. Vercel Productionへ以下をsensitive variableとして同期する。
   - `STRIPE_SECRET_KEY`
   - `STRIPE_STANDARD_PRICE_ID`
   - `STRIPE_PREMIUM_PRICE_ID`
   - `STRIPE_PORTAL_CONFIGURATION_ID`
   - `STRIPE_WEBHOOK_SECRET`
   - `NOVELIGHT_APP_URL`
8. Vercel Productionを再deployする。
9. Checkout APIとWebhook APIの公開route contractが復旧したことを確認する。

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
4. Standard/Premium等の本番変数も既存bootstrapと同じ手順で同期し、Vercel Productionを再deployする。
5. 再deploy後に公開Stripe API route contractが到達可能になったことを確認する。
6. 新しいProduction deploymentが到達可能になった後でのみ旧endpointを削除する。削除は短い再試行を行い、失敗した場合はworkflowを失敗扱いにして旧endpointを残す。replacementは削除しないため、新しいsigning secretを使うProduction経路を維持する。

修復モードは、signing secretをチャット、repository、PR、ログへ表示しない。workflow outputの一時ファイルは従来どおり最後に削除する。

replacement作成から旧endpoint削除までの短時間は同じStripe eventが2 endpointへ配送される可能性がある。NOVELIGHTのWebhook処理は契約状態の再同期を中心とし、監査eventはStripe event IDで重複抑止するため、唯一のendpointを先に削除して配送断を作るより、この短時間の重複可能性を許容する方を安全側とする。

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

## 実行方法

GitHub Actionsから `NOVELIGHT Stripe Production Bootstrap` を手動起動する。

通常の整合確認では `rotate_webhook_secret` を無効のまま実行する。Webhook signing secretの修復が必要な場合だけ、意図を確認したうえで `rotate_webhook_secret` を有効化する。

workflowは `production-approval` Environmentで停止し、Required reviewerの承認後にだけStripe/Vercelへ書き込む。

## 実行後の残るハードゲート

このbootstrap成功だけではβ公開GOにはしない。実ユーザー相当の制御されたアカウントで、少なくとも次を通しで確認する。

- 新規Checkout
- 決済成功後のSupabase entitlement反映
- Customer Portal表示
- Standard / Premium変更
- 期間末解約
- 解約予約中の権利維持
- 契約終了後のFree復帰
- webhook event historyの記録

ライブ決済を伴う最終smokeは実際の課金を発生させるため、別の明示承認ポイントとして扱う。
