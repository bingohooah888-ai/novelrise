# Repository Guidelines

## 1. 最上位方針

`docs/NOVELIGHT-MASTER.md` をNOVELIGHTの正式なMASTERとして扱う。思想・3原則・意思決定原則・安全原則と矛盾する実装を行わない。

ただし、**低リスクの局所変更ごとにMASTER全文を読み直すことは要求しない。** 最新 `main` 上のMASTER blob/contentが既に確認済み内容と同一である場合はcontent-addressed reuseを使用する。全文再読はMASTER内容が変わった場合、今回の判断がMASTER本文に依存する場合、またはFULL PREFLIGHT対象の場合に行う。

現在状態の判断では、過去チャット・古いSHA・過去PRより最新 `main` と現在branch diffを優先する。

## 2. NLO永続実行ポリシー

NOVELIGHT実装では `docs/NLO-EXECUTION-POLICY.md` を必ず適用する。

NLOの能力不足・自己拡張では `docs/NLO-SELF-EXPANSION-POLICY.md` も必ず適用する。必要な能力がないことをNOVELIGHT作業の終端理由にせず、Capability Registryを確認し、再利用価値のある不足は `capability_gap` として安全な範囲で恒久能力化する。

チャット記憶に依存して実行方法を決めない。新しいチャット・別エージェントでもrepoのこのポリシーを基準にする。

NLOとRemote Desktop Commander（DC）は別物である。NLOが指定されている作業でDCをNLOとして代用・混同しない。DC deviceがofflineでも、それ単独ではNLO offlineと判定しない。直接NLO MCPが見えない場合はIssue #797の正式 `nlo_health` Bridge経路を確認する。


## 2.5 Preview / Staging コストゲート

チャット記憶に依存せず、Vercel Preview / Supabase Stagingの実行は既定で禁止する。通常のbranch push、PR、CI、FAST PATCHを理由にPreviewやStaging Smokeを自動起動しない。

次を実行する直前には、最新main上のMASTERで定める明示的な「ステージング承認」が必要。

- Vercel Preview deploymentの作成・Redeploy
- Supabase Stagingへのwrite / migration sync
- Staging Smoke / E2E / Live Proof
- Staging専用Preview ref更新と、それに続くPreview生成

「はい」「続けて」「承認」「本番承認」はステージング承認の代用にしない。承認はexact main SHA + scope + 1回の実行へ束縛し、完了後はDefault-Denyへ戻す。

Vercel Git integrationは `main` 以外の自動deploymentを禁止する。Staging workflowはPR / push / deployment_status / 無条件workflow_dispatchから起動せず、Issue #188等のOWNER機械可読Staging approval経路だけを入口とする。

read-onlyの設定・請求・ログ確認はこのゲートの対象外。

## 3. 最初にリスク分類する

実装開始時に、作業を次のどちらかへ分類する。

### FAST PATCH — 低リスクの既定モード

次のような局所・可逆変更はFAST PATCHを使う。

- ボタン、リンク、文言
- CSS、余白、整列、サイズ
- ロゴ、画像、アイコン参照
- 既存UIの小さな表示修正
- 非機密の小規模バグ修正
- 依頼範囲が明確なテスト・文書修正

FAST PATCHの固定順序:

1. 最新 `origin/main` を1回だけ確認する
2. `npm run nlo:fast-patch -- --stage=before --target=<path> --workstream=<name>`
3. 対象ファイルと直接依存だけ読む
4. 最新コードですでに依頼を満たす場合はno-opで終了する
5. 指定範囲だけ変更する
6. 対象に必要な最小限の検証を行う
7. diffを確認する
8. `npm run nlo:fast-patch -- --stage=after --workstream=<name>`
9. 完了する

FAST PATCHでは、依頼自体が必要としない限りMASTER全文再読、Production SHA確認、過去PR/チャット調査、Web調査、repo全体監査、専門家スウォーム、全テスト、無関係refactorを行わない。

