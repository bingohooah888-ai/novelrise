# NOVELIGHT Commander v0.5

NOVELIGHT開発専用のローカルMCPオペレーション層です。Desktop Commanderで便利だったローカル操作をNOVELIGHT向けにまとめ、日常開発を1つの接続から進めます。

## 主な機能

- 許可root内のファイル一覧・検索・読取・書込・情報取得・ハッシュ
- コピー・移動・ディレクトリ作成。削除は既定OFF
- PNG寸法と実アルファ透過検査
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

list_files / search_files / read_text / read_text_range / tail_text / write_text / file_info / hash_file / inspect_png / copy_file / move_file / create_directory / delete_path

begin_binary_write / append_binary_chunk / finish_binary_write / cancel_binary_write / list_binary_writes / read_binary_chunk

validate_thumbnail_asset / scan_thumbnail_directory / build_thumbnail_pack / composite_png_layers

zip_list / zip_extract / zip_create / validate_thumbnail_pack / register_official_thumbnail_pack

run_command / start_process / read_process_output / list_processes / stop_process

git_status / git_diff / git_fetch / git_latest_main / git_pull_ff / git_create_branch / git_commit / git_push / git_worktree_list / git_worktree_add

gh_pr_checks / gh_run_list / supabase_migration_list / vercel_list

read_novel / read_novel_cached / get_novel_cache / list_novel_cache / read_audit

## 小説キャッシュ

`read_novel_cached(url)` は前回取得済みepisode URLを再利用し、作品ページで新しく見つかったepisodeだけを取得します。完全再取得したい場合だけ `refreshExisting=true` を指定します。

## バイナリ転送

`begin_binary_write` → `append_binary_chunk` を複数回 → `finish_binary_write` の順で使います。数十MB級のZIPや画像を1回のMCP引数に載せず転送できます。

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

`tunnel-client` の取得方法やTunnel作成手順は、固定バイナリURLではなくOpenAI公式の最新Secure MCP Tunnelドキュメントを参照してください。

アルファポリスは公開中の無料小説を対象に、作品URLまたは各話URLから作品トップを特定し、`.episode a` の話一覧と `#novelBody` の本文を取得します。有料/レンタル、ログイン必須、年齢確認等で通常公開されていない本文は取得対象外です。

## NOVELIGHT引継ぎ・ゲート読込

`novelight_context_bundle` でMASTERと主要ゲート文書を一括読込できます。`novelight_handoff_report` ではbranch / HEAD / origin/main / working tree / recent commits / 任意PR状態を1回で取得し、新しいチャットへの引継ぎ材料を作れます。
