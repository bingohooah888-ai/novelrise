# NOVELIGHT Commander GitHub Bridge

## 目的

Desktop Commanderの月間上限に依存せず、ChatGPTからGitHubを経由してNOVELIGHT用Windows PCへ限定的なローカル処理を依頼するためのBridgeです。

公開repositoryへself-hosted runnerを直接接続する方式は採用しません。公開PR由来のworkflowからローカルPCを実行対象にできる余地を作らないためです。

## 実行経路

ChatGPT / GitHub接続 → OWNERコメント → PC上のNOVELIGHT Commander polling daemon → allowlist action実行 → OWNER Issueへ結果コメント

PC側daemonがGitHub Issueを外向きにpollするだけなので、Windowsへ受信ポートを開けません。

## Control Issue

OWNERが1件だけ作成します。

- title: `[NOVELIGHT Commander] Local Bridge`
- body先頭: `NOVELIGHT_COMMANDER_CONTROL_V1`

daemonはIssueの作成者、title、markerを毎回検証します。

## Request contract

OWNERコメントは1行の固定prefix + JSONです。

```text
NOVELIGHT_COMMANDER_REQUEST {"version":1,"requestId":"cmdr-20260922T070500Z-a1b2c3d4","action":"doctor","args":{}}
```

requestIdは再利用できません。daemonは処理済みrequestIdをローカルstateへ保持します。

## 許可action

- `doctor`
- `repo_snapshot`
- `preflight_fast`
- `commander_check`
- `novel_fetch`
- `thumbnail_production_readiness`
- `thumbnail_register_production`
- `thumbnail_validate`
- `bridge_update`

任意shell、任意PowerShell、任意Nodeコード、main push、PR mergeは受け付けません。Production mutationは公式サムネイル登録専用の `thumbnail_register_production` だけを許可します。対象はDownloads直下の `NOVELIGHT_*.zip` に限定し、ZIP内manifestの全件検証と固定確認文字列 `REGISTER_OFFICIAL_THUMBNAIL_PACK` を必須とします。既存SHAはスキップし、同名別内容はfail-closedで停止します。`bridge_update` は、ローカルrepoが `main`・clean・`origin/main` のfast-forward祖先である場合に限り、`git pull --ff-only origin main` を実行してBridgeを安全に再起動します。

## GitHub認証

PC側だけにfine-grained Personal Access Tokenを保存します。

対象repository:

```text
bingohooah888-ai/novelrise のみ
```

必要権限:

- Metadata: Read
- Issues: Read and write

TokenはPowerShellのSecureStringとして受け取り、Windows DPAPIで現在のWindowsユーザーに紐づけて暗号化保存します。平文tokenをrepository、Issue、ChatGPTへ送らないでください。

## 初回設定

Commanderを最新mainへ更新後、GitHub Bridge control issue番号を指定して実行します。

```powershell
cd tools\novelight-commander
powershell -ExecutionPolicy Bypass -File .\configure-github-bridge.ps1 -IssueNumber <ISSUE_NUMBER>
```

secure promptが表示されたらfine-grained tokenをPowerShellへ直接貼り付けます。

設定スクリプトはtokenとControl Issueをその場で検証し、Windowsログイン時のStartup launcherを作成してdaemonを起動します。

## ローカル保存先

既定のdata root:

```text
%USERPROFILE%\Documents\NOVELIGHT-Bridge
```

小説本文などの取得結果はローカルPCだけへ保存します。公開GitHub Issueへ本文は投稿しません。Issueへ返すのはtitle、author、取得話数、complete/failures等の限定メタデータだけです。

Bridge自身のconfig / state / DPAPI token / audit / logは次へ保存します。

```text
%LOCALAPPDATA%\NOVELIGHT\commander-bridge
```

## セキュリティ境界

- comment authorは `bingohooah888-ai` かつGitHub association `OWNER` でなければ無視
- v1 JSONはexact keysで検証
- actionは固定allowlistのみ
- child processは `shell:false`
- local fileはdata root外へのpath traversalを拒否
- 出力はSecretらしい値をredactして上限文字数を設定
- Production credentialはGitHub Issueへ返さず、ローカル環境またはログイン済みSupabase CLIからプロセス内だけで取得する
- Production actionは公式サムネイル登録専用に限定し、固定確認文字列・Downloads直下・manifest全件検証を必須にする

## Production

本番DB、Secret、Stripe、Vercel Production、main merge等は既存NOVELIGHT Production approval flowを使います。このBridgeは通常ローカル開発・検証だけを担当します。


## Windows再起動時のネットワーク待機

Windowsログイン直後にネットワークが未確立でもBridgeプロセスは終了しません。GitHub pollingの失敗は `poll-error` としてローカル監査ログへ記録し、設定されたpoll間隔で自動再試行します。これによりStartup起動がネットワーク初期化より先でも自動復旧します。


## Bridge watchdog

`run-github-bridge.ps1` はBridge daemonの外側でwatchdogとして常駐します。daemonが自己更新や一時的なクラッシュで終了した場合、watchdogは2秒待って再起動します。これにより `bridge_update` は新しいPowerShellプロセスを自分で生成せず、状態保存後に正常終了するだけで最新版へ切り替えられます。


## 公式サムネイルProduction自動登録

事前確認は `thumbnail_production_readiness` を使います。指定できるのはDownloads直下のファイル名だけで、パスは受け付けません。

Production登録は `thumbnail_register_production` を使います。実行条件は次の通りです。

- OWNERのControl Issue要求であること
- ファイル名が `NOVELIGHT_*.zip` であること
- Downloads直下に存在すること
- ZIP内 `manifest.json` の全項目が検証PASSすること
- layer typeが background / base_book / pattern / symbol / frame のいずれかであること
- 固定確認文字列 `REGISTER_OFFICIAL_THUMBNAIL_PACK` が一致すること
- hosted Supabaseのsecret/service-role credentialをローカルで取得できること

credentialはGitHub Issue・repository・bridge logへ出力しません。環境変数に設定されていない場合は、ログイン済みSupabase CLIの `projects api-keys --output json` からローカルプロセス内だけで取得します。

登録処理は既存 `registerOfficialThumbnailPack` を再利用します。既存SHAはスキップし、同じlabelで異なるsourceなら停止し、Storage upload後にDB登録が失敗した場合はアップロード済みobjectを削除します。処理後は対象layerのactive件数を再取得して結果へ返します。
