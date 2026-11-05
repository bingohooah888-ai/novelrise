# NOVELIGHT β Scout Point ×10｜独立SQL候補・ROLLBACK限定設計報告

2026-11-05 JST／対象バージョン `20261105120000`  
状態：**候補Draft PR／コード・自動テストのみ**。Staging・Productionの実DB書込み、Staging実行、main統合、本番デプロイなし。

## 1. 正式根拠／独立分離

- 設計時のmain `03f64b14138ec5c6a90c0d8231a0784f878e78fa`、main MASTER `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`（全文5,089行）。`AGENTS.md`、FULL PREFLIGHT、Continuation Gate、NLO Policy、development workflowを照合。
- Reader Rewardの本体は未統合の**Draft PR #2762** HEAD `184955de8302d2a1ba029f5e3e90f11c1265ae43`。そこに新規8ファイルとして提案済みのPoint10倍Staging専用承認経路も未統合。**SQL候補はPR #2762を改変せず、最新mainを起点とする独立ブランチ／Draft PRで作成**。
- 検証対象は専用scope `reader-reward-beta-point-10x-staging` の **rollback-only**。GitHub Issue #294の真正なOWNER認証、exact fresh main／候補HEAD、単発CLAIMED→CONSUMED、専用Staging ref `wmlzjgvxgoyrovdhbqbg`、バックアップ・Restoreが成立して初めて後日実行可能。現在のworkflowはmainに未反映であるため、実行不可のまま。
- mainの既存trusted SQLコンパイラ `scripts/staging-candidate-sql.mjs`（blob `7d88cf242220b0310e3e375a98fb0868c0d67da0`）で候補SQLの制約を検査。コンパイラは候補migration内のBEGIN/COMMITの**本文だけ**を取り出して、precheck→migration→postcheckを単一**BEGIN…ROLLBACK**へ組み直す。`rollback.sql`は承認対象Git blobとして固定するが、既存コンパイラは実行対象に含めない。

## 2. 4種類のSQLファイル

| ファイル | 役割 |
| --- | --- |
| `supabase/checks/20261105120000_reader_reward_point10x_precheck.sql` | 4表の排他ロック。旧Stagingスナップショットと採番・集計・閾値・数値範囲、対象トリガー3件、レベル・称号付与RPC定義ハッシュ、一部マーカーを検査。全行の元データを同一トランザクション内のtemp表に保管。 |
| `supabase/migrations/20261105120000_reader_reward_point10x.sql` | Point台帳全行、称号報酬、累積Point称号2条件、該当進捗、運営調整額の5対象フィールドを10倍する**ROLLBACK実証用SQL**。負数／非confirmed含む台帳状態、XP、イベントID、他称号の実績は変更しない。 |
| `supabase/checks/20261105120000_reader_reward_point10x_postcheck.sql` | 4対象表すべてについて、tempの元の**全行JSONB**と期待されるフィールドのみ10倍した全行JSONBが完全一致することを確認（追加・削除行、想定外カラムの変更も拒否）。Point合計・閾値・付与RPCの不変も確認。 |
| `supabase/rollback/20261105120000_reader_reward_point10x_rollback.sql` | 第4のレビュー対象。スタンドアロンROLLBACKと旧スナップショット復帰チェックの保守用補助ファイル。**既存コンパイラは実行しない**。本番の永続変更の復旧手段ではない。 |

旧Staging snapshot（2026-11-05のread-only記録）：Point Ledger **3,581行／1,605人／3,581pt**、称号定義 **182行／835pt**、Point進捗 **12,870行／合計7,162**、Point累積称号閾値100／500。**今回はStagingを一切照会・実行せず**、上記履歴を強制的なfail-closed precheckに固定した。実行時に値が変わっていれば停止し、新しいread-only確認・レビュー・承認が必要。

## 3. SECURITY DEFINER と現行フィルターの衝突

- 実Supabaseのread-onlyメタデータ監査（Production SELECTのみ）で、`novelight_award_level_up_points()` は**SECURITY DEFINERのトリガー関数**、現行版で初回レベル到達**旧5pt**を付与することを確認した。関数DDLのMD5は`830b9784d2e7d5bdd71054188aa06e91`。称号付与 `novelight_apply_scout_badge_evaluation(...)` もSECURITY DEFINERで、称号報酬の定義行を参照。MD5は`e912c55468e49cdcf00be084f21d283b`。
- **既存trusted-main `staging-candidate-sql.mjs`はSQLテキストの`SECURITY DEFINER`を危険操作として拒否**する。このため、安全フィルターを緩めて関数変更を通すことはしない。今回の4 SQLは付与RPC自体を一切書き換えず、pre/postに旧関数のMD5固定を置いた。
- このROLLBACK-only証明で実証できるのは、**既存Point台帳・称号資産の数値10倍が同一トランザクションで行えるか**であり、ユーザーが要求した**正式な全システム同時切替（将来付与5→50pt／1話1〜11pt／コメント20pt、表示／クライアント整合）を証明するものではない**。
- 真の永続Staging切替には、既存のsecurity-definer定義・権限／RLS・search_path等を保ったままレビュー可能な専用RPC変更契約、全writerの停止境界、追跡可能な永続切替マーカー、バックアップ／独立Restore、元値／新値全件照合、単発の別Staging OWNER承認が必須。

## 4. 予期する安全停止・残存の実証ギャップ

- この候補をmainにmergeしてしまうと`supabase/migrations/`内のSQLが通常の自動DB移行経路から見える。**レビュー候補としてDraft維持、mergeは禁止**。本候補のmigrationはProduction適用の承認も受けておらず、恒久的な本番実行ファイルではない。
- ROLLBACKだけではStaging外部へのメール・webhook等の外部副作用を元に戻せない。今回の前提で実トリガーを確認し、未知の追加トリガーならprecheckで停止する。**新たなトリガー／外部providerを勝手に無効化しない**。
- precheckの排他ロック、再集計、全行snapshot、postcheck JSONB差分は**同一トランザクション**で実行することが必須。トランザクション外に分割実行すると意味がない。
- rollback.sqlは既存Staging承認workflowの**実行対象外**。実ステージングで必要なバックアップ取得・独立復元・フルfingerprint照合・one-shot承認とrun結果は未実証。
- Node focused testsはコンパイラの許可形式、BEGIN/COMMIT抽出・最終ROLLBACK、固定スナップショット・型境界・該当テーブル限定・MD5定義・全行JSONB・悪意あるSQL拒否を検査。**SQL全体を実Supabaseで走らせたわけではなく、CI PASSをLive Proofと誤表記しない**。

## 5. 次工程に必要な判断

1. MASTER・安全ゲートとPR #2762側の専用承認workflowを個別レビュー。本番統合承認は今回要求・実施しない。main反映の時点で**Production自動デプロイの可能性**を別途説明し、承認された工程としてのみ扱う。
2. mainに承認経路が実装されて初めて、独立SQL候補Draft PRに対するfresh main/HEAD-bound OWNER **ステージング承認**を取り、Stagingバックアップ・独立Restore→厳密ROLLBACK-only検証を行う。旧承認を再利用しない。
3. 本番向け／永続Staging向けの**完全な10倍切替は別仕様**。Point付与RPCと動作中ライターの同時切替、永続マーカー、復旧を別レビューする。
