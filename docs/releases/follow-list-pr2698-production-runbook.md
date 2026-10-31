# PR #2698 — フォロワー／フォロー中 Production公開手順

## 適用範囲と現在の証拠

- 対象PR: [#2698](https://github.com/bingohooah888-ai/novelrise/pull/2698)。一般公開に必要なのは新しいフォロー一覧ページ、既存の本棚／交流導線、新しいowner-bound RPC 3件のみ。
- 移行: `20261031173000_followed_authors_list.sql`。既存データを変更・削除せず、`novelight_followed_authors(integer,integer)`、`novelight_followers(integer,integer)`、`novelight_follow_counts()` を新規作成する。
- Staging実証: [GitHub Actions #41216556432](https://github.com/bingohooah888-ai/novelrise/actions/runs/41216556432) でmigration／権限検証成功。[#41220505001](https://github.com/bingohooah888-ai/novelrise/actions/runs/41220505001) で実JWT・Preview画面／通知操作／フォロー解除と合成ユーザー削除を検証、全ジョブ成功。
- 2026-11-01の読み取り専用スナップショット：Productionのmigration **210件**（新migration未適用）、Staging **211件**（対象migration適用済み）。Productionの必要列の欠落0、対象3テーブルのRLS有効、既存フォロー／通知RPCあり、匿名の生の関係テーブルSELECT権限なし。
- これらは観測時点の証拠。Production変更前には最新main／PR SHA、migration pending set、権限とProduction状態を**再取得**し、古い値を使い回さない。

## 順序：2つのProduction承認を絶対に混同しない

### 第1段階 — 機能PRのmain統合（別途「本番承認」）

1. PR #2698が最新 `main` からbehind=0で、RLS／Node／静的品質／PC・スマホE2E／CodeQLが成功していることを確認する。
2. **PR #2698のmain統合のみ**を対象に、OWNERが別途「本番承認」する。高リスク承認証跡は最新head SHAに結び付けて既存CIで発行し、承認前にドラフト解除・マージしない。
3. マージ後、GitHub `main` とVercel Productionが一致することを確認。新migrationファイルの追加により `.github/workflows/supabase-production-auto-deploy.yml` が起動するが、ここで許されるのは**pending検査・dry-run・Staging parity・承認引継ぎのみ**。Production DBへの書き込みは禁止。
4. DB反映前、`following.html` は一覧RPCの未導入を `PGRST202`／`42883` として捕捉し、「データベース反映待ち」を表示する。フォロワー情報を生テーブルのSELECTで代替することはない。公開された画面を「完全稼働」と表示しない。
5. Vercel READY、migration planning（dry-run）、現行のVercel／Supabase隔離が揃わない場合はProduction DB移行を実行しない。

### 第2段階 — Production Supabase DB移行（**別個の**「本番承認」）

1. 現行のProduction Approval Ledger [Issue #2498](https://github.com/bingohooah888-ai/novelrise/issues/2498) がOPEN、OWNER認証付きであることを再確認。Issue #165はLEGACY・CLOSEDであるため新承認に使わない。
2. 現在の `main` のmigration集合とProduction DB履歴を比較し、**pending setが `20261031173000` 1件と完全一致**することを確認。もし他のmigrationが混入・追加されていれば、そのセットを勝手に承認範囲へ含めず**停止**。
3. Stagingのmigration履歴と、その時点のリポジトリmigration履歴が完全一致することを確認する。
4. Production DB変更対象を明記して、新しいOWNER「本番承認」を得る。専用の `.github/workflows/production-migration-approved-dispatch.yml` → `supabase-production.yml` の検証済み経路だけを利用する。最新main SHA／pending migration集合／ワンタイム承認を厳密に照合し、既存のEnvironment保護を維持する。
5. Production DBに1件だけ移行後、再読してmigration count・3関数の存在・`SECURITY DEFINER`・空の `search_path`・`authenticated` EXECUTE可・`anon`と`PUBLIC` EXECUTE不可・RLS維持・匿名の生テーブルSELECT不可を確認する。手順の根拠は `supabase/checks/20261031173000_followed_authors_list_postcheck.sql`。
6. 対象本番画面（本棚・交流広場の導線・`following.html`）の表示と、実ユーザーによるフォロー・通知・解除を本人の明示的な認証の範囲で検証。Productionで合成ユーザーや書き込み試験を勝手に作成しない。

## 障害と復旧

- **DB未反映／移行拒否**：UIは「データベース反映待ち」を維持し、匿名・他人のフォロー関係を公開しない。承認なしの直接SQL適用・スクリプト回避・権限緩和は禁止。
- **DB移行後にRPCが異常**：まずread-onlyログ・ACL・schema cache・migration historyを調べる。既存の本棚／作品／フォロー関係レコードは保持する。
- `supabase/rollback/20261031173000_followed_authors_list_rollback.sql` は専用の手動復旧候補であり、**独立した明示承認なしに実行しない**。3関数のみDROP、CASCADEなし、フォロー行は削除しない。実行するならmigration履歴との整合を別途設計・検証すること（関数DROPだけでは履歴は戻らない）。
- コード差し戻し／Vercel Production再デプロイも別途対象を明記した本番承認と既存の安全ゲートを守る。
- 実証の4段階は別々に報告する：コード実装、自動テスト、Staging実環境、Production反映。

## 承認境界（2026-11-01時点）

本資料を作る／PR本文を更新する／read-onlyで監査することはProduction承認の代用ではない。PR #2698はドラフト・未マージを保持し、Production DB変更・本番公開を行わない。
