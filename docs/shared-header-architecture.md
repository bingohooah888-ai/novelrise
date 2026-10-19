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
5. Vercel本番ビルドでもヘッダー同期処理が自動実行されます。

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
