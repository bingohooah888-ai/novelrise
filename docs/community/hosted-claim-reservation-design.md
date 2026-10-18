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

## trusted-main CLAIM-only 再利用入口の準備（2026-10-18、未有効化）

- `scripts/community-hosted-claim-entry.mjs` は、GitHub Actions の正規の issue_comment イベントを fresh API の Issue #188 と申請コメントに照合する。OWNER本人の actor / triggering_actor、main SHA、`GITHUB_WORKFLOW_REF` と実際のチェックアウトSHAを必須とする。編集済みコメント、偽装Issue、非OWNER再実行、古いSHAは拒否する。
- `.github/workflows/community-hosted-claim-only.yml` は **`workflow_call` 専用で、issue_comment / push / workflow_dispatch で直接起動しない**。信頼された将来の `community-hosted-executor.yml`（main）からのみ呼び出す前提であり、その呼び出し元は現時点で未設置。
- 呼ばれた場合も「不変タグ予約 + 同一IssueへのCLAIM記録」までで、`runAuthorized` / `writeAuthorized` / `stagingCostApproved` はすべてfalse。Supabase、Vercel、ブラウザ、Productionの操作は行わない。
- **重要**：CLAIMだけを先に独立実行すると、その申請を一回限りで消費し、検証を実行できなくなる。実際のOWNER承認イベントからCLAIM→検証→CONSUMEを**同一の保護された実行ライフサイクル**へ接続し、全経路の排他・環境保護・失敗回復・費用上限・隔離資源削除の証拠が完成するまでこの入口を起動しない。
- このPRはコード/Workflowの**準備のみ**。Gitタグ生成やIssueコメント、費用、Staging/Preview、一般公開は発生しない。mainへのマージは「本番承認」、有料検証実行は別途exact SHA + scope + 一回限りの「ステージング承認」が必要。

## trusted-main executorのread-only入口（2026-10-18、CLAIM未接続）

- .github/workflows/community-hosted-executor.yml は固定Issue #188に対するOWNERの新規申請のみを read-only job で検証する。triggering actor、eventのworkflow identity、main SHA、Issue・申請コメントとGitHub APIの最新状態、申請の一回限り台帳を独立再照合する。
- scripts/community-hosted-executor-gate.mjs は既存のOWNER認証・一回限り申請検査を組み合わせるだけであり、CLAIM、Git tag、台帳書込み、Staging、Preview、ブラウザ、Secret、Productionにはアクセスしない。返却値の実行権限はすべてfalse。
- community-hosted-claim-only.yml は本入口から呼び出さない。実際のCLAIM→隔離検証→CONSUMEを保護された同一runへ接続し、すべての実行経路の排他制御、費用上限、GitHub Environment protection、隔離資源とcleanupの実証、失敗時回復が揃うまで承認を消費してはならない。
- 本変更で許容するのはGitHub Actionsのread-only短時間検証jobのみ。mainマージに本番承認が必要であり、有料Staging/Previewは別の一回限りのステージング承認が必要。

## 同一runの順序・障害時停止ハンドオフ（2026-10-18、未有効化）

- `scripts/community-hosted-ordered-handoff.mjs` に、CLAIM → 隔離検証 → CONSUMEを一つの実行呼び出しで順序付けるdependency-injected coordinatorを追加する。API接続、CLI、GitHub Actionsからの起動点、資格情報読み取り、実行grant発行は含めない。
- 開始前に必須操作アダプター、固定候補SHA、run/request ID、scopeを確認する。外部から供給される `verifyFreshProtectedBoundary` はGitHub最新証跡・費用承認・Environment protection・共通排他・後片付け能力を**独立認証で証明できる将来のtrusted-main runner**のみが提供してよい。
- CLAIMが不明・書込み確認できない場合、再予約せず、後続の隔離検証とCONSUMEも自動実行しない。受領済みCLAIMから費用許可を導出しない。別の独立認証済み `obtainIndependentExecutionGrant` が不足する場合、Stage実行せず失敗CONSUMEを一度だけ要求する。
- `runIsolatedLifecycle` が成功した場合も、ブラウザ検証と隔離ブランチ削除の証跡がrun ID、request ID、main/candidate SHAに全て一致する場合のみ成功CONSUMEを要求する。失敗・証拠欠落時はfailureとして記録し、cleanup成功と偽らない。
- CONSUME POSTが曖昧・失敗・受領証不一致の場合、自動再POSTせず台帳と外部資源を手動で照合する。adapter例外内のtokenやレスポンスを報告へ転記しない。
- 本実装は接続インターフェースとエラー遷移を検証する段階であり、**認証済み実行grant、費用上限、GitHub Environment protection、排他の外部証明、実際のSupabase branch/Preview/browser adaptersは未接続**。よってこのファイルを追加しても実際のCLAIM/CONSUME、有料Staging、Preview、一般公開は不可能なまま。
- GitHub mainマージには本PR固有の「本番承認」が必要。実際の有料検証には別途exact SHA/scope/一回限りの「ステージング承認」が必要。

