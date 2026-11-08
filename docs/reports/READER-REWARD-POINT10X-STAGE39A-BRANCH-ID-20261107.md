# NOVELIGHT β Scout Point10× — Stage 3.9A Branch-identity read-only fix

**判定:** コード・合成テストの修正のみ。Staging実DBは**NO-GO**、第4段階の実Point変換も**NO-GO**。

## 対象と前提

- 承認されたmain: `1e8fc4a7ff05a2796c8bec95f1e050214dad3974`。
- 正式MASTER: `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230` / SHA256 `1938181b477235f43eaa78194f38261edddd52fe4efb82d48913616fa22c2ae6`、5086行。
- `AGENTS.md` blob `3b5d3e5165856574aaa679cd14822d7face397b0`。
- Production親Project ref: `fiepaguycecrredwrcwx`。
- 既存Staging Preview Branch ref: `wmlzjgvxgoyrovdhbqbg`、`name=staging`、`preview_project_status=ACTIVE_HEALTHY`、`persistent=false`、`with_data=false`。現行Supabase MCPのBranch一覧で確認済み。
- Staging refに対する通常Project取得 `GET /v1/projects/wmlzjgvxgoyrovdhbqbg` はNotFound（2026-11-07実観測）。Preview Branchが存在しないことを意味しない。

## Supabase公式契約

今回使用するのは、Supabase公式ドキュメントに記載された以下の**Branchメタデータ専用GET**のみ。

1. `GET https://api.supabase.com/v1/projects/{parentRef}/branches`（Branch一覧）
2. `GET https://api.supabase.com/v1/projects/{parentRef}/branches/staging`（Branch名指定GET）

公式資料:

- https://supabase.com/docs/reference/api/v1-list-all-branches
- https://supabase.com/docs/reference/api/v1-get-a-branch

**使用禁止:** `GET /v1/branches/{branch_id_or_ref}`（Branch設定を返しSecretを含み得る）、`GET /v1/projects/{stagingRef}`（通常Project誤照会）。HTTPメソッドはGET固定。コード・テスト・レポートに認証情報を入れず、GETの生応答はログ出力しない。

公式Branchの公開スキーマは `id`、`name`、`project_ref`、`parent_project_ref`、`is_default`、`preview_project_status`、`persistent`、`with_data` 等。**PostgreSQLのバージョン、DBホスト名、TLSの本人性はBranchメタデータからは証明されない**。

## 今回の変更

- `scripts/scout-point10x-staging-identity-readonly.mjs`
  - 誤ったProject GETを、親Project配下のBranch名GETへ置換。
  - ListとGETの両方を厳密に検査し、対象は`name=staging`かつStaging ref・親refが既定値と一致することを要求。
  - UUID形式のBranch ID一致、非default、`ACTIVE_HEALTHY`、`persistent=false`、`with_data=false`、一覧内の名前/ref競合ゼロを必須にする。不一致・404・401・403・429・JSON解析エラーではSQL以前にHOLD。
  - `expectedDbHost`はStaging ref由来の**固定書式の期待値**と明記。Branch情報がDBの実ホストやPostgreSQLバージョンを証明したとは扱わない。`postgresVersionVerified=false`。
  - 既存の専用DB URL検証・`PGSSLMODE=verify-full`・`PGSSLROOTCERT=system`・`BEGIN READ ONLY; ... ROLLBACK;`とタイムアウトを保持。実DB接続の実行・テストはなし。
- `tests/scout-point10x-staging-identity-readonly.test.mjs`
  - 合成のList/Name GET、ID/ref/親/status/mode不一致、競合、認証失敗、404等、固定URL、Credentialを返すBranch configへのアクセス禁止、Production URL拒否、TLS設計、Runner非公開を検証。
  - Synthetic PASSはStaging実証ではない。
- この報告書のみ追加。既存Workflow・Secret・DB関数・MASTER・AGENTSは変更しない。

## 未実証・遮断

- GitHub Staging `STAGING_DATABASE_URL` Secretの**名前**は登録済み。Staging vars `STAGING_SUPABASE_URL` も登録済み。しかし `SUPABASE_ACCESS_TOKEN` はStaging環境・リポジトリのSecret一覧にない。今回新規登録・変更禁止。
- ChatGPTの接続済みSupabase認証をGitHub Actionsに秘密値なしで転送できる経路は確立していない。Data APIの`STAGING_SUPABASE_SECRET_KEY`を管理APIトークンの代わりにはしない。
- Branch APIと実PostgreSQLサーバーの独立認証、サーバーTLS・バージョン、6表とCronの実在、全Writer停止経路、別環境へのバックアップ復元、90秒以内の実行測定、単発承認台帳CASはすべて未実証。
- 仮に後日管理API用のPATを設定する場合でも、別のOWNER個別承認が必要。Supabase scoped PATは段階提供のため、利用可能な最小read-only Branch権限の有無を別途確認し、Classicな全権限トークンを安易に追加しない。
- 今回の操作回数: Secret実値アクセス 0、Workflow dispatch 0、Staging/Production SQL 0、DB write 0、Writer停止 0、バックアップ作成・復元 0、OWNERコメント・ledger変更 0、main統合 0、手動デプロイ 0。

**次の順序:** PRをDraftで検査 → CI/CodeQL SUCCESS → 別承認でexact HEADをmainに統合 → 別承認で最小read-only PATの安全なGitHub Staging環境への登録 → 別承認で手動read-only診断。いずれかの前提不成立ならNO-GO。
