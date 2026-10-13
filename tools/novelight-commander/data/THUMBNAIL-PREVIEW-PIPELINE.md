# NOVELIGHT公式サムネイル素材：選択一覧専用WebP

## 目的

投稿／編集画面の素材選択一覧で大容量PNG原画像を直接ダウンロードしないよう、**選択画面に限り**軽量派生WebPを使う。公式PNG原版、サムネイル合成、正式Geometry、保存・登録先DBは変更しない。

## 対象

2026-10-13時点のProduction読み取り専用スナップショット113件：
背景21、基準本32、模様10、シンボル36、枠14。入力は
`tools/novelight-commander/data/thumbnail-preview-sources-20261013.json`。

入力URLはNOVELIGHTの公開Supabase Storage `novel-thumbnails/official/<UUID>.png` のみに制限。サイズ・PNGマジック・ID重複・出力先を検証し、どれか1件でも失敗すれば完了フォルダを公開しない。

## 作成工程（NLOの孤立したfeature worktree内）

1. 現行mainと作業中のPR #2157ブランチを確認する。dirtyなmainを変更しない。
2. 専用worktreeをPR #2157のfeature branchから作る。対象worktreeで原画像や既存の出力ディレクトリを上書きしない。
3. Node 24＋既存の `sharp` がインストールされたNLO開発環境から、次を実行する。 `<worktree>` は実際に作成したworktreeの絶対パス。

   ```powershell
   node scripts/generate-official-thumbnail-previews.mjs --manifest tools/novelight-commander/data/thumbnail-preview-sources-20261013.json --output "<worktree>/assets/thumbnail-previews/v1"
   ```

4. 113件すべてのWebP、同一ディレクトリの `manifest.json` を確認し、previewファイルだけをfeature branchへcommit/pushする。
5. GitHub PR #2157でCI／画像数・画像寸法・全preview URLの照合を行う。Productionへの反映は新たな本番承認による。

`sharp` はrootの既存依存（新しい有料画像変換サービスを導入しない）。公式PNGの総量は約121MiBで、一回の派生生成時に公開Storageから読み取る。ダウンロードした元PNGは上書き・保存しない。3並列で処理する。

## 表示安全性

アプリ側は `/assets/thumbnail-previews/v1/manifest.json` を読み込み、各IDの `sourceUrl` がProductionの `novel_thumbnail_assets.image_url` と完全一致したものだけ `previewUrl` を選択一覧に使用する。

- 不正・欠損したmanifest → 原画像のまま
- DBで更新された原画像 → 原画像のまま
- 個別WebPのダウンロードや表示に失敗 → その画像のみ原画像にフォールバック
- Canvas合成と最終保存 → 常に原画像URLを使用
- 新規追加した公式素材 → 次の派生バッチまで原画像のまま

`assets/thumbnail-previews/v1` を実際に配置するまでは表示速度の改善は発生しない。公開先へWebP一式を掲載しないまま切替だけを本番反映しない。

## NLO capability

`.novelight/nlo-capabilities.json` に `nlo.thumbnail-preview-batch` を testing 状態で登録。現在のGitHub Issue #1837のallowlistには任意の `run_command` やWebP一括生成専用actionがないため、**Issueへの任意shell文字列の投稿は禁止**。本機能の実行は直接NLO MCPからの `run_command` が見える環境、またはPCのNLO用PowerShellから行う。後日Bridge経由の固定actionが必要なら、別の安全性審査・承認を経て追加する。
