# NOVELIGHT Operator (NLO) v0.6

NOVELIGHT開発専用のローカルMCPオペレーション層です。旧称 NOVELIGHT Commander。Desktop Commander（DC）と区別するため、以後は NOVELIGHT Operator（NLO）を正式な呼称とします。

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
- 小説家になろう・カクヨム・アルファポリス・Caitaの公開小説URL読取
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

公開小説取得では認証突破、CAPTCHA回避、アクセス制限回避を行いません。Caitaは通常HTTP取得が403等で拒否された場合に限り、ローカルのChrome/Edgeを匿名の一時プロファイルで起動して公開ページをレンダリングします。ログイン済みブラウザプロファイルは使用しません。

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

以後:

    .\run-openai-tunnel.ps1

`tunnel-client` の取得方法やTunnel作成手順は、固定バイナリURLではなくOpenAI公式の最新Secure MCP Tunnelドキュメントを参照してください。

アルファポリスは公開中の無料小説を対象に、作品URLまたは各話URLから作品トップを特定し、`.episode a` の話一覧と `#novelBody` の本文を取得します。有料/レンタル、ログイン必須、年齢確認等で通常公開されていない本文は取得対象外です。

## NOVELIGHT引継ぎ・ゲート読込

`novelight_context_bundle` でMASTERと主要ゲート文書を一括読込できます。`novelight_handoff_report` ではbranch / HEAD / origin/main / working tree / recent commits / 任意PR状態を1回で取得し、新しいチャットへの引継ぎ材料を作れます。


## Caita公開小説読取

Caita（`caita.ai`）は `/viewer/episode/<ID>` と `/series/<ID>` に対応します。通常HTTP取得で本文が得られない場合は、WindowsのChrome/Edgeを自動検出して公開ページをヘッドレス描画し、本文を抽出します。ブラウザの自動検出ができない環境では `NOVELIGHT_COMMANDER_BROWSER_PATH` にChrome/Edge実行ファイルの絶対パスを設定できます。シリーズ一覧を公開ページから確認できない場合、エピソードURLの本文自体は返しますが `complete=false` / `truncated=true` として全話取得済みとは扱いません。
