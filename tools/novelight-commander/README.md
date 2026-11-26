# NOVELIGHT Commander v0.5

NOVELIGHT開発専用のローカルMCPオペレーション層です。Desktop Commanderで便利だったローカル操作をNOVELIGHT向けにまとめ、日常開発を1つの接続から進めます。

## 主な機能

- 許可root内のファイル一覧・検索・読取・書込・情報取得・ハッシュ
- コピー・移動・ディレクトリ作成。削除は既定OFF
- PNG寸法と実アルファ透過検査
- PNG/JPEG/WebPの画像専用Asset Pipeline。原本byte維持、SHA-256/size/dimensions検証、worktree、scope固定commit/push
- background/base_book/pattern/symbol/frame別の素材ルール検証
- サムネ素材フォルダ一括検査、完全重複SHA検出、合成プレビュー
- 公式manifest/VALIDATION付きZIP自動生成
- 2 MiB単位の分割バイナリ転送。サイズ/SHA-256検証付き
- ZIP一覧・安全展開・作成・公式サムネイルmanifest検証
- Production gate付き公式素材packのStorage/DB直接登録
- 長時間process開始・出力読取・停止・一覧
- Git status/diff/fetch/pull/branch/commit/push
- origin/mainとの差分確認、isolated worktree作成
- NOVELIGHT preflight fast/db/e2e/full/fix
- GitHub PR checks / Actions runs
- Supabase migration list / Vercel deployment list
- JSONL監査ログ
- 小説家になろう・カクヨム・アルファポリスのURL一発全話読取
- 小説キャッシュと新規話だけの差分取得

## Safety modes

既定では次をすべてOFFにします。

- NOVELIGHT_COMMANDER_ALLOW_SHELL=false
- NOVELIGHT_COMMANDER_ALLOW_DESTRUCTIVE=false
- NOVELIGHT_COMMANDER_ALLOW_PRODUCTION=false

main/master push、PR merge、Supabase本番mutation、Vercel production deploy等はProduction modeなしでは拒否します。force push、reset --hard、git clean等はDestructive modeなしでは拒否します。

一般shellやnode/npxの万能実行口も通常モードでは開けません。Production modeは安全承認を省略するスイッチではなく、NOVELIGHT本番承認後に実行経路を解放する追加ローカルゲートです。

## Windowsセットアップ

    cd tools\novelight-commander
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

生成された .env の NOVELIGHT_COMMANDER_ROOT を実際の novelrise フォルダへ変更し、`npm start` で起動します。

## 主要MCP tools

commander_info / novelight_doctor / novelight_repo_snapshot / novelight_preflight / novelight_context_bundle / novelight_handoff_report

GitHub Bridge経由では `nlo_health` をNLO可用性の標準確認actionとする。成功応答が返る場合、Bridge経路のNLOは利用可能である。Remote Desktop Commanderのdevice状態はこの判定に使用しない。

list_files / search_files / read_text / read_text_range / tail_text / write_text / file_info / hash_file / inspect_png / copy_file / move_file / create_directory / delete_path

begin_binary_write / append_binary_chunk / finish_binary_write / cancel_binary_write / list_binary_writes / read_binary_chunk

validate_thumbnail_asset / scan_thumbnail_directory / build_thumbnail_pack / composite_png_layers

zip_list / zip_extract / zip_create / validate_thumbnail_pack / register_official_thumbnail_pack

run_command / start_process / read_process_output / list_processes / stop_process

git_status / git_diff / git_fetch / git_latest_main / git_pull_ff / git_create_branch / git_commit / git_push / git_worktree_list / git_worktree_add

gh_pr_checks / gh_run_list / supabase_migration_list / vercel_list

read_novel / read_novel_cached / get_novel_cache / list_novel_cache / read_audit

## Supabase Staging Branchデプロイ履歴・失敗ログ診断（未接続／既定OFF）

既存のNLO MCPとOwner専用GitHub Issue Bridgeに、次の読み取り専用ツールを用意する。

- `supabase_staging_actions`：公式Management API `GET /v1/projects/wmlzjgvxgoyrovdhbqbg/actions` を使い、対象Stagingのaction run日時・ステップ・結果だけを取得
- `supabase_staging_action_logs`（`runId`指定）：同じStaging Branchの実行一覧から該当runを確認した後、公式API `GET /v1/projects/wmlzjgvxgoyrovdhbqbg/actions/{run_id}/logs` の失敗を分類

