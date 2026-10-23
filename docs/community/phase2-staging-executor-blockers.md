# 交流広場 Phase 2 — Hosted Staging実行経路の修復境界

2026-10-23 の調査結果。本書は費用発生・本番変更の許可ではない。

## 承認と対象

OWNERのチャット上の「ステージング承認」は受領済み。対象は最新main
`f6028c77915ffce5f01149cd374d03a3c81dca8f` を起点とする
PR #2457 `feb1d7728e4d8cef917df52355d873807eba5cc9` の
タイムライン＋掲示板の、**一回限りの隔離3役割書き込み受入テスト**。
チャット承認だけで GitHub 機械可読 CLAIM やコスト承認が自動生成済みだと
主張してはならない。main SHA、候補 HEAD、scope、実行回数が変われば
固定承認規約を再評価する。

## 現在のハードブロッカー（現状を隠さない）

1. Vercel Preview / Hostedの承認台帳 Issue #188 は `closed`。
   既存のHosted executorなどは `open` のときだけ起動する。
2. trusted-mainの既存 Staging/Hosted workflow は旧PR #2222やPhase 1
   のblob manifestを参照する。PR番号だけ変更しては実行できない。
3. 既存 `community-hosted-executor.yml` は **read-only pre-CLAIM**
   であり、独立の費用許可、実行Grant、watchdog登録、確実な後片付けを
   行う実行者が実装されていない。CLAIM専用workflowは費用を許可しない。
4. PR #2457のexact HEADを指す再利用可能な保護Previewは検索で0件。
   Supabase connectorから隔離Stagingのproject refは直接参照不可。
5. Issue #188を単独で開き直しても、旧Workflow群を起動可能にするだけで
   正しいPhase 2受入テストを実行できない。

## この修復PRの有効範囲

- `scripts/community-phase2-staging-admission-readonly.mjs` は
  Owner、main SHA、PR #2457 Draft、branch名、Git compare及び
  Issue #188/#294の開閉を純粋関数で検査する。
- `.github/workflows/community-phase2-staging-admission-readonly.yml` は
  **workflow_dispatch / trusted main / OWNER限定**で、読み取り権限のみ。
  触れるのは公開GitHub metadataだけで、Supabase/Vercel tokenも
  有料操作も一切使用しない。
- 結果が全て良好でも `stagingCostApproved`、
  `ownerOneUseClaimAuthorized`、`mayCreateBranch`、
  `mayCreatePreview`、`mayRunHostedBrowser` は必ず false。
  本workflowをHosted executorやStaging実行Grantと呼んではならない。

## 次に必要な独立した審査・承認

本修復PR自体は本番のCI/承認境界に関わるためOWNERの
安全監査・main反映承認前にマージしない。

これとは別に、実際のStagingに対しては以下を満たす
独立した保護executorの設計・安全審査が必要。
OWNER本人によるexact-main / candidate-HEAD / scope / one-use
approval台帳、重複CLAIM保護、保護環境での費用予算上限、
ProductionをDNS/Project ID両方で否定するチェック、隔離DBへの
Phase 1/2順序付き適用、匿名／作者／読者／運営検証、
バックグラウンドで独立したwatchdog、失敗時の確実な環境廃棄、
実行後の不可逆なCONSUMED記録。いずれか不明なら Default-Deny。

旧Issue #188のopen状態やPR #2222の参照を個別に変更して
ゲートを緩めることは禁止。既に受領した承認の有効なscopeは
保持する一方、技術的に付与できないStaging実行許可を捏造しない。

**この文書とテストの作成では外部環境・main・Productionに変更なし。**

## 追加：不変のPhase 2レビュー済みBlob境界

承認前read-only gateはPR #2457のgit commit/treeを独立取得し、
正式migration、rollback、pre/postcheck、RLS試験、サイト共通フラグ、
掲示板JS、隔離hosted 3役割受入テストと専用bootstrapの
**9ファイルすべてを完全一致するgit blob SHA**で拘束する。
treeがtruncated、git commitとtreeが不一致、ファイル欠落・差替え、
またはPR HEADが更新された場合は拒否する。

workflow_dispatchの結果はIssue #188が閉じたままでは
**failed gate**として終了する。承認がないのに「成功」扱いにはしない。
実行Grantは正しいblobでも一切付与せず、実装中のコードを読み取り
監査対象とするためだけの機構である。


