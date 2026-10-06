# NOVELIGHT WORK EXECUTION PREFLIGHT

本書はNOVELIGHTの高リスク・横断作業に使用するFULL PREFLIGHTである。

低リスクの局所変更は `docs/NLO-EXECUTION-POLICY.md` のFAST PATCHを使用し、本書の全項目を毎回適用しない。

MASTERが常に上位基準であり、本書はMASTERを置き換えない。

## 1. モード判定

作業開始時にまずFAST PATCHかFULL PREFLIGHTかを判定する。

### FAST PATCH

以下をすべて満たす場合に使用できる。

- 変更が局所的で対象が明確
- 可逆
- Auth / 課金 / RLS / DB / Secret / Production外部stateを扱わない
- deploy / workflow / approval / rollback / infrastructureを変更しない
- security boundaryを変更しない
- dependencyを変更しない
- safety policy / Runtime Gateを変更しない
- 影響範囲が明確

FAST PATCH手順は `docs/NLO-EXECUTION-POLICY.md` に従う。

### FULL PREFLIGHT

次のいずれかで必須。

- Auth / session
- Stripe / billing / entitlement
- RLS / authorization / personal data / Secret
- DB migration / schema / data mutation / deletion
- Production外部state mutation
- deploy / CI workflow / approval / rollback / infrastructure
- security boundary
- dependency追加・更新
- 横断的なarchitecture変更
- safety policy / Runtime Gate変更
- rollback困難
- リスク不明
- ユーザーが全体監査を要求

迷う場合はFULL PREFLIGHTを使う。

## 2. FULL PREFLIGHT開始ゲート

FULL PREFLIGHTでは次を1回ずつ確認する。

1. 最新 `origin/main` SHA
2. 最新main上の `docs/NOVELIGHT-MASTER.md`
3. 最新main上の本Preflight
4. `docs/AUTOMATION-CONTINUATION-GATE.md`
5. 今回のProduction / Secret / Environment / Branch境界
6. 現在作業branchが最新mainを基準にしていること

MASTERはcontent-addressed reuseを許可する。同一blob/contentで完全読了証跡が有効なら、main SHAが進んだだけで全文再読しない。成立時の正式状態名は `MASTER_CONTENT_REUSE` とする。

MASTERまたは安全ゲート内容が変わっている場合、今回の判断が該当本文に依存する場合は再読する。

## 3. 実行カード

FAST PATCHでは、単なる局所変更を理由に重いカードを毎ターン再構築しない。

FULL PREFLIGHTでは従来の実行ターン安全契約を維持する。

### 3.1 FULL PREFLIGHT 実行ターン契約

**実行ターン**とは、ユーザーから1通の新しいメッセージを受け、その応答内で高リスクのNOVELIGHTツール呼び出し・外部操作・ファイル変更を行う1回のアシスタントターンを指す。

FULL PREFLIGHTでツールを使用する実行ターンでは、**そのターンの最初のユーザー可視メッセージを可視実行カードにする。カード送信前のツール呼び出しは禁止する。** 読み取り専用BootstrapもこのFULL PREFLIGHT契約では例外にしない。

可視実行カードは現在のFULL PREFLIGHT実行ターンだけで有効とし、**次のユーザーメッセージを受けた時点で必ず失効する。前ターンのカードを再利用してはならない。** 「はい」「続けて」「次へ」、スクリーンショット、ログ、ユーザー本人の手動操作完了報告も新しいFULL PREFLIGHT実行ターンとして扱う。

FAST PATCHはこの実行ターン・ハードリセット契約の対象外であり、`docs/NLO-EXECUTION-POLICY.md` の軽量機械ゲートを使用する。

### 3.2 可視時間報告 Fail-Closed ゲート

FULL PREFLIGHTで時間見積もりを提示できる実行環境では、可視実行カードに以下を含める。

- `トータル予想時間`
- `主要工程` と、必要に応じた主要工程ごとの予想所要時間
- `手動操作` の有無と概算回数
- `待機要否`

実行環境の上位制約で時間情報を提示できない場合は `Degraded-Continue` を使用できる。これはProduction、Secret、課金、破壊的操作、安全境界不明等のHard Fail-Closedを回避するためには使用できない。

### 3.3 短時間外部待機・自動継続ゲート

FULL PREFLIGHTで外部処理待ちが発生し、概ね10分以内で完了確認できる場合は、可能なら同じworkstream内で自動継続する。ユーザーへ返す場合も「実行中です」だけで返していないことを確認し、次に何を判定するかを明示する。

### 3.4 手動操作3回ゲート

FULL PREFLIGHTでユーザー本人の手動操作が3回を超える見込みなら、CLI/API/Connector/Workflow/Scriptによる自動化経路を先に比較する。同じ手動操作を2回連続で依頼した場合も、3回目へ進む前に自動化できないか再評価する。2FA、OAuth、本人Secret入力など自動化できない操作は例外とする。

### 3.5 工程切替・再見積もりゲート

FULL PREFLIGHTで主要工程が変わる場合、残り工程・全体の予想所要時間・主要工程ごとの予想所要時間・手動操作・待機要否を再評価する。FAST PATCHでは、risk/scopeが変わっていない限りこの重い再見積もりを機械的に要求しない。

## 4. 現在状態の優先順位

1. 現在のユーザー明示指示
2. 最新main + 現在branch diff
3. 現行policy
4. Runtime state/cache
5. 過去PR / chat / old SHA / historical logs

履歴は現在状態の代替ではない。

