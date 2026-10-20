# NOVELIGHT 共通ヘッダー管理

## 方針

通常の公開ページのヘッダーは `shared/header/public-header.html` **だけを原本**とします。
各ページに配置される静的HTMLは、画面が描画される前に生成します。
ブラウザ起動後のJavaScriptでヘッダーを入れ替えないため、初期表示の横ずれ・縦ずれを回避します。

`shared/header/manifest.json` の `managed` が対象ページです。`overrides` で次を指定できます。

- `active`: ページ内ナビゲーションの `aria-current`
- `logoLabel`: 特定ページのロゴのアクセシビリティラベル
- `mobileAuthClasses`: モバイル認証リンクへの既存クラス設定
- `mobileSignup`: モバイルナビの会員登録入口

`custom` にあるページは**固有のヘッダー・認証・SEO契約**があり、原本からの自動更新対象外です。
キャンペーン専用に変更したいページは、対象を `managed` から外し `custom` に理由を記入してください。
原則として、色や余白など軽微な差はページ固有CSSをページ末尾で読み込んで調整し、共通ヘッダー自体は変更しないでください。
管理画面と作者の創作室は異なる役割のヘッダーを使用するため、既存構造を維持します。

## 変更方法

1. 全ページの共通部分は原本 `shared/header/public-header.html` だけ修正。
2. `npm run header:sync` で対象ページの初期HTMLを自動更新。
3. `npm run header:check` で同期漏れを検出。
4. PRのCIで差分とPC・スマホの初期表示を確認。
5. 開発時は `npm run header:watch` を起動すれば原本変更時に自動同期します。生成されたHTMLもコードにコミットします。
6. CIは `npm run header:check` で同期漏れを検出します。Vercelの既存のビルド設定は変更しません。

ページごとのJS/課金/権限/SEOの動作は本マネージャーの管理対象外です。
新しい通常ページは `managed` に加え、初期HTMLに `site-header` と `public-header-inner` を配置してください。

## 例外登録

```json
{
  "custom": {
    "example-campaign.html": "特別なキャンペーンCTAを使う"
  }
}
```

固有ページは通常ヘッダーの色・ロゴ・寸法をできる限り共通CSSから継承し、
変更が必要な属性だけページ専用CSSで上書きしてください。

## SEO連携

作品詳細、エピソード、作者プロフィールも共通原本から更新します。
`novel.html` と `api/seo/templates/novel.html`、`episode.html` と `api/seo/templates/episode.html` は同時に生成し、内容一致のテストを行います。作品本文やmeta情報は同期処理で変更しません。

## 共通CSS

ヘッダーの共通デザイントークンは `shared/header/public-header.css` に配置しました。現在のホームの承認済み配置CSSは維持します。全対象ページの `</head>` 直前に共通CSSの読み込みタグを保存します。本文CSSへ影響するセレクターは禁止します。

ホーム画面を基準に、PC・タブレット・スマホの共通見た目を維持してください。例外ページは共通CSSを必要な場合に読み込み、その後にページ固有CSSを指定します。

## 自動追随の境界

開発中の自動反映は `npm run header:watch` で行います（原本・manifest変更時に全対象ページの静的HTMLを再生成）。
本番配信時にJavaScriptでヘッダーを挿入しないため、描画後の位置ずれを防ぎます。
**テンプレートのGitHubへのコミットだけで本番サイトが無条件に更新されるわけではありません。**
CIは同期待ちの差分を検出してPRを止め、未承認の自動デプロイや課金を発生させません。

## 作者・読者の戻るボタン付きヘッダー

創作室の編集ページ／本棚などのヘッダーは `shared/header/workspace-header.html` の1つのテンプレートから生成します。
**ロゴそのものはホームの `shared/header/public-header.html` から取得**して使うため、ホームのロゴを変更して `npm run header:sync` を実行すると、通常公開ページだけでなく作者・読者の戻るボタン付き画面にも反映されます。

管理対象は `manifest.json` の `workspaceManaged` （20ファイル）。
各ページ固有の「← 創作室」「← 作品へ戻る」「本棚へ」などの戻る先・文字・`id="back"` は、それぞれのページにあるアンカーをそのまま維持します。**投稿画面やエピソード編集画面の機能を変更しません。**
原本やworkspaceテンプレートを変更すると開発中の `header:watch` が追随し、`header:check` が同期漏れを検出します。

専用レイアウト：創作室トップ・作者アカウント画面、SCOUT RECORD、読書記録の独自ナビ、管理画面、事前登録・法務・キャンペーン等は例外です。単一HTMLへ無理に置き換えず、別途個別の要件を保ちます。

## 専用画面のブランド同期（原本はHome）

`brandManaged` は公開27＋workspace20の外にある専用画面の **ブランド画像のみ** を同期します。読書記録・ヘルプ・創作室トップの画像、および管理画面14ファイルの文字ロゴが対象です。個別ナビ・管理者機能・ログアウト・法務・キャンペーンCTAは移行しません。管理画面専用の淡色ロゴプレートは `brand-variants.css` だけで変更します。

`header:sync`／`header:check`／`header:watch` に連動します。JavaScriptで生成する創作室サイドバーは今回の変更に含めません。