検証対象は固定のStaging Branch ref `wmlzjgvxgoyrovdhbqbg`、Branch UUID `4ea5dd93-4032-4d53-8b4f-46bef5cb50d2`。Production `fiepaguycecrredwrcwx` のAPI/DBへ接続しない。取得ログは全文・SQL・ユーザー情報・メール・トークン・秘密・不明フィールドを返さず、定義済みカテゴリ、非秘密の14桁Migration版番号、SQLSTATE、行数に限定する。ログ本文はメモリ内で捨て、ファイルやGitHub Issueに保存しない。未知の実行や別Branchのrunは拒否し、HTTP 401/403/429、API形状違いは再試行せず停止する。

実API利用は別承認まで禁止。NLOを最新版へ更新する前に今回のDraft PRを審査・本番統合する必要がある。オフラインではモック応答でのみテストする。

```text
# NLO稼働マシンの既存ローカル資格のみ（Git / Issue / Chatには秘密値を渡さない）
NLO_SUPABASE_STAGING_READONLY_ENABLED=false
NLO_SUPABASE_STAGING_PROJECT_REF=wmlzjgvxgoyrovdhbqbg
# SUPABASE_ACCESS_TOKEN は既存のManagement API用ローカル環境に既にある場合のみ再利用
```

実読取を行う前に、`NLO_SUPABASE_STAGING_READONLY_ENABLED=true` への変更と対象runを個別に承認する。Management APIの権限は `action_runs_read`（OAuthの場合 `environment:read`）。既存ローカルManagement APIトークンをNLOから参照できなければ認証不足のためNO-GO。既存の `NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY`、Supabase publishable/anon key、GitHub PAT、`CONTROL_PLANE_API_KEY`は代用禁止。追加トークンの作成やSecret変更は今回の作業に含めない。

`actions`のAPIがBranch refを受け付けない、対象Branch UUIDを検証できない、デプロイログ権限を返さない場合は**別refへの自動切替を行わない**。特に親Production refへのfallbackは禁止。NLOの機能実装・合成テストと実Staging診断成功を混同しない。

公式仕様：
- https://supabase.com/docs/reference/api/v1-list-action-runs
- https://supabase.com/docs/reference/api/v1-get-action-run-logs

## Cloudflare独立WatchdogのNLO連携（Gate A、読み取り専用）

`cloudflare_account` / `cloudflare_workers` / `cloudflare_durable_objects` / `cloudflare_worker_deployments` / `cloudflare_worker_observability` / `cloudflare_worker_metrics` / `cloudflare_do_object_count` / `cloudflare_watchdog_status` / `cloudflare_plan_change` がNLO直接MCPとIssue Bridgeで使用できます。

現時点で**対象アカウントの情報取得、novelight-ai-gatea-*対象Worker/DOのメタデータ、GraphQLのエラー件数・リクエスト集計**のみ。Workerの作成・更新・削除・停止、Durable Objectへの書込み、料金操作、Secrets、サーバーへの実接続は**一切実行しません**。`cloudflare_plan_change`は別途OWNER承認のための計画を返すだけです。生ログ、原稿、セッション、鍵、Cloudflare APIの生レスポンスはチャット/Issueに返しません。

CloudflareのWorkers製品に限定した**Metadata Read-Only**など最小権限のAPIトークンを作り、NLO稼働マシンのGit非管理環境設定にだけ配置します（チャットへの貼り付け禁止）。

```text
NLO_CLOUDFLARE_ACCOUNT_ID=6831b18fe814232fa2dd4c470b95aa15
NLO_CLOUDFLARE_READONLY_ENABLED=true
NLO_CLOUDFLARE_READ_TOKEN=[LOCAL_READONLY_TOKEN_ONLY]
```

初期値は必ず `false`。トークン未設定・アカウント不一致・アクセス拒否では失敗で停止します。Workers Freeのプラン名はアカウント詳細APIでは確定できないため、現在のBilling画面の独立確認と区別します。メトリクスのGraphQL `POST` は静的read-only queryのみで、サンプリング/遅延のため**実停止保証にはなりません**。

**注意：ローカルNLOを最新版へ更新・再起動するまで新MCPツールは反映されません。** 既存プラグインとの再接続・Tool listの再読込が必要な場合があります。Gate Aの実外部Watchdog稼働は別工程です。詳細: `docs/ai-phase2/gatea-nlo-cloudflare-bridge.md`。

## 小説キャッシュ

`read_novel_cached(url)` は前回取得済みepisode URLを再利用し、作品ページで新しく見つかったepisodeだけを取得します。完全再取得したい場合だけ `refreshExisting=true` を指定します。

## バイナリ転送

`begin_binary_write` → `append_binary_chunk` を複数回 → `finish_binary_write` の順で使います。数十MB級のZIPや画像を1回のMCP引数に載せず転送できます。

## 画像専用Asset Pipeline

今後の通常の画像挿入・画像登録では、汎用バイナリ転送やGitHub text APIではなく `npm run asset -- ...` を優先します。

