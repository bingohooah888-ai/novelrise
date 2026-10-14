# NOVELIGHT — Owner Draft PR自動同期（NLO既存GitHub認証方式・本番有効化承認待ち）

## 目的
GitHubの「Update branch」の手動操作をなくす。新しいPATの作成、GitHub Actions Secretの追加、ブランチ保護の緩和を不要にする。ただしGitHubへの更新には認証が必要であり、**無認証方式ではない**。既存のNLOがWindows DPAPIで保護・再利用しているGitHub owner認証を使う。

## GITHUB_TOKEN-only案を採用しない理由
GitHub Actions標準のGITHUB_TOKENからPRを更新すると、後続のpull_request CIは実行承認が必要になる。workflow_dispatchでCI/CodeQLを起動しても、そのjobのチェックはPRのrequired status checkを満たさない。mainのruleset Protect main はGitHub Actions由来の check を必須としており、従来案では要求を満たせない。
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

## 実装
- NLOの既存常駐Bridge内で `tools/novelight-commander/src/owner-draft-auto-sync.js` を起動する。15分ごとに実行し、Registryの状態が `enabled` でなければ**更新しない**。
- `NOVELIGHT_BRIDGE_GITHUB_TOKEN` は、既存の `run-github-bridge.ps1` がDPAPIの認証を復号し、必要時はログイン済み `gh` のowner sessionから安全に復旧するもの。Chat、Issue、Gitに資格情報を保存しない。新しいPATやActions Secretを登録しない。**既存fine-grained tokenは対象を `bingohooah888-ai/novelrise` のみに制限し、Pull requests: Read and write と Contents: Read and write の両方が必要**（2026-10-14 実地検証で `Pull requests` のみでは403）。`Contents` は汎用コード書き込み権限なので、credential漏えい防止とDPAPI保管を必須とする。
- GitHub API `/user` のloginを `bingohooah888-ai` と厳密に確認してから、`scripts/novelight-pr-auto-sync.mjs` を呼ぶ。ownerでない場合、API失敗時、権限不足時はfail closed。
- owner作成・同一repo・base=main・Open/Draft・auto-mergeなしのPRに限定する。活動24時間以内、最大8PR。高リスク承認コメントがあればHEADを変更しない。**さらに既存 `scripts/high-risk-approval-lib.mjs` が高リスクと分類するファイルを含むPRは、承認の有無にかかわらず自動同期から除外する**（ファイルの変更前パスも対象）。
- update直前にmain HEADとPR HEADを再確認し、高リスク承認コメントも再取得する。GitHub `update-branch` APIへ `expected_head_sha` を渡す。競合時や状態不明時、レース、コメント100件以上、変更ファイル0件・100件以上・不正形式では安全停止。force push/rebaseは行わない。
- NLOのowner認証経由の同期で正規の `pull_request: synchronize` が発火し、既存CIとCodeQLがPRチェックとして動く設計。同期スクリプト自身はworkflow_dispatchしない。PR承認、Draft解除、PRマージ、Production変更はしない。
- mainへのmergeがGitHub Actions tokenで行われても、NLOの定期pollingが新しいmainを観測するため、main pushイベントに依存しない。

## ロールアウト手順と制約
1. このDraft PRのコード、Node tests、Static quality、CodeQL、Actions semantic lintでまず検証する。安全のためNLO Capability Registryの `nlo.github.owner-draft-pr-sync` は `testing` のまま。
2. 新規「本番承認」後に限りmainへmergeする。従来の高リスクSHA承認ルールを迂回しない。
3. main反映後、NLOを安全な既存経路で更新・再起動し、実際にowner認証が有効なことを確認する。NLOが停止/PCが停止/gh authが失効している場合は自動同期できない。
4. 2026-10-14、使い捨てDraft PR **#2219** でNLO既存owner認証からのnative `update-branch` を実地検証した。PR HEAD `fa1d00a3…` → `170d5055…`、通常の `pull_request` CI run **38445969948** とCodeQL run **38445969877** がともに成功し、後者を含むexact新HEADの必須 `check` も成功。PR #2219は**マージせずclose済み**。main/Productionへの変更なし。
5. 高リスクファイル変更の全件スキップ、承認コメントの後追い再確認、ファイル列挙のフェイルクローズを自動テストで検証する。高リスクPRそのものをGitHub上で実際に更新するテストは**行わない**（高リスクPRは対象から除外する）。
6. Registry status を `enabled` に変更するPRは、対象HEADのCI/CodeQL成功およびオーナーの**新規「本番承認」**を得てmainへマージする。NLOのローカルmainへの安全更新・再起動後にのみ15分pollが有効となる。自動マージは一切認めない。
7. この機能の検証は新しいPATもGitHub Actions Secretも不要だが、既存のNLO GitHub認証（限定repoへのPR/Contents書き込み権限）の維持は必要。

## コスト対策と緊急停止
- 15分間隔、24時間活動限定、8PRまで、up-to-dateならupdate/CIを発生させない。古いDraftと高リスク変更を含むDraftは明示的対象外。
- Registryを `testing` または `disabled` にすれば次回pollから更新しない。NLOのBridgeが使えなくても既存の手動Update branchは利用できる。
- ブランチ保護、required checks、CodeQLルール、Preview/Staging、本番承認は変更しない。