同一タスク内で、入力が変わっていない同じ確認・検索・テストを「念のため」で繰り返さない。

### FULL PREFLIGHT — 高リスク

以下は必ず `docs/WORK-EXECUTION-PREFLIGHT.md` と既存Runtime Gateを使う。

- Auth / session
- Stripe / 課金 / entitlement
- Supabase RLS / 権限 / 個人情報 / Secret
- DB migration / schema / data mutation / deletion
- Production外部state mutation
- deploy / workflow / approval / rollback / infrastructure
- セキュリティ境界
- dependency追加・更新
- 横断アーキテクチャ変更
- 不可逆・rollback困難
- `AGENTS.md`、NLO policy、Preflight、Runtime Gate等の安全・承認境界変更
- リスクまたは影響範囲が不明
- ユーザーが全体監査を要求

FAST PATCH Machine Gateが拒否した場合は、回避せずFULL PREFLIGHTへ昇格する。

## 4. 現在状態と履歴

Source of Truthの優先順位:

1. 現在のユーザー明示指示
2. 最新 `main` + 現在branch diff
3. 現行repo policy
4. `.git/novelight-nlo-state.json`
5. 過去PR / Issue / chat / log / old SHA

過去履歴は、回帰原因・provenance・過去判断など依頼上必要な場合だけ読む。

「古いチャットにそう書いてあった」ことを理由に最新コードを戻さない。

## 5. 完了済み作業をやり直さない

完了判定は現在repoで行う。

stateに完了記録があり、最新コードが依頼を満たす場合は再実装しない。no-opとして報告して終了する。

完了済みworkstreamを、過去会話の曖昧さだけを理由に再実行しない。

## 6. Scope Lock

FAST PATCHでは依頼された対象と直接依存以外を変更しない。

別の問題を発見しても同じpatchへ混ぜない。重大なsecurity問題の場合のみFULL PREFLIGHTへ昇格する。

ユーザーが「最短」「余計な仕事をしない」「これだけ」と指定した場合は、低リスクである限りScope Lockを特に厳格にする。

## 7. Runtime State

NLOの実行stateは `.git/novelight-nlo-state.json` に保存する。

schemaは `.novelight/nlo-state.schema.json`。

stateは高速化キャッシュでありSource of Truthではない。policy version不一致、破損、main不整合では捨てて必要な確認だけ再構築する。

同じfingerprintの確認を同一状態で反復しない。

## 8. テスト方針

検証量はリスク比例とする。

FAST PATCH:

- 対象に直接必要なlint / syntax / focused test / visual checkのみ
- diff check

FULL PREFLIGHT:

- 変更領域に応じたCI / DB / RLS / E2E / security checks
- Production変更は既存安全ゲートを維持

`npm run preflight:full` を通常のUI微修正へ機械的に使わない。

## 9. 実行カード・進捗報告

ユーザー可視の進捗は、長い作業または判断材料があるときに簡潔に行う。

FAST PATCHで、単なるツール利用を理由に毎ターン重いExecution Cardの再構築を必須にしない。前回から作業目的・risk・scopeが変わっていない継続では同じ説明を反復しない。

FULL PREFLIGHT、Production mutation、Secret、2FA/OAuth、人間判断が必要な場面では既存のExecution/Approval Gateを維持する。

## Runtime Execution Gate

この節は **FULL PREFLIGHTにのみ適用**する。FAST PATCHは `docs/NLO-EXECUTION-POLICY.md` と `nlo:fast-patch` の機械ゲートを使用し、この重い実行ターン契約を通常の局所変更へ再導入しない。

### Execution Turn Card Gate

FULL PREFLIGHTの**実行ターン**では、そのターンの**最初のユーザー可視メッセージ**を可視実行カードにする。**カード送信前のツール呼び出しは禁止する。** 読み取り専用Bootstrapを含む。ユーザーから新しいメッセージを受けた時点で前ターンのカードは失効し、再利用しない。スクリーンショット、ログ、手動操作完了報告も新しいFULL PREFLIGHT実行ターンとして扱う。

