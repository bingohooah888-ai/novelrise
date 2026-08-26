# Repository Guidelines

## 最上位方針：NOVELIGHT MASTER

このリポジトリで作業を始める際は、最初に `docs/NOVELIGHT-MASTER.md` を確認する。同ファイルをNOVELIGHTの正式なMASTERファイルかつ最優先のプロジェクト方針として扱う。実装・設計・提案は、MASTERの基本思想「すべての物語に、光を。」、3原則、意思決定原則と矛盾させない。

MASTERを確認する際は、必ずGitHub上の最新 `main` ブランチにある `docs/NOVELIGHT-MASTER.md` を直接取得し、それを唯一の正本として扱う。プロジェクト添付ファイル、File Library、過去チャット、ローカルコピー、過去に取得したMASTERは参考資料にとどめ、正本として使用しない。内容が食い違う場合は最新 `main` 上のMASTERを優先する。MASTER本文の「最終更新」表記だけで最新版と判断せず、必要に応じて当該ファイルの最新コミットも確認する。GitHubの最新版を確認できない場合は古いコピーで代用せず、「最新版未確認」と明示して作業を止める。ユーザーが単に「MASTERを読んで」「マスターを確認して」と依頼した場合も、この最新版確認を自動実行する。

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

## AI開発フロー

NOVELIGHTの標準AI開発フローは `docs/development-workflow.md` を基準とする。ChatGPTは戦略・設計・リスク判断、Codexは主な実装担当、自動テストとGitHub Actionsは客観的な検証担当とする。認証、Supabase RLS、Stripe、課金、権限、個人情報、破壊的migration等の高リスク変更は、実用上可能な場合にClaude Code等の別モデルによる独立レビューを追加する。

AIの「問題ない」という判断だけをmerge根拠にしない。CI、RLS統合テスト、Playwright、依存脆弱性監査、CodeQL等の機械検証が失敗している場合は、原因が解決するまで未完了として扱う。AIを増やすこと自体を目的にせず、速度・品質・安全性を実際に改善する最小構成を使う。

commitとpushは既存ルールどおりユーザーの明示指示を必要とする。`main`へのmergeは下記の条件付き自動merge方針に従う。本番DB、Stripe live、Secret、外部Production state、その他明示承認対象の本番操作は、PR mergeとは別の承認ポイントとして扱う。

## 条件付き自動merge方針

ユーザーが着手を承認した通常の低リスクPRは、追加の「マージして」確認を毎回求めず、以下をすべて満たした時点でsquash mergeしてよい。

- PRがdraftではなく、意図した変更範囲だけを含む
- 最新 `main` を基準にしており、mergeableで競合がない
- 必須aggregate status `check` がsuccessしている
- CodeQLが適用される変更ではCodeQLがsuccessしている
- 依存関係、DB/RLS、browser E2E等、その差分に必要と判定されたgateがすべてsuccessしている
- deploy-relevant変更では必要なVercel Preview確認が完了している
- Secretや資格情報が差分・ログ・PR本文へ混入していない
- unresolvedなREQUEST_CHANGES、重大なreview指摘、原因未解決の失敗がない
- 下記の明示承認必須カテゴリに該当しない

通常の低リスクPRの例は、軽微なUI/文言修正、非機密の小規模バグ修正、テスト改善、非安全系ドキュメント修正、挙動を変えない限定的refactor等とする。低リスクPRのmergeに伴ってVercelが通常のProduction deployを行うことは、この条件付き自動merge方針の範囲に含める。ただし外部本番データ・課金・Secret等を変更する追加操作まで自動承認したことにはしない。

次は必ずユーザーの個別明示承認を得てからmergeする。

- 認証、Supabase RLS、Stripe/課金、料金・entitlement、権限、個人情報、セキュリティ境界
- Secret、API key、環境変数の秘密値、Production credentialsを扱う変更
- Supabase migration、本番DB schema/data変更、データ削除・移行、破壊的変更
- Production workflow、deploy infrastructure、approval gate、rollback/recovery経路を変更するPR
- `docs/NOVELIGHT-MASTER.md` の方針変更
- `AGENTS.md`、`docs/WORK-EXECUTION-PREFLIGHT.md`、`docs/development-workflow.md` 等で安全ゲート・承認境界・auto-merge条件そのものを変更するPR
- CI/CodeQL/テストgateを弱める変更、または失敗gateを例外扱いしてmergeしようとする変更
- リスク分類が曖昧、影響範囲が不明、rollback不能、またはユーザー判断が必要な変更

判定に迷う場合は自動mergeしない。高リスクPRではCIが全成功していてもユーザー承認を省略しない。

## 自動化・効率化原則

MASTERの自動化効率基準に従い、「自動化されている」ことだけを完成条件にしない。変更範囲に応じた差分実行、独立処理の並列化、安定した共通処理の再利用、不要な二重実行の削除、失敗した箇所だけを再実行しやすい構造を優先する。