## 既存3部品のコーディネーター結合（2026-10-18、未有効化）

- `scripts/community-hosted-coordinator-bindings.mjs` は既存の `reserveAndRecordCommunityHostedClaim`、`runCommunityHostedWriteLifecycle`、`recordCommunityHostedConsumption` の引数・受領証を、前段の `runCommunityHostedSingleLifecycle` に合わせる依存注入アダプターである。
- `tests/community-hosted-coordinator-bindings.test.mjs` は実コードの3部品を組み合わせたメモリー内の模擬GitHubタグ・台帳と隔離環境で、正常経路、ブラウザ失敗のcleanup後failure記録、CLAIM不明時の自動再試行拒否、IDすり替え拒否を確認する。
- **境界維持**：結合アダプターは `verifyFreshProtectedBoundary` と `obtainIndependentExecutionGrant` を実装も発行もしない。単体では前段の実行条件を満たせず、実行できない。実環境のOWNER/費用/保護/排他/独立環境の認証には使用できない。模擬入力と成功を実際の費用許可に読み替えてはならない。
- 今回の変更ではGitHub Actions、GitHubタグ・Issue台帳、Supabase、Vercel、実ブラウザ、Production、一般公開のいずれにも操作を追加しない。GitHub main mergeは別途本番承認、有料Stagingは独立した一回限りのステージング承認を要する。

## Environment・費用上限の証拠形式チェック（2026-10-18、read-only）

- `scripts/community-hosted-staging-evidence-shape.mjs` は、独立したGitHub Environmentの承認者・自己承認禁止・管理者bypass禁止・main限定branch policy、OWNERが申請ID・run ID・候補SHAへ結び付けた通貨建て総額上限、Supabase/Vercelごとの強制停止上限、データを複製しない一時隔離ブランチ計画を**形式的に**確認する。
- GitHub Environmentが実際にその設定になっているか、別のレビュアーが承認したか、Supabase/Vercelが請求額を強制停止できるかは **実環境で未確認**。GitHub connectorからEnvironmentの設定APIを直接参照する試行は不可だった。記述した費用例はテスト用の仮数値であって、運営が費用上限を承認したものではない。
- 既存のOWNER事前承認形式には最大許容費用の数値・通貨・プロバイダー別限度額がないため、**実稼働での費用上限の証拠はまだ作れない**。実際の別途ステージング承認と、検証可能なサービス側の強制停止・資源廃棄手段が揃わなければ次のgateへ接続してはならない。
- 本関数にはGitHub/Supabase/Vercelへの通信・Secret・CLI・実行grant・CLAIM・CONSUME処理がない。形式検査に合格しても `evidenceAuthenticated=false` 等、すべての実行・費用・公開許可はfalse。既存のread-only executor workflowと同一runライフサイクルへの接続はしない。
- Production DB・公開フラグ・有料Staging・Preview・Branchの作成は行わない。mainマージには別途「本番承認」が必要。

## ブラウザ検証の成功誤認防止（2026-10-18、実環境未起動）

- `scripts/community-hosted-write-lifecycle.mjs` は、`runBrowser()` の正常return（`undefined`を含む）だけで`browserVerified=true`と扱っていたため、必要な操作を確認せずにterminal successへ進み得た。
- 修正後は、同じ申請ID・run ID・main/candidate SHA・隔離project ref・Preview URL・作者/読者/管理者のテストIDに一致する明示的なブラウザ証跡を要求する。匿名拒否、Block/Mute、作者opt-in/revoke、like/comment/report/notification、管理者moderation監査、R15/R18と非公開/未公開/RPCの除外、Production mutationなしの各判定が全て一致しなければcleanup後もsuccessにしない。
- 模擬テストは未返却・欠落・偽のrun ID・偽のproject ref・失敗した個別判定を拒否し、後片付けを継続する。**このレシートは構造上の検査であり、実際のブラウザ操作の独立した認証にはならない**。今後の保護されたrunnerでは実セッション・動作証跡を独立取得する必要がある。
- この修正は既存の依存注入ライブラリとテストだけ。GitHub Actionsのトリガー・CLAIM、Supabase、Vercel、実ブラウザ、Preview、本番DB、一般公開は変更せず、料金を発生させる実行を許可しない。