FULL PREFLIGHTでは、`npm run runtime:gate -- --phase=<phase>` を使用する。Connector等でローカルコマンドを使えない場合は、現在ターンの可視実行カード後に **GitHub Connector/APIで最新main SHA、MASTER、Preflightを直接再取得**する同等確認を行う。

時間見積もり表示が上位制約で使えない場合は **Degraded-Continue** を使用できるが、Production、Secret、課金、破壊的操作、安全境界不明を回避する用途には使わない。

ユーザーの「はい」「続けて」「次へ」が判断を伴わない**単なる続行ボタンになる場合は要求しない**。ただしFULL PREFLIGHTでユーザーへターンを返した後に再開する場合は、新しい可視実行カードを先に送る。

## 10. AI / 自動化

AIやツールを増やすこと自体を目的にしない。速度・品質・安全性を実際に改善する最小構成を使う。

低リスク局所変更で複数専門家レビューを一律必須にしない。

認証、RLS、Stripe、権限、個人情報、破壊的migration等では必要に応じて独立レビューを追加する。

NLOで必要能力が見つからない場合、単に別手段へ逃げて同じ不足を残さない。`.novelight/nlo-capabilities.json` を解決し、再利用価値があれば `capability_gap` を記録して `docs/NLO-SELF-EXPANSION-POLICY.md` のA/B/C境界で能力化する。Tier Aは可能な限り同一workstreamで実装・focused test・登録まで進め、Tier Bはbranch/PRまで進め、Tier Cは既存の明示承認境界で停止する。

## 11. GitHub / merge

作業は最新 `main` からwork branchを作成する。直接mainへ編集しない。

通常の低リスクPRは、意図した差分のみ、競合なし、必要CI成功、重大review未解決なしを確認できれば条件付き自動merge対象にできる。

以下は高リスクであり、Productionへ影響するmerge直前にMASTERで定める明示的な「本番承認」を要求する。

- Auth / RLS / Stripe / 課金 / 権限 / 個人情報 / security boundary
- Secret / Production credentials
- migration / Production DB mutation
- Production workflow / deploy infrastructure / approval / rollback
- `docs/NOVELIGHT-MASTER.md` の方針変更
- `AGENTS.md`、`docs/NLO-EXECUTION-POLICY.md`、`docs/WORK-EXECUTION-PREFLIGHT.md`、Runtime Gate等の安全・承認境界変更
- CI/security gateを弱める変更
- rollback不能またはリスク不明

高リスクではCI成功だけで本番承認を省略しない。

## 12. Project / Commands

ユーザー向けページはルートHTML、Vercel APIは `api/`、Node testsは `tests/`、Playwrightは `tests/e2e/`、方針資料は `docs/`、共通運用ロジックは `scripts/`、Supabase migrationは `supabase/migrations/` に置く。

主なコマンド:

- `npm test`
- `npm run lint`
- `npm run syntax:check`
- `npm run nlo:fast-patch -- --stage=before --target=<path> --workstream=<name>`
- `npm run nlo:fast-patch -- --stage=after --workstream=<name>`
- `npm run nlo:capabilities -- validate`
- `npm run nlo:capabilities -- resolve --intent="<intent>" --effect="<effect>"`
- `npm run nlo:capabilities -- record-gap --intent="<intent>" --effect="<effect>"`
- `npm run runtime:gate -- --phase=<phase>` — FULL PREFLIGHT用
- `npm run preflight:fast`
- `npm run preflight:full` — 高リスク・横断変更に限定
- `npm run preflight:db`
- `npm run preflight:e2e`

依存関係を変更する場合は `package.json` と `package-lock.json` を同じ変更として扱う。

## 13. 最終原則

目的は手順を消化することではなく、NOVELIGHTを完成・成長させることである。

安全上意味のある確認は残す。意味のない再確認、履歴再構築、二重実行、範囲外作業は削る。

**低リスクは短く、高リスクは厳格に。**