## Phase 2独立したStaging実行シーケンス（2026-10-23）

`scripts/community-phase2-hosted-execution-contract.mjs` と
`tests/community-phase2-hosted-execution-contract.test.mjs` は
**依存注入による実行順序の機械的契約**を提供する。
対象scopeは `community-phase2-joint-hosted-authenticated-write` であり、
Phase 1 scopeを使ってPhase 2承認を取得・使用することは拒否する。

厳密な順序は、OWNER本人確認・台帳・SHA・予算・独立Watchdog・
一回限りの請求境界 → 不可逆なone-use CLAIM →
独立保護環境からの実行grant → 先行Watch登録 →
生データのないisolated branch → Phase 2 migration / RLS ->
保護Previewのexact HEAD及び別DB接続の確認 →
匿名/作者/読者/運営のブラウザ動作（Phase1/2同時検証） →
Preview・DB Branch破棄 → read-back →
一回限りのCONSUMED記録である。

APIが曖昧な成功を返す場合はブランチ再照合が必要。後片付けの
途中に失敗があっても他の掃除と最終記録を試みる。環境削除が
不確かなら独立Watchdogによる回復が前提であり、成功と偽装しない。
Production project `fiepaguycecrredwrcwx`、共用Staging
`wmlzjgvxgoyrovdhbqbg` は両方拒否する。

**このモジュールには実行アダプタ、認証済みの予算Grant、
Supabase/Vercel Secret、Issue書込、ワークフロートリガーを付けていない。
純粋なモックを使った失敗時テストに成功しても、実際のHosted
実行経路が完成したとはみなさない。**


## 重要：隔離DBゲートの短時間ON/OFF（2026-10-23）

Phase 2の`novelight_community_board_save`はDBの`community_runtime_control.public_enabled`がOFFだと書き込みを拒否する。Hosted受入テストでは**本番と共用StagingのgateはOFFのまま**、独立して生成されデータを持たないSupabase branchの実体IDだけを検証した上で、schema導入後にそのbranchのテストゲートを短時間ONにする必要がある。ブラウザ試験を終えたらまずテストゲートをOFFに戻し、その後Preview/branchを消去する。例外が発生してもOFF操作と削除と独立watchdogによる回復を試み、read-backが欠けるなら成功にしない。

この要件は`community-phase2-hosted-execution-contract.mjs`に順序契約として追加済み。実際のDB RPC、Secret、実行Grantはまだ接続していない。


## 三役割テスト前の隔離Auth・管理者許可リスト（2026-10-23）

独立runnerは隔離DBへ3種類の**合成テスト専用**Auth利用者（作者・読者・運営）を作り、Production/共有Stagingからユーザーやパスワードを複製しない。正式掲示板RPCの作者プロフィール作成後10分の制限を維持し、データを偽装して時間制限を回避しない。

Preview側の`NOVELIGHT_ADMIN_EMAILS`はテスト運営の1件だけとし、`/api/admin-community`のサービスロールは隔離DB用に固定する。PreviewのSupabase公開キー／サーバーSecretの参照先と、Stripeのtest modeを確認する。これらが確認されるまでは隔離DBをONにせず、保護Previewを起動しない。

`scripts/community-phase2-synthetic-fixture-readiness.mjs`は実行時証跡の**形・整合性**のみ検証する。提出されたJSONを本物のプロバイダー証跡と認証する機能は持たない。実際のプロビジョン／環境接続／課金Grantは未実装であり、なおStaging実行は不可。

## Phase 2 隔離ブランチアダプタ（未呼び出し）

`scripts/community-phase2-branch-manager.mjs` は既存のPhase 1 API
transportを元に、scope `community-phase2-joint-hosted-authenticated-write`
の**独立Protected Grantを引数として必須**にしたもの。
データなし・一回限りのbranchのみの作成、タイムアウト時の再GET照合、
削除直前の同一ID＋parent照合に対応する。Production本体と共有Staging
をbranch refとして拒否する。

これは保護ランナーから呼べるAPIアダプタであり、単体では秘密鍵取得・
approval発行・外部実行・課金上限設定・Staging起動を行わない。
追加により本Draft PRには**潜在的な外部副作用を持つexported関数が含まれる**。
既存の`read-only` admission workflowはこれをimport／実行しない。
そのため実運用への反映時には、read-only規約だけではなくPhase 2の
専用外部書き込みアダプタとしてセキュリティ審査が必要。

