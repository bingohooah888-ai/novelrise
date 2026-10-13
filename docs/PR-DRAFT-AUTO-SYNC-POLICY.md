# NOVELIGHT — Owner Draft PRの自動同期（GitHub標準トークン方式・検証中）

## 目的と非対象

「Update branch → Update with merge commit」を原則自動化し、専用GitHub App・PATの作成とSecret入力を不要にする。

**ブランチ更新だけ**を自動化する。PR承認、Draft解除、マージ、migration適用、Vercel/Supabase変更、コンテスト公開、Cron、賞金管理は既存の独立したゲートを通す。

## GitHub Actions標準トークン方式

- 信頼済みのmain上で `.github/workflows/novelight-pr-auto-sync.yml` を起動。
- `GITHUB_TOKEN` の `pull-requests: write` で、同一repoのowner作成・Open・Draft・base=mainのPRにだけ正式API `update-branch` を適用。force pushやrebaseはしない。
- 更新直前にlatest mainとPR headのSHAを再検査。競合、未知のmergeability、すでに高リスク承認済み、更新中のhead変更はfail-closed。
- main更新時は直近24時間のDraft PRだけ。最大8件。休眠PRは指定されたworkflow_dispatchでだけ同期可能。
- `GITHUB_TOKEN` による更新後、通常のpull_request CIが自動実行されない、または手動実行承認待ちになることがある。そのため更新後の**新しいPR head SHA**をポーリング確認し、同じ `GITHUB_TOKEN` で `ci.yml` と `codeql.yml` の `workflow_dispatch` を明示起動する。
- workflow_dispatch入力はPR番号・新head SHAだけ。CI/CodeQLの起動先はそのPRの同一repoブランチに限る。更新後のmainが再び動いたらdispatchしない。
- dispatchされたCI/CodeQLは実行開始時に `novelight-pr-sync-dispatch-guard.mjs` でGitHub APIの現在PRとブランチのSHA、owner、main祖先関係を確認する。未知・改ざん・時差があれば停止。
- CIのMerge readinessは**pull_requestだけでなくこの検証済みworkflow_dispatchでも必須**。doc registry、main ancestry、head-bound OWNERの高リスク承認は省略しない。高リスク承認ワークフローも同じhead SHAのdispatch/PR CIだけを採用し、失敗チェックだけ再実行する。
- 実行用トークンは個別Secretを使わず、Actions標準 `github.token` を使用。PR作成者の未信頼PRヘッドを高権限でcheckoutすることは禁止。CIとCodeQLは最小の読み取り・解析権限を維持。

## 導入前の必須実地検証

1. このDraft PRのNode契約テスト・RLS・Actions lint・CodeQLを通す。
2. 専用トークン不要方式の本番マージは**新規「本番承認」必須**。前回のPR #2207承認は使い回さない。
3. 本番導入後、owner Draftの無害なテストPRで、main更新→update-branch→正しい新head SHAへのworkflow_dispatch→CI/CodeQLの完了を確認。
4. **重要:** GitHubのブランチ保護がdispatchで作られたチェックを当該PRの必須チェックとして認識すること、正式な高リスク承認後にのみそのチェックが成功することを検証する。関連付けが不十分なら自動運用を有効化せず、手動同期へ戻す。必須チェックの無効化、ルール緩和、admin overrideは禁止。
5. NLO Capability Registryのstatusは実地検証まで `testing` のまま。正式承認・実地成功後だけ `enabled` へ変更する。

## 緊急停止と戻し方

Workflowを無効にすると以後の自動同期が停止する。以前のGitHub Update branch手動手順へ戻す。PRのforce-pushや履歴書換えは行わない。追加Secretは不要なので削除作業もない。

詳細実装：`scripts/novelight-pr-auto-sync.mjs`、`scripts/novelight-pr-sync-dispatch-guard.mjs`、`.github/workflows/novelight-pr-auto-sync.yml`、`.github/workflows/ci.yml`、`.github/workflows/codeql.yml`、`.github/workflows/high-risk-pr-approval.yml`。