過去履歴を調べるのは、回帰、provenance、過去判断、既存承認証跡等で必要な場合だけにする。

## 5. 重複確認の禁止

同一入力・同一状態で成功済みの確認を理由なく反復しない。

例外:

- Production mutation直前/直後の再確認
- migration pending setの承認前後確認
- rollback/recovery verification
- 権限・security boundaryで状態変化後の再確認
- main/branch/外部stateが実際に変化した場合

安全上意味のある二重確認と、単なる不安による再実行を区別する。

## 6. 調査・AIレビュー

FULL PREFLIGHTでも、Web調査や複数AIレビューを目的化しない。

外部仕様・最新情報が判断に必要な場合だけ調査する。

独立レビューを優先する領域:

- Auth
- RLS / authorization
- Stripe / billing
- personal data
- destructive migration
- Production workflow / approval gate
- security boundary

局所UI変更ではこれらを一律要求しない。

## 7. 実装

- 最新mainからwork branchを使う
- ユーザー依頼外の変更を混ぜない
- 既存機能で満たされている場合は再実装しない
- 大規模refactorを「ついで」に行わない
- dependency更新を無関係なpatchへ混ぜない
- Secretをコード・diff・log・PRへ記録しない

画像生成・画像編集は `docs/IMAGE-EXECUTION-GATE.md` の独立したロック/実行許可契約を維持し、FAST PATCH導入を理由に緩和しない。

## 8. 検証

変更領域に応じて必要なgateだけ実行する。

### Common

- relevant lint / syntax / tests
- `git diff --check`
- final diff review

### DB / RLS

- migration ordering / pending set
- precheck / postcheck
- RLS integration
- rollback/recovery
- Productionでは承認前後のpending set再確認

### Browser / UI

- 対象導線のfocused visual / interaction check
- 必要なviewportのみ
- request-only testを複数projectで無意味に重複させない

### Dependency

- package / lockfile整合
- vulnerability audit

### Deploy / Production

- Previewまたは必要なenvironment確認
- current deployment evidence
- rollback path
- approval boundary

`npm run preflight:full` は高リスク・横断変更に限定する。


## 8.5 Preview / Staging コスト承認

Vercel Preview / Supabase Stagingを実際に使用する工程は、非Productionであっても外部コストを発生させるため、MASTERの「Preview / Staging コスト承認ゲート」を適用する。

実行前に以下をすべて確認する。

- [ ] ユーザーの明示的な「ステージング承認」が現在のworkstreamに存在する
- [ ] approvalをexact current main SHAへ束縛した
- [ ] scope（Preview / full smoke / thumbnail smoke / live proof / migration sync等）が一意
- [ ] 1回限りの実行であり、過去のapprovalを再利用していない
- [ ] Issue #188等の固定されたOWNER機械可読approval経路を使用する
- [ ] PR / push / deployment_status / 無条件workflow_dispatchによる自動起動ではない
- [ ] Production Vercel / Production Supabaseへ到達しないことをfail-closedで確認できる

上記を満たさない場合はPreview / Staging実行を開始しない。read-onlyの設定・請求・ログ確認だけならステージング承認は不要。

## 9. 本番承認

以下はProductionへ状態変化を起こし得るmerge/mutation直前に、MASTERで定める明示的な「本番承認」を要求する。

- Auth / RLS / Stripe / 課金 / entitlement / authorization / personal data
- Secret / Production credentials
- Production DB migration / data mutation / deletion
- Production workflow / deploy infrastructure / approval / rollback
- MASTER方針変更
- `AGENTS.md`、`docs/NLO-EXECUTION-POLICY.md`、本Preflight、Runtime Gate等の安全・承認境界変更
- CI/security gateを弱める変更
- rollback不能またはリスク不明

### 本番承認・機械証跡自動変換ゲート

ユーザーがチャットで明示した「本番承認」を同一承認範囲の唯一の人間承認として扱い、SHA/challenge/Approval Ledger等の機械証跡は自動生成する。同一承認範囲について機械的なSHA/challenge更新だけを理由に人間承認を何度も要求しない。

OWNER本人として機械可読承認を投入できない場合は、人間承認済みという事実を失わず、既存の安全な承認ブリッジまたは手動fallbackへ切り替える。承認済みscopeを拡大してはならない。

## 10. Fast Path互換契約

### SCOUT称号アートワーク Fast Path

MASTERに定義済みのSCOUT称号アートワーク反復実装Fast Pathは維持する。既存の正式素材・provenance・品質contractを変えず、反復登録をまとめて処理できる。

### チャット継続／切替

`docs/CHAT-HANDOFF-PREFLIGHT.md` の基準を維持し、主要工程の安全な区切りでは継続／切替判定を必ず行う。CI・retry・rollback・cleanup等が未完了の途中では、原則として切替を提案しない。

## 11. FAST PATCHへの降格禁止

FULL PREFLIGHT必須条件が判明した後、速度だけを理由にFAST PATCHへ戻さない。

FAST PATCH Machine Gateが拒否したpathを手動で除外・名称変更して回避しない。

## 12. 完了条件

- 意図した差分だけが残っている
- 必要なgateが成功している
- unresolvedな重大指摘がない
- Secret混入がない
- rollback/recovery要件を満たす
- Production承認が必要な場合は取得済み
- Preview / Staging実行が必要な場合は、そのexact SHA + scope + 1回に対するステージング承認を取得済み
- 完了stateを更新

完了後、同じworkstreamを次チャットで再構築・再実行しない。現在repoが満たしているならno-opとする。