## Phase 2のPreview個別削除アダプタ（2026-10-23、未呼び出し）

`scripts/community-phase2-preview-cleanup.mjs`は、独立OWNER
保護Grantを要求し、対象Vercelデプロイが
チーム／プロジェクト／PR HEAD／Git ref／`target=preview`
／`.vercel.app`に完全一致する場合だけ、
公式の `DELETE /v13/deployments/{id}` を実行する。
削除前GETと削除後404の再取得を必須とし、プロジェクト全削除、
Productionデプロイ、他人のPreview、別PR SHAには触れない。
参照：Vercel REST API公式 `https://vercel.com/docs/rest-api`。

**注意:** 今回のPRは候補の書き込み可能APIアダプタのソースと
モックテストを含むが、Workflowから呼び出されていない。
実際の削除・Preview生成・GitHub承認操作は行っていない。


## Branch作成の曖昧成功からの回復（2026-10-23修正）

Supabaseブランチ生成POSTがtimeout／応答不正の場合、GETで同名ブランチを一度照合する。見つかったブランチの返却値は `{status:'BRANCH_FOUND_REQUIRES_CLEANUP',created:{...}}` なので、Phase 2実行コーディネータは `created` を安全な削除用入力として取り出す。**曖昧な作成結果からDB migration・Preview生成へ続行することは禁止**し、cleanupとONE-USE CONSUMEDを実施する。見つからなくてもPOSTを再試行しない。独立Watchdogは未消去の同名ブランチを監視する必要がある。これらはmock検証のみ、実際のbranchを作成・削除していない。


## Ambiguous Preview作成の費用残留防止（2026-10-23）

Vercel Preview POSTがtimeout／不正応答になった場合、実際のデプロイが作成済みかもしれない。Phase 2独立runnerの契約に`reconcileProtectedPreview`を必須化し、作成と同じRUN/HEAD/Branch/Project/Teamへ厳密に束縛したGET結果が見つかった場合に限り、そのdeployed IDを後片付けへ渡す。曖昧POSTの後に二度目のPreviewを作成したり、ユーザーブラウザの試験を続行したりしない。独立WatchdogにはSupabaseだけでなくVercel Preview回収可否の準備証跡も要求する。正常にPreview作成した場合も`deploymentId`等の削除証跡を後片付けまで保持する。実際のadapter/runnerは別途実装・審査が必要。


## 同期例外でも独立した削除を全件試みる（2026-10-23）

Phase 2の後片付けにおける`Promise.allSettled([fnA(), fnB()])`は、
引数の評価時に`fnA()`が**同期例外**を投げると
`fnB()`を一度も呼び出さず、最終的なCLAIM消費記録まで飛ばす。
現在の実装はそれぞれを`Promise.resolve().then(() => fn())`
で包み、片側の同期例外でももう一方の資源削除とread-backを試す。
削除のどちらかが失敗した場合はSUCCESSとせず、失敗をCONSUMED
記録する。Nodeの2つの同期例外テストで確認する。
現状は契約・モックだけの修正で、実際のPreviewやbranchに触れない。


## 実Vercel Previewレスポンスと削除先照合（2026-10-23）

Vercel接続済みAPIのread-only実例では、既存PreviewのGET情報は
`target:null`、`project:{id, name, framework}`、`ownerId`は省略、
`alias`はvercel.app上の追加エイリアス配列だった。旧アダプタは
`projectId`・`ownerId`・`target:'preview'`を必須にしていたため、
正当な隔離Previewでも削除できずに費用が残る可能性があった。

`community-phase2-preview-cleanup.mjs`は次の両方を受け付ける：
providerのフラット`projectId`形式、または実観測と同じ
`project.id`形式。ただしproject ID不一致、フラットとネスト間の矛盾、
既知のownerId不一致は拒否。実観測の`target:null`と`preview`のみ
許可し、Productionや別custom environmentは禁止する。
全aliasは非Production vercel.appドメインのみ許可し、
Production alias／独自ドメインがあれば削除を拒否する。
元の「認証付きTeamIdクエリ＋対象Deployment ID＋Git SHA＋Ref＋
Preview URL＋削除前のGET＋削除後404確認」をすべて維持。
これは実際のPreviewの**情報構造**に合わせた修正で、削除操作は行わない。
