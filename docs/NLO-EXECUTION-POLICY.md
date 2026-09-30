# NOVELIGHT NLO EXECUTION POLICY

Version: 1.0

この文書は、チャット・セッション・実行エージェントが変わってもNOVELIGHT開発の実行方法を一定に保つための永続ポリシーである。

目的は、古い履歴の再構築、同じ確認の反復、完了済み作業の再実行、依頼範囲外の調査・修正によって開発時間が膨張することを防ぐことにある。

MASTERの思想・安全原則を置き換えない。高リスク領域では既存の厳格なRuntime Gateを維持する。

## 1. Source of Truth

現在状態の優先順位は次の通りとする。

1. 現在のユーザーの明示指示
2. 最新 `main` のコードと、作業ブランチの現在差分
3. 現在のリポジトリ運用ポリシー
4. `.git/novelight-nlo-state.json` の実行キャッシュ
5. 過去PR・Issue・チャット・ログ・過去SHA

過去PR・過去チャット・古いSHAは、現在状態の代替として使用しない。

履歴を調べてよいのは、回帰原因、provenance、過去判断の理由、特定PRの検証など、依頼そのものが履歴を必要とする場合だけとする。

## 2. 実行モード

NLOの実装作業は必ず次のどちらかに分類する。

### FAST PATCH

低リスク・局所・可逆な変更の既定モード。

例:

- ボタン、ラベル、文言、リンクの追加・修正
- CSS、余白、整列、サイズ、単純なレイアウト調整
- 画像・アイコン・ロゴ参照の差し替え
- 既存UIコンポーネントの局所的な表示修正
- 非機密な小規模バグ修正
- 依頼範囲が明確なテスト・文書修正

FAST PATCHでは以下を行う。

1. 最新 `origin/main` を1回確認する。
2. 対象ファイルと直接依存だけ確認する。
3. 最新コードですでに依頼を満たしている場合はno-opで終了する。
4. 指定範囲だけ変更する。
5. 変更内容に必要な最小限の検証だけ行う。
6. 最終diffを確認する。
7. 実行stateを更新して終了する。

### FULL PREFLIGHT

次のいずれかに該当する場合は必須。

- Auth / 認証 / セッション
- Stripe / 課金 / 料金 / entitlement
- Supabase RLS / 権限 / 個人情報 / Secret
- DB migration / schema / data migration / deletion
- Production DBまたはProduction外部stateのmutation
- deploy / workflow / approval gate / rollback / infrastructure
- セキュリティ境界
- package dependencyの追加・更新
- 横断的な共有アーキテクチャ変更
- 不可逆またはrollback困難な変更
- `AGENTS.md`、本ポリシー、Preflight、Runtime Gate等の安全・承認境界変更
- 影響範囲またはリスク分類が不明
- ユーザーが明示的に全体監査・FULL PREFLIGHTを要求した場合

FULL PREFLIGHTは `docs/WORK-EXECUTION-PREFLIGHT.md` と既存Runtime Gateに従う。

## 3. FAST PATCHで禁止すること

依頼自体が必要としない限り、FAST PATCHでは以下を行わない。

- MASTER全文の再読
- Production SHAの取得
- 過去PR・過去チャット・過去コミットの広範な再調査
- 一般Web調査
- repo全体監査
- 複数AI・複数専門家による一律レビュー
- 無関係なリファクタ
- 無関係な依存更新
- 全テストスイートの機械的実行
- 依頼されていない機能追加
- 「念のため」だけを理由にした同一確認の再実行

## 4. Anti-loop

同一タスク中に、入力が変わっていない同じ確認を繰り返さない。

チェック結果は `fingerprint + verified_at` としてstateへ記録する。fingerprintが同一で、基礎状態が変わっていない場合は再利用する。

次の行為は禁止する。

- 同じlatest main確認を同一工程で何度も行う
- 同じファイルを理由なく読み直す
- 同じ検索を表現だけ変えて反復する
- すでに成功したテストを、入力差分なしで再度実行する
- 完了済みworkstreamを、過去チャットが曖昧という理由だけでやり直す

基礎状態が変わった場合、または安全上の承認前後再確認が必要な場合は再検証してよい。

## 5. 完了済み作業

「完了したか」は記憶ではなく現在repoで判定する。

stateに完了記録があり、現在コードが依頼を満たしている場合は再実装しない。

stateとrepoが矛盾した場合はrepoを優先し、必要な箇所だけ修正する。

過去の完了記録だけを根拠に現在コードを上書きしない。

## 6. Scope Lock

FAST PATCHでは、依頼された機能・対象ファイル・直接依存以外へ変更を広げない。

別問題を発見しても、現在の依頼に必要でなければ同じpatchへ混ぜない。重大なセキュリティ問題を発見した場合のみ作業を停止またはFULL PREFLIGHTへ昇格し、理由を明示する。

## 7. State

機械実行stateは `.git/novelight-nlo-state.json` に保存する。Git管理しない。

stateは高速化用キャッシュであり、Source of Truthではない。削除されても安全に再構築できなければならない。

state schemaは `.novelight/nlo-state.schema.json` を基準とする。

stateには少なくとも以下を保持する。

- policy version
- latest verified main SHA
- current mode
- active workstream
- recently completed workstreams
- check fingerprints
- verification timestamps

policy version不一致、main不整合、破損stateではキャッシュを捨て、必要な確認だけ再実行する。

## 8. FAST PATCH Machine Gate

FAST PATCH開始時は次を使用する。

```bash
npm run nlo:fast-patch -- --stage=before --target=<path> --workstream=<name>
```

変更後は次を使用する。

```bash
npm run nlo:fast-patch -- --stage=after --workstream=<name>
```

Machine Gateは高リスクpathを検出した場合FAST PATCHを拒否する。その場合はFULL PREFLIGHTへ昇格する。

## 9. 検証量

検証はリスク比例とする。

FAST PATCH:

- 対象に直接関係するlint / syntax / test / visual check
- diff check
- 必要なものだけ

FULL PREFLIGHT:

- 既存のRuntime Gate
- 変更領域に応じたCI / DB / RLS / E2E / security checks
- Production変更では既存承認境界を維持

「テストが多いほど安全」とは扱わない。無関係な検証の反復は安全性ではなく待ち時間を増やす。

## 10. User Override

ユーザーが「最短で」「余計なことをしないで」「対象だけ」と指示した場合、低リスクならFAST PATCHを優先する。

ただしFULL PREFLIGHT必須条件に該当する場合は速度指示より安全境界を優先し、短く理由を示す。

ユーザーが明示的に「全体監査」「徹底確認」を要求した場合はFAST PATCHを使わない。

## 11. 別チャット・別エージェント

このポリシーはチャット記憶に依存しない。

新しいチャットや別エージェントでも、repoの `AGENTS.md` から本ポリシーへ到達し、現在repo + stateを基準にモード判定する。

過去会話を再構築してから作業開始する方式へ戻さない。
