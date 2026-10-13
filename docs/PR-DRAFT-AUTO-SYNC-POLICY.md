# NOVELIGHT — Owner Draft PR自動同期（NLO既存GitHub認証方式・検証中）

## 目的
GitHubの「Update branch」の手動操作をなくす。新しいPATの作成、GitHub Actions Secretの追加、ブランチ保護の緩和を不要にする。ただしGitHubへの更新には認証が必要であり、**無認証方式ではない**。既存のNLOがWindows DPAPIで保護・再利用しているGitHub owner認証を使う。

## GITHUB_TOKEN-only案を採用しない理由
GitHub Actions標準のGITHUB_TOKENからPRを更新すると、後続のpull_request CIは実行承認が必要になる。workflow_dispatchでCI/CodeQLを起動しても、そのjobのチェックはPRのrequired status checkを満たさない。mainのruleset Protect main はGitHub Actions由来の check を必須としており、従来案では要求を満たせない。
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

## 実装
- NLOの既存常駐Bridge内で `tools/novelight-commander/src/owner-draft-auto-sync.js` を起動する。15分ごとに実行し、Registryの状態が `enabled` でなければ**更新しない**。
- `NOVELIGHT_BRIDGE_GITHUB_TOKEN` は、既存の `run-github-bridge.ps1` がDPAPIの認証を復号し、必要時はログイン済み `gh` のowner sessionから安全に復旧するもの。Chat、Issue、Gitに資格情報を保存しない。新しいPATやActions Secretを登録しない。
- GitHub API `/user` のloginを `bingohooah888-ai` と厳密に確認してから、`scripts/novelight-pr-auto-sync.mjs` を呼ぶ。ownerでない場合、API失敗時、権限不足時はfail closed。
- owner作成・同一repo・base=main・Open/Draft・auto-mergeなしのPRに限定する。活動24時間以内、最大8PR。高リスク承認コメントがあればHEADを変更しない。
- update直前にmain HEADとPR HEADを再確認する。GitHub `update-branch` APIへ `expected_head_sha` を渡す。競合時や状態不明時、レース、コメント100件以上では安全停止。force push/rebaseは行わない。
- NLOのowner認証経由の同期で正規の `pull_request: synchronize` が発火し、既存CIとCodeQLがPRチェックとして動く設計。同期スクリプト自身はworkflow_dispatchしない。PR承認、Draft解除、PRマージ、Production変更はしない。
- mainへのmergeがGitHub Actions tokenで行われても、NLOの定期pollingが新しいmainを観測するため、main pushイベントに依存しない。

## ロールアウト手順と制約
1. このDraft PRのコード、Node tests、Static quality、CodeQL、Actions semantic lintでまず検証する。安全のためNLO Capability Registryの `nlo.github.owner-draft-pr-sync` は `testing` のまま。
2. 新規「本番承認」後に限りmainへmergeする。従来の高リスクSHA承認ルールを迂回しない。
3. main反映後、NLOを安全な既存経路で更新・再起動し、実際にowner認証が有効なことを確認する。NLOが停止/PCが停止/gh authが失効している場合は自動同期できない。
4. 害のないowner Draft PRで、main追従更新→通常のpull_request CI/CodeQL起動→必須 check のPR紐付け→高リスク未承認の保護を実地で検証する。
5. その後のみRegistry status を `enabled` にする。安全な試験中以外はデフォルト停止。動作確認後もPR自動マージは認めない。
6. この機能の検証は新しいPATもGitHub Actions Secretも不要だが、既存のNLO GitHub認証の維持は必要。

## コスト対策と緊急停止
- 15分間隔、24時間活動限定、8PRまで、up-to-dateならupdate/CIを発生させない。古いDraftは明示的対象外。
- Registryを `testing` または `disabled` にすれば次回pollから更新しない。NLOのBridgeが使えなくても既存の手動Update branchは利用できる。
- ブランチ保護、required checks、CodeQLルール、Preview/Staging、本番承認は変更しない。
