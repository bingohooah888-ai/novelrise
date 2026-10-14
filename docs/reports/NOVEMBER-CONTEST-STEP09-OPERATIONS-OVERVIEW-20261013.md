# NOVELIGHT 11月コンテスト 工程⑨ — 運営統合画面（Draft / 非公開）

## Scope

工程⑦の `admin-contest-review.html` と工程⑧の
`admin-contest-rankings.html` を置き換えず、運営向け横断ビューを追加する。

- `admin-contest-operations.html`: 管理者専用の応募一覧、暫定pt、有効読者数、
  審査保留件数、賞金記録の審査/保留/承認/振込済み状態、最近12件の監査履歴。
- `GET /api/admin-contest-operations`: 既存の `requireAdmin`、同一Origin、
  Bearerのserver-side確認、allowlist、private/no-store。許可status・ページサイズ・
  offsetを限定し、POST等を405で拒否する。作品題名はブラウザの `textContent` のみ。
- migration `20261014230000_november_contest_admin_operations_overview.sql`:
  既存のprivate contest/entry/reader score/review audit/awardsテーブルを再利用する
  **service_role限定・読み取り専用集計RPC**。一般ユーザーのRPC呼出し権限は付与しない。
  1ページ最大20件・offset最大2000、審査保留または除外読者のptを計上しない。
- Prize関連は `novelight_contest_awards` の既存記録の**状態表示だけ**。
  `transfer_reference`、銀行口座、振込先、ゲストの識別子やraw読書証跡は一覧に出さない。
  賞金授与操作、振込実行、受賞認定は行わない。

## Tests and rollout

- 専用Node契約テストで管理者認証、同一Origin、ページ上限、禁止メソッド、
  RPCのみの読み込み、エラー時非公開、SQLの権限、UI書込なしを確認。
- 使い捨てPG17 `tests/rls/november-contest-integration.sql` に、
  role権限、`draft/public_visible=false`でのプライベート読み込み、
  不正フィルタ拒否、監査データを増やさないことを追加。
- 公開URLは新しい運営HTMLだけだが、データはadmin server guardでのみ取得可能。
  DB migrationの本番反映、PR mergeは別の**新規「本番承認」**が必要。
- コンテストの `draft/public_visible=false`、未受付、未計測、
  ranking publicationゲート、未登録Cronを維持。Preview/Stagingは起動しない。

## Remains after this Draft

工程⑨全体は未完了。賞金受取要件の運営決裁、最終的な受賞審査、
振込記録の安全な更新UI・監査RPC（人間の操作と別承認が必要）、
異議申立フロー、Production HTTP E2E、最新main統合、
本番反映後の実検証は今回含まない。

## Migration順序の更新（2026-10-14）

本番には既に `20261014224500` が適用されているため、工程⑨の未適用migration版番号のみ `20261014001000` から `20261014230000` に変更した。RPC/権限/業務ロジックに変更はない。旧番号ファイルは削除し、新版番号1件だけをpendingとして検証する。公開・受付・振込は行わない。
