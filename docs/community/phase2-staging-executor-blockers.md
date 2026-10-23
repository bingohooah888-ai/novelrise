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
