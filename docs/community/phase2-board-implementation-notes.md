# 交流広場 Phase 2 — 掲示板 実装レビュー記録

更新: 2026-10-23。これは開発候補の状態記録であり、本番適用・正式MASTER改定・公開承認ではない。

## 同時公開条件
- 公開はタイムラインと掲示板を同時に行う。タイムライン単独公開はしない。
- サイト側のフラグは `timeline:false` /`board:false` を維持する。
- 両フラグがONでなければ、共通ヘッダー、タイムライン取得、交流通知、掲示板UIを起動しない。
- Supabase `community_runtime_control.public_enabled` は引き続きOFF。DB側OFF操作を繰り返さない。
- 両機能完成後に改めてOWNER本番承認と既存ゲートが必要。

## 本ブランチの実装候補
- 三つのテキストカテゴリ（作品の話・創作相談・雑談）。既存資料で正式名称が明示された場合はそれを優先する。
- 作成、一覧（15件ページング、最大200件まで）、詳細、本人編集、本人ソフト削除。
- Phase 1の `community_comments` を用いた返信、編集、削除、返信先、通報。
- Phase 1の `community_reports`、`community_hidden_posts`、`community_user_restrictions`、運営監査を再利用。
- 所有権、Block/Mute、運営非表示、年齢確認、アカウント年齢、投稿間隔・日次投稿数をDB RPC側で検証。
- 通知から掲示板スレッドへのリンク。
- 類似のRank、SCOUT XP/Point、LIGHT SEED、PV、作品コメントへの接続は追加しない。

## 2026-10-23 継続検証・スキーマ引継ぎ
- 本番DBを読み取り専用で再確認：`community_runtime_control.public_enabled=false`、`activated_at=null`、`community_board_threads` テーブル未作成。本番に変更はしていない。
- 既存のDBテストを拡張：本人のスレッド編集、作成者宛の返信通知、既存通報台帳、既存スタッフAPIのhide/restoreを、rollback-onlyの使い捨てCI PostgreSQLで検証する。
- **データ保護用のrollback候補**：`docs/community/phase2-board-rollback-review.sql`。公開ゲートがOFF、掲示板スレッドや交流レコードが空でなければ即座に中止し、Phase 1関数を復元したうえで追加テーブル/関数のみ除去する。既存データを自動削除するSQLではない。
- rollback候補の模擬テスト：`tests/rls/community-plaza-phase2-rollback-review.sql`。既存CIの使い捨て再生DBでのみ実行する。
- 現行MASTER第43章の交流広場追補をOWNER最新方針「タイムライン＋掲示板同時一般公開」へ更新（本PR内・未マージ）。
- 正式マイグレーションの生成経路は**未完了**：現実行環境にはSupabase CLIがなく、接続済みDesktop Commander端末も利用不可。レビュー用SQLをmigrationと偽装せず、CLIで`supabase migration new <name>`（正確な構文は実行時の`--help`で確認）を行ってから正式ファイルへ移す。
- GitHub CIは一時DB・モックテストのみ。別承認が必要な外部Staging／Productionへは接続しない。

## 安全境界
- `docs/community/phase2-board-schema-review.sql` は**レビュー用SQLでありmigrationではない**。
- 新テーブルRLS ON + anon/authenticated直接アクセス禁止、明示的な最小RPCだけ利用する案。
- SQLの原型は既存Phase 1の関数定義を元に、board keyだけ追補したもの。
- R15/R18の本文投稿を認める意図はない。全年齢宣言はユーザー自己申告なので、通報と運営審査が必要。
- 元のPhase 1のProduction schema/migrationは変更しない。

## 未完了・本番前の必須残件
1. 既存仕様とカテゴリ・スレッド編集、削除の契約を最終照合する。
2. Supabase CLIで正式migrationを生成し、review SQLを格納して実行順序・pre/postcheck・保全rollbackを審査する。現段階では生成していない。
3. 非Productionの隔離SQL/RLS権限・匿名閲覧・他人の編集・Block/Mute・通報・運営表示/非表示・削除後の不可視・連投制限を検証する（ユーザー承認済みの検証方針を守る）。
4. PC/スマホ模擬UI、Node/静的品質、既存タイムライン回帰、CodeQLを確認する。既に通過した同一検査を無駄に反復しない。
5. PRの必要な承認ゲートを通しProduction migrationとコード導入を別々に実施。新機能は両方完成するまでOFFのまま維持。
6. 最終本番承認後に両サイトフラグとDBの公開制御を同時に確認し公開する。OFF経路を残す。

**禁止:** このレビュー候補の存在だけで完成・公開済みと扱うこと。Staging/Previewを無承認で作成しないこと。
