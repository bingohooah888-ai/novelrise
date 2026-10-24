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

`header:sync`／`header:check`／`header:watch` に連動します。創作室のJS生成サイドバーの構造・認証・操作は変えず、内部のフォールバック用 `<img>` の参照先だけをホーム原本に同期します。

**承認済みの創作室デザインは表示上の例外です。** 創作室トップ、作者専用ページ5ページ、SCOUT RECORDでは、左サイドバーの金色ロゴ `assets/author-room/novelight-author-room-logo.webp` と黒紺背景、上部の黒い `workspace-top` ヘッダーを維持します。表示用金色ロゴは既存の `novelight-author-room.css`／`novelight-author-studio-shell.css` の `.studio-brand::before` で管理します。`brand-variants.css` で `.studio-brand img` を強制表示したり `.studio-brand::before` を消したりしてはいけません。ホーム原本の更新はフォールバック画像へ同期されますが、**表示中の金色ロゴを自動的に置き換えません**。交流設定の独立ヘッダーと管理画面はそれぞれの専用表示を維持します。

## 新規公開ページの品質ゲート（2026-10-24）

通常公開ページは `shared/header/manifest.json` の `managed` に登録し、
`/shared/page/public-ivory.css` と `novelight-header-light.css` を読み込み、`body` に
`novelight-theme novelight-public-header-page novelight-public-ivory` を設定します。
標準は **アイボリー背景・読みやすい大きさ・濃色文字** です。
ページ固有のCSSはこの基準に重ね、ヘッダーは独自に再作成しないでください。
共通ヘッダーの4項目（作品を探す・ランキング・交流・お知らせ）は原本から同期します。料金プランはヘッダーに表示せず、料金ページ自体は維持します。

`npm run header:check` は新しく追加されたルートHTMLが未登録、
共通ヘッダー未適用、アイボリーCSSや共通クライアントの欠落ならCIで失敗します。
既存独立画面は `shared/page/preexisting-root-html.json` で固定し、
新しい例外デザインが必要な場合は `publicPageThemeExceptions` にページ名と理由を明記します。
これは作者創作室／管理画面などの意図的に異なる既存デザインを壊さないための境界です。

### 共通ヘッダーの見た目検証（2026-10-24）

共通HTML原本の同期だけではヘッダーの高さ・文字・ログイン後の「創作室」ボタンは統一できません。
通常の明色公開ページは `novelight-header-light.css` と `/shared/header/public-header.css` の双方を読み込むこと。
`novelight-public-dark` のホーム・料金等は既存の暗色ヘッダー基準を維持します。
新しい通常公開ページでは `scripts/check-public-page-standards.mjs` が前者の欠落を検出します。
見た目の退行検出には `tests/e2e/specs/community-plaza-ui.js` の computed-style 検証を使います。
CSS の `:is()` で ID セレクターとクラスセレクターを混在させると特異性が上がり、後続の色指定を上書きできないため、カードと通知・掲示板の色は分離してください。
