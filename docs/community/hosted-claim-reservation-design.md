# 交流広場 Phase 1 — Hosted 承認予約／CLAIM／CONSUME の設計メモ（未承認）

> **状態：Draft準備。実行入口は未設置。** この設計は追加課金・Staging実行・Preview生成・実ログインE2E・一般公開を承認しない。

## 目的と範囲

対象は交流広場 Phase 1 本体 Draft PR #2222 の固定候補 SHA
`6bf0ea608183e4977fcdaa17d36b1712974d5a49`。
OWNERの個別「ステージング承認」がある場合に限る、一回のHosted実ログイン検証に向けた承認台帳処理の準備である。

- 検査対象：GitHub Issue #188（Staging Approval Control）のOWNER-createdコメント。
- 束縛：**fresh main SHA / 固定候補SHA / 申請comment ID / workflow run ID**。
- 記録：`NOVELIGHT_STAGING_COMMUNITY_HOSTED_CLAIMED` と
  `NOVELIGHT_STAGING_COMMUNITY_HOSTED_CONSUMED`。
- 一回限りの予約名：
  `refs/tags/novelight-community-hosted-once-v1-<requestCommentId>`。
  **run IDではなく申請ID**に固定し、別runによる承認再使用を拒否する。

## 各コードの役割

`scripts/community-hosted-claim-consume-plan.mjs` は台帳検査に基づく
マーカー案を生成するだけで、権限を発行しない。

`scripts/community-hosted-reservation-coordinator.mjs` は
認証済み・スコープ限定されたGitHubアダプターを**外部から渡された場合に限り**、
最新台帳再読 → 一回限りGit参照作成 → exact ref再読 →
台帳・main再読 → CLAIMコメント作成 → 台帳再読・記録照合、
およびCLAIM照合後のCONSUMEコメントと受領照合の**処理順序**を定義する。
CLI、workflow entrypoint、環境変数・Secret取得や実行grantは持たない。

`scripts/community-hosted-github-adapter.mjs` のREST経路は同一GitHub repositoryの
main / #2222 / Issue #188 / 指定tag参照に固定する。
Supabase/Vercel/StripeへのAPI呼び出しを実装しない。

## Fail closed

1. Git参照の作成が201以外、応答不明、または直後の参照照合失敗なら**自動再作成・承認再利用をしない**。
2. 予約後にmain/候補SHAが変わった、既存CLAIM/CONSUMEが見つかった、台帳に欠落があるならCLAIM書込せず停止。作成済みの予約参照は自動削除しない。
3. CLAIM・CONSUMEのコメントPOSTでタイムアウトや不明結果なら**自動再POSTしない**。実際の台帳をread-onlyで照合し、OWNERによる手動是正まで停止。
4. 成功CONSUMEの計画には、同一run IDのブラウザ完了と隔離環境削除まで証明するlifecycle証跡が必須。failure/cancelledはcleanup成功を意味しない。
5. 本モジュールの返却値は常に `stagingCostApproved=false`、`runAuthorized=false`、`writeAuthorized=false`、`releaseAuthorized=false`。Git参照の存在やbotコメントだけで実行権限を推定しない。

## 実運用前の未完項目（必須ゲート）

- trusted-main限定のOWNER認証イベント、固有の一回限りの費用承認確認、およびGitHub Environment protection。
- **全実行経路での排他制御、reservation tagの削除・書換えを防ぐGitHub ruleset、CI/trusted tokenの権限最小化**。GitHub ref作成の原子性だけでは改竄耐性・クロスワークフロー排他は完成しない。
- 正式なCLAIM/CONSUME投稿workflowの設置、実環境の一回限りclaim recoveryと停止機構、外部のauthenticated facts再取得。
- Supabaseのデータなし隔離ブランチとVercel保護Previewの真正性証明、実ログイン3ロールE2E、費用上限、異常時の確実な後片付け。
- 別途の「ステージング承認」がない限り有料検証を行わない。mainマージ・Production変更には別途「本番承認」が必要。

この変更は**準備のみ**であり、GitHubの実際の予約参照、Issueコメント、Staging、Preview、ProductionのいずれもこのPRの作成・CIで操作しない。


## 予約タグの保護ルール確認（2026-10-17、read-only準備）

