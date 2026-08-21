# Repository Guidelines

## 最上位方針：NOVELIGHT MASTER

このリポジトリで作業を始める際は、最初に `docs/NOVELIGHT-MASTER.md` を確認する。同ファイルをNOVELIGHTの正式なMASTERファイルかつ最優先のプロジェクト方針として扱う。実装・設計・提案は、MASTERの基本思想「すべての物語に、光を。」、3原則、意思決定原則と矛盾させない。

MASTERと依頼内容が矛盾する可能性がある場合は、独自解釈で進めず、具体的な矛盾点と影響をユーザーへ指摘して判断を求める。MASTERの根本思想や既存方針を独断で変更・削除してはならない。新しい重要方針が決定した場合は、MASTER更新候補として扱う。

## 「MASTER更新」運用

ユーザーが「MASTER更新：〜」と指示した場合は、次の手順を自動で実行する。

1. `docs/NOVELIGHT-MASTER.md` を全文確認する。
2. 指示内容が既存MASTERと矛盾しないか確認する。
3. 最も適切な既存章へ、必要最小限の追記または修正を行う。
4. 同じ内容を重複して追加しない。
5. 根本思想や既存方針を独断で削除・変更しない。
6. 文書冒頭の「最終更新」を作業当日の日付へ変更する。
7. `git diff -- docs/NOVELIGHT-MASTER.md` を実行し、変更差分を確認する。
8. 変更した章と内容をユーザーへ簡潔に報告する。
9. commitとpushは、ユーザーから明示的に指示されるまで行わない。
10. MASTERへ入れるべきか判断が難しい内容は追加せず、判断が必要な点を示してユーザーへ確認する。

新しい重要方針が決定した場合はMASTER更新候補として扱う。通常のMASTER更新でも上記と同じく、既存内容を不用意に消さず、適切な章への必要最小限の変更、最終更新日の更新、差分確認、変更報告を必須とする。

## β版の開発優先順位

β公開までは完成度を落とさず、寄り道を避ける。MASTERのロードマップ分類に従い、A（バグ、セキュリティ、重大UX、根幹機能）を最優先、Bを次点、Cは記録して後回しにする。「面白そう」だけで機能を追加せず、β版基本方針と検証目的に必要かを判断する。

## Project Structure & Module Organization

ユーザー向けページはルートのHTML（`index.html`、`novel.html`、`episode-post.html` など）で、CSSとブラウザJavaScriptも各ページ内にある。Vercel APIは `api/`、正式な方針・設計資料は `docs/` に置く。Supabase関連は、適用SQLを `supabase/migrations/`、復旧SQLを `supabase/rollback/`、適用前後の検証SQLを `supabase/checks/` に配置する。

## Build, Test, and Development Commands

- `npm install`: SupabaseとStripeの依存関係をインストールする。
- `npx serve .`: 静的ページをローカル配信する。
- `npx vercel dev`: 環境変数を設定した状態で静的ページと `/api/*` を実行する。
- `git diff --check`: 不正な空白を検査する。

現時点で自動テスト・lint・buildスクリプトはない。追加時は `npm test` や `npm run lint` として `package.json` に定義し、本書も更新する。

## Coding Style & Naming Conventions

HTML/CSS/JavaScriptは2スペースでインデントする。APIではES Modules、`const`、`async`/`await`、セミコロン、JavaScriptのシングルクォート、入力検証の早期returnを基本とする。ページ名はkebab-case、変数はcamelCase、SQL migration名はタイムスタンプ付きsnake_caseとし、既存SQLに合わせてキーワードは小文字にする。

## Testing & High-Risk Changes

変更ページはデスクトップ・モバイル、認証状態、所有者限定状態を手動確認する。APIでは不正メソッド、認証不備、成功応答、安全なエラー内容を確認し、Stripe webhookは署名付きテストイベントで検証する。DB変更は対応するprecheck、migration、postcheck、非本番でのrollback確認を一組とする。

認証、Supabase RLS、Stripe、課金、権限、個人情報、セキュリティ、データ削除・移行は高リスク変更として扱う。影響範囲、権限境界、失敗時の挙動を確認し、速度より安全性を優先する。破壊的変更の前にバックアップ、rollback、または再生成手段があり、実際に復旧可能かを確認する。

## Commit & Pull Request Guidelines

commitとpushは、ユーザーから明示的な指示があるまで行わない。指示されたcommitは `Fix checkout API authentication` のような短い命令形にし、変更単位を絞る。PRには目的、ユーザー影響、検証内容、関連issue、環境変数・migration・rollback要件を記載し、UI変更にはスクリーンショットを付ける。秘密情報はcommitせず、Stripeキー、Supabase URL・サーバー専用secret、価格IDはデプロイ環境で管理する。