- `prepare`: 最新 `origin/main` から専用worktree/feature branchを作る。dirtyな元mainは変更しない
- `verify`: SHA-256 / size / format / width / heightを確認
- `add`: 1画像を再圧縮・再エンコードせずexact byteでコピー
- `batch`: 複数画像を全件preflight後にまとめて配置
- `finalize`: 宣言したファイルだけをstageし、scope一致とdiff check後にcommit/push

Windowsでは `npm` / `npx` / `gh` / `supabase` / `vercel` を自動で `.cmd` shimへ解決し、`spawn npm ENOENT` を回避します。

通常Asset Pipelineが利用できない場合は、NLOの状態確認と自動復旧を1回行い、それでも失敗する場合は停止します。ユーザーの明示承認なしにメール転送、Issue添付、GitHub Contents API、一時Workflowへ迂回しません。

詳細は `docs/NLO-ASSET-PIPELINE.md` を参照してください。

## 位置付け

NOVELIGHT本体から独立した内部開発ツールです。本番アプリのランタイム依存にはしません。

公開小説取得では認証突破、CAPTCHA回避、アクセス制限回避を行いません。

## 公式素材pack登録

`register_official_thumbnail_pack` は `ALLOW_PRODUCTION=true`、ローカルSupabase service-role設定、固定confirmationがすべて揃った場合だけ動作します。pack全体を先に検証し、既存素材は削除・上書きせず、同一SHAはskip、同一labelで別sourceの場合はfail closedします。service-role keyはチャットへ返しません。

## OpenAI Secure MCP Tunnel

ローカルCommanderをインターネットへ直接公開せず、対応するOpenAI製品から利用する場合はOpenAI Secure MCP Tunnelを使えます。

ローカル環境だけに次を設定します。

- NOVELIGHT_COMMANDER_TUNNEL_ID
- CONTROL_PLANE_API_KEY

API keyをチャットやGitへ貼らないでください。

初回:

    .\configure-openai-tunnel.ps1

設定後、Windowsログオン時の自動起動と異常終了時の自動復旧を有効にする:

    .\install-openai-tunnel-autostart.ps1

手動起動する場合:

    .\run-openai-tunnel.ps1

`run-openai-tunnel.ps1` はTunnel切断時に自動再接続し、短時間の連続失敗時は最大60秒まで待機時間を段階的に増やします。1分以上安定稼働した後の切断では待機時間を初期値へ戻します。

さらに `install-nlo-autorecovery.ps1` は、1分ごとの独立Watchdog Scheduled Task `NOVELIGHT Commander Watchdog` を登録します。WatchdogはOpenAI Tunnel supervisorとGitHub Bridge supervisorを監視し、どちらかの親プロセスごと停止しても自動再起動します。BridgeのStartupランチャーも維持し、ログオン起動と定期自己修復を二重化します。

`configure-openai-tunnel.ps1` は、Tunnel設定確認後に `CONTROL_PLANE_API_KEY` をWindows DPAPIで暗号化し、`%LOCALAPPDATA%\NOVELIGHT\Commander\control-plane-key.dpapi` へ保存します。平文API keyをGitやチャット、Scheduled Taskの引数へ保存しません。

自動起動Taskは現在のWindowsユーザー権限で動作し、管理者権限へ昇格しません。PC再起動・ログオン後、Terminalを開かなくてもTunnelを起動します。

Tunnelログは `%LOCALAPPDATA%\NOVELIGHT\Commander\openai-tunnel.log` へ記録します。NLOがofflineになった場合は、まずこのログとScheduled Task `NOVELIGHT Commander Tunnel` の状態を確認します。

NLOはOpenAI Secure MCP TunnelとGitHub Bridgeの複数経路を持ちます。直接MCPがクライアント上で見えない場合でも、GitHub Bridgeが `nlo_health` または固定actionへ成功応答するならNLO全体をofflineとは扱いません。Remote Desktop Commanderは別製品・別接続であり、そのonline/offline表示をNLO状態へ読み替えないでください。

`tunnel-client` の取得方法やTunnel作成手順は、固定バイナリURLではなくOpenAI公式の最新Secure MCP Tunnelドキュメントを参照してください。

アルファポリスは公開中の無料小説を対象に、作品URLまたは各話URLから作品トップを特定し、`.episode a` の話一覧と `#novelBody` の本文を取得します。有料/レンタル、ログイン必須、年齢確認等で通常公開されていない本文は取得対象外です。

## NOVELIGHT引継ぎ・ゲート読込

`novelight_context_bundle` でMASTERと主要ゲート文書を一括読込できます。`novelight_handoff_report` ではbranch / HEAD / origin/main / working tree / recent commits / 任意PR状態を1回で取得し、新しいチャットへの引継ぎ材料を作れます。