安全上意味のある重複は削らない。特に本番DBの承認前確認と承認後再確認、rollback検証、権限境界検証は効率化の名目で省略しない。一方、別Workflowが同じ変更で同じ準備・検査を無意味に繰り返す構造は整理する。新しいWorkflowを足す前に、既存Workflowの責務・path filter・共通スクリプトで解決できないか確認する。

## Project Structure & Module Organization

ユーザー向けページはルートのHTML（`index.html`、`novel.html`、`episode-post.html` など）で、CSSとブラウザJavaScriptも各ページ内にある。Vercel APIは `api/`、Node/RLS自動テストは `tests/`、Playwrightブラウザテストは `tests/e2e/`、正式な方針・設計資料は `docs/` に置く。Supabase関連は、適用SQLを `supabase/migrations/`、復旧SQLを `supabase/rollback/`、適用前後の検証SQLを `supabase/checks/` に配置する。共通のCI/運用ロジックは `scripts/` に置き、同じ処理を複数Workflowへコピペしない。

## Build, Test, and Development Commands

- Node.jsは24系を使用する。`.nvmrc` と `package.json` の `engines.node` を基準にする。
- `npm ci`: `package-lock.json` に固定された依存関係を再現可能な状態でインストールする。通常の開発・CIではこちらを優先する。
- `npm install`: 依存関係を追加・更新して `package-lock.json` を更新するときに使用する。
- `npm test`: Node.js標準テストランナーで `tests/` のJavaScript自動テストを実行する。
- `npm run lint`: `api/**/*.js`、`tests/**/*.js`、`tests/**/*.mjs` をESLintで検査する。
- `npm run format`: API、テスト、設定ファイル、JSON/YAMLをPrettierで整形する。これは明示的な修正操作として使う。
- `npm run format:check`: ファイルを書き換えず、Prettier整形が必要なファイルがないか検査する。
- `npm run syntax:check`: `api/` と `scripts/` のJavaScript/ESM対象を自動検出して構文検査する。
- `npm run preflight` / `npm run preflight:fast`: 通常のread-only preflight。format check、ESLint、Node tests、syntax check、`git diff --check` を実行する。
- `npm run preflight:fix`: 意図的にPrettier整形を適用してからfast checksを実行する。
- `npm run preflight:db`: core RLS integration/rollback runnerを実行する。ローカルPostgreSQL test DBが必要。
- `npm run preflight:e2e`: `tests/e2e/` のPlaywright smoke/async UIを実行する。互換Google Chromeが必要。
- `npm run preflight:full`: fast + DB + E2E。高リスク・横断変更に限定し、通常変更で機械的に毎回実行しない。
- `cd tests/e2e && npm ci`: Playwrightの固定依存関係をインストールする。
- `cd tests/e2e && npm test`: 主要公開ページ、非同期UI、明示的な390px mobile viewport検証を実行する。CIはGitHub Runner既存Chromeを利用し、毎回別Chromiumをダウンロードしない。
- `npm audit --audit-level=high`: 本体の既知high/critical脆弱性を監査する。
- `cd tests/e2e && npm audit --audit-level=high`: Playwright側の既知high/critical脆弱性を監査する。
- `npx serve .`: 静的ページをローカル配信する。
- `npx vercel dev`: 環境変数を設定した状態で静的ページと `/api/*` を実行する。
- `supabase migration list --linked`: link済み本番projectのlocal/remote migration historyを比較する。
- `supabase db push --linked --dry-run`: 本番へ適用されるpending migrationを変更なしで確認する。
- `git diff --check`: 不正な空白を検査する。

GitHub Actionsの必須status `check` は、最初に変更ファイルを分類し、必要なgateだけを集約する。preflight、core DB/RLS、browser E2E、dependency auditは独立jobとして可能な限り並列実行し、無関係なjobはskipする。skipはclassifierが不要と判定した場合のみ正常として扱い、classifier自体や必要jobのfailureは`check`を失敗させる。

CodeQLはコードを含むPR/main変更と定期scanで実行し、docs-only変更では重複実行しない。Playwrightのrequest-only・非同期UI検証をDesktop/Mobileの全projectで二重実行しない。mobile layoutはテスト内の明示viewportで担保する。Playwright failure時はtrace、screenshot、video、HTML report、console/page/request diagnosticsをartifactへ残す。

RLS統合テストは `scripts/run-rls-integration.sh` をSingle Sourceとして、fixtureへ対象migrationを実際に適用し、閲覧・write権限境界、plan limit、LIGHT SEED、露出系、precheck/postcheck/rollbackを検証する。beta-P0やcontact inquiryのような専用DB gateは、そのWorkflowが実際に参照するファイルだけをpath filterへ含める。専用gate対象の変更だけで無関係なcore DB suiteを起動しない。

