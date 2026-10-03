# NLO Asset Pipeline

NOVELIGHTの画像挿入・画像登録は、以後この経路を標準とする。

## 目的

画像を再圧縮・再エンコードせず、元バイト列をそのまま安全に作業ブランチへ配置し、SHA-256・ファイルサイズ・画像寸法を自動検証してからcommit/pushする。dirtyなmainは触らない。

## 標準フロー

1. `asset prepare` で最新 `origin/main` から専用worktree/feature branchを作る。
2. `asset verify` で元画像の SHA-256 / size / format / width / height を確認する。
3. 1枚なら `asset add`、複数なら `asset batch` でバイナリをそのままコピーする。
4. 必要なHTML/CSS変更だけを同じworktreeで行う。
5. 最低限の対象テストを実行する。
6. `asset finalize` で指定ファイルだけをstageし、scope一致と `git diff --cached --check` を確認してcommit/pushする。
7. PRを作成し、Production merge/deployはNOVELIGHT MASTERの「本番承認」ゲートに従う。

## 重要ルール

- PNG/JPEG/WebPの原本を再圧縮・再エンコードしない。
- GitHub Contents APIなどのUTF-8 text APIで画像バイナリを書き込まない。
- メール添付、Issue添付、一時GitHub Actionsを通常の画像搬送経路にしない。
- dirtyなmainに対して `reset --hard` / `clean` を行わない。必ずworktreeを使う。
- 画像が既に存在する場合は、上書きを明示指定しない限り停止する。
- 複数枚は全ソースを先に検証し、同一destinationや不正メタデータがあれば書き込み前に停止する。
- commit時は指定したファイルだけをstageし、余計な変更が混じったら停止する。

## フォールバック規則

NLOの通常Asset Pipelineが使えない場合、別ルートを勝手に掘り始めない。

1. NLO health / Commander状態を確認する。
2. 自動復旧を1回だけ実行する。
3. それでも利用不能なら、その時点で「NLO Asset Pipeline停止」と明示して止める。

ユーザーの明示承認なしに、メール転送・GitHub text API・一時Workflow等へ切り替えない。

## コマンド

NLOから既存の `run_command` で以下を実行できる。

```text
npm run asset -- prepare --repo . --worktree .novelight-commander/worktrees/assets-20261003 --branch codex/assets-20261003
npm run asset -- verify --file C:\path\image.png --sha256 <optional> --width 1600 --height 900
npm run asset -- add --source C:\path\image.png --destination .novelight-commander/worktrees/assets-20261003/assets/home/image.png
npm run asset -- batch --manifest C:\path\asset-manifest.json
npm run asset -- finalize --manifest C:\path\asset-manifest.json --push --message "Add approved image assets"
```

`prepare` は `origin/main` をfetchしてworktreeを作るだけで、元のworking treeを変更しない。

## Manifest例

```json
{
  "items": [
    {
      "source": "C:\\Users\\...\\hero.png",
      "destination": ".novelight-commander/worktrees/assets-20261003/assets/home/hero.png",
      "expected": {
        "sha256": "...",
        "size": 4445832,
        "width": 2560,
        "height": 1280,
        "format": "png"
      }
    }
  ],
  "commitFiles": [
    "assets/home/hero.png",
    "index.html"
  ],
  "message": "Add approved home artwork"
}
```

## Windows対応

NLOのプロセス実行はWindows上で `npm` / `npx` / `gh` / `supabase` / `vercel` を自動的に `.cmd` shimへ解決する。これにより、従来の `spawn npm ENOENT` を回避する。
