# NOVELIGHT — Owner Draft PR自動同期（導入前・Draft）

## 目的

毎回GitHub画面で「Update branch → Update with merge commit」を押す手作業をなくす。**自動で行うのはPRブランチに最新mainを取り込むことだけ**。本番承認、Draft解除、マージ、DB migration、deploy、コンテストやCronの有効化は従来の独立した承認・品質ゲートを守る。

- Workflow: .github/workflows/novelight-pr-auto-sync.yml
- Adapter: scripts/novelight-pr-auto-sync.mjs
- Contract tests: tests/novelight-pr-auto-sync.test.mjs
- NLO capability: nlo.github.owner-draft-pr-sync（status: testing、まだenabledではない）

## 自動実行

1. mainへのpush・マージ後、owner自身が作成したOpen/Draft PRを検出する。
2. Draft PRを作成・再開・Draftに戻したとき、そのPRだけ検査する。
3. 管理者が緊急時にworkflow_dispatchを実行する場合、明示のPR番号を必要とする。

## 一度だけ必要になる認証設定

本番導入後、GitHub Actions Repository Secret NOVELIGHT_BRANCH_SYNC_TOKENを設定する。GitHub App installation tokenか、当該リポジトリだけに限定したfine-grained PATを使う。必要なアクセスは少なくともContents Read/Write、Pull requests Read/Write。PATを使う場合は有効期限管理が必要。資格情報自体をChat・Issue・PR・コードに記載しない。

**GitHub Actionsの標準GITHUB_TOKENでは、branch更新から別のCIが自動起動しない場合がある。** そのため別資格情報を必須にする。未設定ならWorkflowが明確に失敗し、PRは変更しない。同期後のCI/CodeQLイベントが起動したことは導入後の実環境検証で別途確認する。

## セキュリティ境界

- mainのtrusted codeのみcheckoutし、PRが提出したコードやWorkflowをcheckout/実行しない。
- 同じrepoでownerが作成した、base=main、OpenかつDraftでauto-merge予約なしのPRだけ。
- 高リスク本番承認コメントが存在するPR、Ready for review済みPRは変更しない。承認時のexact head SHAを保存するため。
- GitHub compare APIでbehindを判定。競合、未知のmergeability、read/permissionエラーでは更新しない。
- 更新直前にmain SHAとPR head SHAを再取得する。ズレがあればfail closed。
- GitHub公式update-branch APIにexpected_head_shaを付ける。force push、rebaseは使わない。
- 1回8 PRまで。100件に達して全件列挙できない場合は安全停止する。
- Workflow本体のGITHUB_TOKENはread-only。書込Credentialはupdate-branch APIだけに使用。
- 既存のCI・CodeQL・branch protection・本番承認・migration承認は変更しない。
- Preview、Staging、Cron、公開フラグなどは変更しない。

## 導入ゲート

1. このDraft PRでコード・単体テスト・CI/CodeQLを確認。
2. **自動同期Workflowの本番導入は新規「本番承認」が必要。** 工程⑨PR #2204に対する以前の本番承認を流用しない。
3. TokenのSecret登録は本人が最初の一度だけ行う可能性がある。
4. 安全なowner Draft PRで main更新 → Update branch → PR synchronize → CI/CodeQL が正常発火するか実地確認。未確認なら稼働完了を宣言しない。
5. 検証後にだけNLO registry statusをtestingからenabledへ昇格。NLO Bridgeのallowlistに同期操作が必要な場合は、別のセキュリティレビュー・明示承認対象とする。

## 停止・rollback

Workflowの無効化とSecret削除で自動処理を停止できる。既存のUpdate branch手動操作に戻せる。強制履歴書換えは行わない。
