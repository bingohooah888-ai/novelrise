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

MASTERはcontent-addressed reuseを許可する。同一blob/contentで完全読了証跡が有効なら、main SHAが進んだだけで全文再読しない。

MASTERまたは安全ゲート内容が変わっている場合、今回の判断が該当本文に依存する場合は再読する。

## 3. 実行カード

FULL PREFLIGHT、Production mutation、Secret、2FA/OAuth、人間判断が必要な作業では、現在の実行範囲・主要工程・手動操作・待機・次の判断点をユーザーへ簡潔に可視化する。

同じworkstreamの継続でrisk/scopeが変わっていない場合、同じ説明を毎ターン長文で再構築しない。

安全境界や承認範囲が変わった場合は更新する。

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

同一承認範囲について、機械的なSHA/challenge更新だけを理由に人間承認を何度も要求しない。機械証跡は自動再生成する。

## 10. FAST PATCHへの降格禁止

FULL PREFLIGHT必須条件が判明した後、速度だけを理由にFAST PATCHへ戻さない。

FAST PATCH Machine Gateが拒否したpathを手動で除外・名称変更して回避しない。

## 11. 完了条件

- 意図した差分だけが残っている
- 必要なgateが成功している
- unresolvedな重大指摘がない
- Secret混入がない
- rollback/recovery要件を満たす
- Production承認が必要な場合は取得済み
- 完了stateを更新

完了後、同じworkstreamを次チャットで再構築・再実行しない。現在repoが満たしているならno-opとする。
