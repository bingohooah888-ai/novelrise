# NLO MASTER Sync

NLO（NOVELIGHT Commander）のMASTER同期機能は、ChatGPT Projectに古いMASTERが残り、新しいチャットが旧仕様をCurrent Stateとして参照する事故を防ぐための機能です。

## Source of Truth

現行MASTERの唯一の取得元は、毎回 `git fetch origin main --prune` 後の exact `origin/main` 上にある次のファイルです。

`docs/NOVELIGHT-MASTER.md`

Project添付ファイル、Libraryコピー、過去チャット、ローカルの古いMASTERを現行正本として採用しません。

取得時は `origin/main` のcommit SHAとMASTER本文のSHA-256を記録し、NLO data rootの `master-sync/` に次の形式で保存します。

`NOVELIGHT-MASTER-CURRENT-<mainSha12>-<contentSha12>.md`

`CURRENT.json` にsource / main SHA / content SHA-256 / prepared fileを保存します。

## Validation

Project同期前に、取得したMASTERが少なくとも以下を満たすことを確認します。

- `NOVELIGHT MASTER` の正本タイトルがある
- `最終更新` がある
- NLO First Policy または明示的な NLO / DC 絶対分離ルールがある
- NLOがNOVELIGHT Commanderであることを確認できる
- NLOとRemote Desktop Commander / DCが別物であることを確認できる
- DCのonline/offline状態だけでNLOの状態を判定しない境界がある
- 想定外に短いファイルではない

章番号や見出し番号そのものは検証条件にしません。正式な正本である `docs/NOVELIGHT-MASTER.md` の意味上の安全境界を検証し、過去のLibraryコピー固有の章番号へvalidatorを固定しません。

検証に失敗した場合はProjectを変更しません。

## GitHub Bridge actions

専用request prefix:

`NOVELIGHT_MASTER_SYNC_REQUEST `

専用result prefix:

`NOVELIGHT_MASTER_SYNC_RESULT_V1`

### master_prepare

read-only。最新mainからMASTERを取得・検証・SHA固定し、NLO data rootへ準備します。

```text
NOVELIGHT_MASTER_SYNC_REQUEST {"version":1,"requestId":"cmdr-YYYYMMDDTHHMMSSZ-master-prepare","action":"master_prepare","args":{}}
```

### master_sync_project

ChatGPT ProjectのMASTERを同期します。Project mutationなので固定confirmationが必要です。

```text
NOVELIGHT_MASTER_SYNC_REQUEST {"version":1,"requestId":"cmdr-YYYYMMDDTHHMMSSZ-master-project-sync","action":"master_sync_project","args":{"projectName":"NOVELIGHT","projectUrl":"","confirmation":"SYNC_CHATGPT_PROJECT_MASTER","cdpUrl":"http://127.0.0.1:9222"}}
```

`projectUrl` は `https://chatgpt.com` のProject URLだけを許可します。空文字の場合は `projectName` からProjectを特定します。CDPはlocalhostだけを許可します。

## Mutation order

削除先行は禁止です。必ず次の順番で実行します。

1. latest `origin/main` を取得
2. exact main上のMASTERを取得
3. MASTER内容とSHAを検証
4. ChatGPT Projectを特定
5. 新しいCURRENT MASTERをアップロード
6. 新しいファイル名がProject UI上に見えることを確認
7. その後でのみ旧 `NOVELIGHT-MASTER*` を削除
8. 最後に旧MASTERが残っていないことを再確認

新しいMASTERのアップロードまたは可視確認に失敗した場合、既存MASTERは削除しません。

旧MASTERの削除は、対象ファイル行に明確なmenu/options buttonが認識できた場合だけ行います。曖昧なボタンを推測してクリックしません。削除UIを安全に認識できなければ、新MASTERを残したままfail closedします。

## Browser ownership

Remote Desktop Commander / DCは依存先ではありません。

- localhost CDPで既存Chromeへ接続できる場合、NLOは専用の新規タブだけを使い、既存Chrome本体を閉じません。
- CDPが利用できない場合、NLO専用persistent Chrome profileを起動します。
- NLO専用profileでChatGPTログインが必要な場合は `LOGIN_REQUIRED` を返し、ブラウザを開いたままにします。
- ユーザーがそのNLO専用Chromeで一度ログインした後、同じCDP/profileを再利用して同期を継続できます。

## NLO / DC separation

この機能はNLOのGitHub Bridgeから実行します。`Remote_Desktop_Commander` namespaceをNLOとして扱ったり、DCのonline/offline状態からNLOの状態を推測したりしてはいけません。

NLOの実行口がチャット上に露出していない場合でも、それだけでNLOをofflineと判断しません。NLO自身のhealth/statusが明示的にofflineを返した場合のみofflineとして扱います。