依存関係を変更した場合は対応する `package.json` と `package-lock.json` を必ず同じ変更として扱う。`tests/e2e/` は独立したpackage/lockfileを持ち、ブラウザテスト依存を本体runtimeから分離する。現時点でbuildスクリプトはない。追加時は `package.json` と本書を同時に更新する。

Vercelは `main` をproduction branchとして扱い、通常のfeature/fix/security branchはPreview対象とする。デプロイ枠浪費を避けるため、`vercel.json` で `chore/**`、`test/**`、`docs/**`、`dependabot/**` の自動Vercel deploymentを無効化する。これらのbranchで実際にdeploy確認が必要な変更を行った場合は、deploy-enabled branchへ移すか意図的にmanual previewを作成する。

Stagingの現行自動検証は `docs/STAGING-RUNBOOK.md` を基準とし、独立Staging SupabaseとStripe test modeが未接続の間はread-onlyを維持する。独立環境が完成した場合のみ、認証・作品投稿・お気に入り・LIGHT SEED・分析・Stripe test Checkoutを含むwrite E2Eを `STAGING_E2E_READY` で有効化する。本番ホスト・本番Supabase・Stripe live modeをStagingへ混入させない。

本番Supabase migrationの通常運用は `.github/workflows/supabase-production-auto-deploy.yml` を使う。`main` に `supabase/migrations/**` が入ると、今回のpushで追加されたmigrationと本番pendingが完全一致することを確認し、dry-run後に `production-approval` GitHub Environmentで人間の承認を要求する。承認後にpending一致を再確認し、dry-runを再実行してから自動deployし、migration historyとproduction observabilityを検証する。承認前後の再確認は安全上必要な重複なので削除しない。

`.github/workflows/supabase-production.yml` は手動 `status` / `dry-run` / `repair-history` / `deploy` 専用のfallbackであり、通常のmigration pushでは起動しない。`repair-history` は本番適用済みをDB実状態で確認した既知versionに限り、正確な確認文字列 `REPAIR` で実行する。詳細は `docs/SUPABASE-PRODUCTION-DEPLOY.md` を参照する。

## Coding Style & Naming Conventions

HTML/CSS/JavaScriptは2スペースでインデントする。APIではES Modules、`const`、`async`/`await`、セミコロン、JavaScriptのシングルクォート、入力検証の早期returnを基本とする。ページ名はkebab-case、変数はcamelCase、SQL migration名はタイムスタンプ付きsnake_caseとし、既存SQLに合わせてキーワードは小文字にする。

## Testing & High-Risk Changes

変更ページはデスクトップ・モバイル、認証状態、所有者限定状態を手動確認する。安定した公開導線はPlaywright smoke testへ追加し、単純な表示崩れ・主要ページ404・基本フォーム欠落をPR段階で検出する。APIでは不正メソッド、認証不備、成功応答、安全なエラー内容を確認する。チェックアウトAPIの認証・プラン制限・Stripeへ渡すユーザー情報は自動テストで保護し、Stripe webhookは署名付きテストイベントで検証する。DB変更は対応するprecheck、migration、postcheck、非本番でのrollback確認を一組とする。

novels/episodesのSELECT RLSは、公開作品・下書き・親作品の公開状態・所有者境界をCIのPostgreSQL統合テストで確認する。INSERT/UPDATE/DELETE RLSは正式なmigrationとして管理し、認証ユーザー本人だけが自分の作品を作成・更新・削除できること、エピソードは本人所有の作品にだけ追加できること、`user_id` や `novel_id` を使った所有権のすり替えができないことを自動テストする。既存write policyを置き換えるmigrationでは適用前ポリシーをバックアップし、rollbackで復元可能にする。

認証、Supabase RLS、Stripe、課金、権限、個人情報、セキュリティ、データ削除・移行は高リスク変更として扱う。影響範囲、権限境界、失敗時の挙動を確認し、速度より安全性を優先する。破壊的変更の前にバックアップ、rollback、または再生成手段があり、実際に復旧可能かを確認する。高リスク変更ではCodeQL、該当する自動テスト、独立した別モデルレビューを組み合わせ、単一AIの判断に依存しない。

## Commit & Pull Request Guidelines

commitとpushは、ユーザーから明示的な指示があるまで行わない。指示されたcommitは `Fix checkout API authentication` のような短い命令形にし、変更単位を絞る。PRには目的、ユーザー影響、検証内容、関連issue、環境変数・migration・rollback要件を記載し、UI変更にはスクリーンショットを付ける。deploy-relevant変更ではVercel Previewも確認し、依存関係変更では脆弱性監査、高リスク変更ではCodeQLと必要に応じた独立AIレビューを確認する。秘密情報はcommitせず、Stripeキー、Supabase access token、Supabase database password、サーバー専用secret、価格IDはデプロイ環境またはGitHub Secretsで管理する。
