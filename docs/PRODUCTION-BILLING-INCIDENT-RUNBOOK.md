# NOVELIGHT Production Billing Incident Runbook

ProductionのCheckout、Customer Portal、Stripe Webhook、Supabase課金状態に異常が出た場合の正式な切り分け・自動化・修復手順。

本書は `docs/NOVELIGHT-MASTER.md` と `docs/WORK-EXECUTION-PREFLIGHT.md` の下位補助文書であり、Production承認・Secret境界を緩和しない。

## 1. 原則

### 1.1 証拠を取る前にコードを直さない

「ボタンが動かない」「課金状態が変わらない」のような表面症状だけでフロントエンド、API、Webhook、DBのどれかを推測して修正しない。

Production billing incidentでは次の順序を固定する。

1. **Client / Network evidence**
   - ブラウザ障害ならNetworkのHTTP method / path / statusを確認する。
   - 自動再現できる場合は人手DevToolsより先に再現スクリプトを使う。
2. **Application runtime evidence**
   - Vercel Runtime Logsで該当requestのserver-side failure classを確認する。
   - request ID、route、HTTP status、Stripe error `type / code / param`等の非秘密情報を使う。
3. **External provider evidence**
   - StripeのCustomer / Subscription / Checkout Session / Webhook endpoint状態をAPIで照合する。
   - Webhook署名エラーではendpoint URL、endpoint数、配送先、署名timestampを確認する。
4. **Database state evidence**
   - Supabase `profiles` と `subscription_event_log` をStripe側の実状態と照合する。
5. **Root-cause fix**
   - 上記証拠が指す層だけを修正する。
   - 修正後は同じ経路を自動テストまたはcontrol proofで再確認する。

例外は、課金・データ損失・Secret漏えいを即時停止するための安全措置だけとする。その場合も恒久修正前に証拠を保存する。

## 2. 自動化優先ゲート

Production incidentでUI手順を案内する前に、次を順番に評価する。

1. 接続済みAPI / Connector
2. 既存のGitHub Actions workflow
3. 既存script / CLI
4. 再利用可能な診断・修復workflowの追加
5. 最後の手段としてUI手動操作

同種の手動操作が**2回目**に発生した時点、または1工程で**4操作以上**の手動UIが必要になった時点で、原則としてその場の手動継続を止め、自動化候補として扱う。

Production approval、2FA、Secret初回登録など、人間が残すべき境界は自動化しない。

## 3. Production Billing Health Audit

`NOVELIGHT Production Billing Health` はStripe / Supabase / Production Webhookの整合性をread-onlyで検査する。

主な検査対象:

- Standard / Premiumなのに `stripe_customer_id` が無い
- Supabaseに保存されたCustomerがStripe Liveに存在しない
- Paid profileなのにentitlementを持つSubscriptionが無い
- Free profileなのにStripe側にentitlementを持つSubscriptionが残る
- 保存済みSubscription IDがStripe側に存在しない
- 同一Stripe Customerを複数profileが参照する
- canonical Production Webhook endpointが0件または複数
- canonical endpointの購読event不足
- 古いVercel alias等へ向いたactiveなNOVELIGHT live webhook endpoint

Auditは不整合を自動修復しない。read-only検知と修復workflowを分離する。

### Scheduled audit

`.github/workflows/production-billing-health.yml` は毎日JST 03:17相当でscheduleされる。

scheduled jobはrepository variable `PRODUCTION_BILLING_AUDIT_READY=true` の場合だけ有効化し、`production-observability` Environmentにread-only監査用のStripe Live / Supabase server credentialを安全に登録した後で使用する。

`production-observability` にはProduction mutation権限を与えるworkflowを置かない。Secretをチャット、Issue、PR、ログへ貼らない。

初期設定が未完了の間はschedule jobをfailさせずskipし、手動監査は既存 `production-approval` Environmentで実行できる。

## 4. Stale billing state repair

SupabaseがPaid扱いなのにStripe Customerが存在しない場合は `NOVELIGHT Production Billing Repair` を使う。

workflowは以下を満たす場合だけ対象profileをFreeへ戻す。

- target `display_name` が完全一致で1件だけ
- profileがStandard / Premiumかつactive
- `stripe_customer_id` が存在する
- Stripe LiveでそのCustomerがmissing/deletedと確認できる
- GitHub `production-approval` が承認済み

Stripe側にCustomerが実在する場合は自動修復しない。

## 5. Legacy webhook cleanup

署名エラーが連続し、canonical webhookのno-charge controlは通る場合、古いStripe live endpointがVercel alias等を経由してcanonical routeへ到達している可能性を確認する。

`NOVELIGHT Production Webhook Legacy Cleanup` は次だけを削除対象にする。

- canonical URLそのものではない
- `/api/stripe-webhook` と同じpath
- active endpoint
- NOVELIGHT managed description、または `novelrise*.vercel.app` のURL
- cleanup直前にも同条件を再検証できる

canonical endpoint IDは削除禁止。Secret rotation、Price変更、Customer削除は行わない。

cleanup後はno-charge Production checkout + webhook controlとBilling Health Auditを連続実行する。

## 6. No-charge Production canary

Productionの健全性確認に長期間使い回す固定テスト作者を使わない。

`scripts/production-webhook-control.mjs` は毎回:

1. 一時Supabaseユーザーを作る
2. 本番 `/api/create-checkout-session` を実ユーザー相当のaccess tokenで呼ぶ
3. Stripe Liveの未決済Checkout Sessionが作成されることを確認する
4. Sessionを支払い前にexpireする
5. 支払方法なし1日trial SubscriptionでWebhook反映を確認する
6. cancelしてFree復帰を確認する
7. charge / paid invoiceが0であることを確認する
8. 一時Stripe / Supabaseデータをcleanupする

これにより、固定Productionテストアカウントに古いCustomer/Subscription参照が蓄積することを避ける。

## 7. ユーザー向けエラー終端

料金ページはAPI失敗時に「準備中…」のまま停止してはならない。

- Checkout全体にtimeoutを持たせる
- HTTP 409 `billing_state_conflict` は「契約情報の同期問題」として明示する
- エラー表示は料金カード直下の見える位置に出す
- 「決済は発生していない」ことを明示する
- ボタンは必ず再操作可能状態へ戻す

## 8. Production実取引の扱い

運営者自身のカードを使ったLive modeのテストを通常の検証手段にしない。

β公開前の技術検証は、Staging Stripe test modeとProduction no-charge canaryを基本とする。

実際のβ利用者による正規取引が発生した後は、個人情報・決済情報をログへ出さず、Stripe/Supabase/Webhookの監査データで正常性を確認する。

## 9. Incident close条件

incidentを完了扱いにする前に次を満たす。

- failure layerとroot causeが証拠で特定されている
- root-cause fixまたは安全なrepair pathが存在する
- 同種障害の自動検知がある
- 必要なら再利用可能な自動修復workflowがある
- user-facing failureが永久待ちにならない
- no-charge canaryまたは該当テストがPASSする
- Production mutationが必要な場合、別途明示承認を通している
- 手動作業を恒久運用として残していない