- 現時点のGitHub ruleset APIで確認できた有効ルールは `Protect main`（branch保護）だけで、`refs/tags/novelight-community-hosted-once-v1-*` を保護する**有効なtag rulesetは未確認**。branch保護をtag保護として流用しない。
- `scripts/community-hosted-reservation-protection.mjs` は、GitHubの最新ruleset一覧と、該当するactive tag rulesetの詳細を全件検査する。専用タグの削除禁止と書き換え禁止、active enforcement、bypassなし、除外パターンなしが確認できない限り **DENY**。
- `.github/workflows/community-hosted-precost-inspection.yml` にread-onlyのruleset監査を追加。現状のtag保護未設定では、OWNERが正しい申請を行った場合でも、この最終監査は失敗して停止する。
- このread-only監査は**GitHub設定を変更しない**。保護ルール追加・変更は別工程であり、このDraft PR作成やCI実行によりタグを作成したり、承認コメントを投稿したりしない。
- rulesetの読み取り成功は一回限りの実行権限ではない。実際の予約・費用発生前には最新ruleset、OWNERイベント、main SHA、候補SHA、台帳、排他実行、認証済みAPIを改めて検証する。


## 予約処理本体のタグ保護再照合（追加安全条件）

- `reserveAndRecordCommunityHostedClaim` は、OWNER申請・新しいmain/PR/台帳検証に加えて、**Git参照予約の作成直前**にGitHub rulesetの全件GET・詳細照合を独立して実施する。保護がない・更新/削除が可能・bypassがある・読み取り失敗・ページ欠落の場合は予約用Git refを**作らず**停止する。
- Git ref作成と読み戻し後、CLAIMコメントをPOSTする直前にもrulesetを再照合する。途中で保護がなくなった場合、作成済みrefは再利用・削除せず、CLAIM投稿を中止する。
- 保護の読み取り専用アダプターは`scripts/community-hosted-github-adapter.mjs`に追加し、`scripts/community-hosted-reservation-protection.mjs`の検証器に渡す。外部への書き込み権限・Staging実行権限は発行しない。
- タグ保護だけでは完全な排他・実行許可を証明しない。実GitHub rulesetは**未設定のまま**であり、現状では必ず拒否する。OWNER本番リリース／ステージング実行承認とは独立する。

## GitHub実設定のread-only照合済み（2026-10-18）

**2026-10-17時点の「タグ保護が未設定」の記述は履歴情報であり、現在の状態ではない。**

GitHub REST APIの実測で、次の2ルールを確認した（設定更新操作やタグ作成は実施していない）。

- **予約専用tag ruleset**: `25337852` / `NOVELIGHT Community one-use reservation tags`
  - `target=tag`, `enforcement=active`, `source_type=Repository`, `source=bingohooah888-ai/novelrise`
  - `include=["refs/tags/novelight-community-hosted-once-v1-*"]`, `exclude=[]`
  - `rules=[update, deletion]`（作成制限なし）
  - `bypass_actors=[]`, `current_user_can_bypass=never`
- **既存mainブランチ保護**: `21196358` / `Protect main` / active。設定は変更していない。

このルール構成は現行の`inspectCommunityHostedReservationProtection`の要件に適合する。
ただし**設定が今後も維持されることの証明ではない**。予約・CLAIMの直前に
read-onlyでfresh再取得するガードを省略しない。

**次に必要な安全工程**：trusted-main限定・OWNER本人の一回限りの費用承認
イベント、実行経路の排他、GitHub Environment protection、実際のCLAIM /
CONSUMEの実行入口の認証、実行後の資源廃棄検証。これらの完成をもっても、
`ステージング承認`なしに有料Preview/実ログインテストを起動しない。

この追記は、環境変更・GitHub設定変更・Staging操作・Production mutationを伴わない
設計の現状修正であり、mainマージには別途`本番承認`が必要。

## CONSUMEの保護状態再確認（2026-10-18、未実行）

- CLAIMが記録済みであっても、`CONSUMED`マーカーを作成するための`recordCommunityHostedConsumption`は、**読み戻し前**と**最終POST直前**にGitHubタグ保護ルールを再取得して変更・削除禁止／bypassなしを照合する。
- 最終POST直前には、予約タグ`refs/tags/novelight-community-hosted-once-v1-<requestCommentId>`のSHAも再読し、当初のmain SHAとの一致を確認する。GitHubの設定が変更された場合や参照内容が変わった場合は、failure/cancelledを含めて自動POSTを拒否する。
- terminalマーカーPOST後は台帳の受領証に加え、mainとDraft候補のSHAが同じままかを再照合する。途中で改訂が発生した場合、**POST済みの可能性がある**ため自動再試行しない。
- これは既存のdependency-injected coordinatorの局所安全強化であり、**新しい実行workflow、OWNER承認経路、費用承認、GitHub Secret / Environment、外部サービス操作を追加しない**。実行許可は引き続き全てfalse。
- 完全な一回限り実行には、なお実行経路の共通排他、OWNER真正性、claim recovery、資源廃棄と確証可能な事後記録が必要。これが揃うまで実運用不可。有料Stagingには別途一回限りの`ステージング承認`が必須。
