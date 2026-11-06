# NOVELIGHT βScout Point10倍｜SECURITY DEFINER／旧単位Writer停止／永続マーカーの検証契約（非実行）

作成：2026-11-05 JST  
対象：本体Draft PR #2762 `feature/reader-reward-gate01-20261104`  
設計時GitHub main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`  
設計開始時本体PR HEAD：`184955de8302d2a1ba029f5e3e90f11c1265ae43`  
独立SQL候補Draft PR #2763 HEAD：`58e60ef90801078e097e321590428c4b8b343486`

**結論：旧5pt→新50ptのSECURITY DEFINER関数の差分を完全一致でレビューできる契約と、旧単位Writer停止・永続切替マーカー・バックアップ／復旧の非実行依存関係を追加する。Staging／Production DBの変更、SQL実行、main統合、本番デプロイは実施せず、実際のcutoverを許可しない。**

## 1. FULL PREFLIGHTで確認した根拠

- 正式main MASTER `docs/NOVELIGHT-MASTER.md`（blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、全5,089行）、`AGENTS.md`、`docs/WORK-EXECUTION-PREFLIGHT.md`、`docs/AUTOMATION-CONTINUATION-GATE.md`、`docs/NLO-EXECUTION-POLICY.md`、`docs/development-workflow.md`を確認。OWNER本人・最新main SHA・対象限定scope・一回限りの機械承認が安全ゲート。Production操作／main mergeは独立承認。
- Draft PR #2762の新承認経路 `.github/workflows/staging-reader-point-tenfold-proof.yml` は**rollback-only**、Issue #294のOWNER確認、CLAIMED／CONSUMEDの再利用拒否、別project ref `wmlzjgvxgoyrovdhbqbg`、SHA固定、backup／独立restore前提。ただしこのworkflowは**main未統合で稼働しない**。
- 別Draft PR #2763の候補SQL4本は`supabase/migrations/20261105120000_reader_reward_point10x.sql`など。通常のmigration replayで誤変換しないよう、トランザクションローカルrollback-onlyフラグが必要。既存trusted-main `scripts/staging-candidate-sql.mjs`は`SECURITY DEFINER`を含むSQLを拒否し、当該候補は**付与RPC変更なし／全処理はROLLBACK**。安全フィルターを緩和しない。
- 現行Production Supabaseを**システムカタログ／関数定義のSELECTのみ**で確認（実データ更新なし）。関連5表（`scout_xp_ledger`、`scout_point_ledger`、`scout_badge_definitions`、`user_scout_badges`、`scout_point_operator_actions`）のRLSは有効、force RLSは未設定。SECURITY DEFINER所有者はpostgresのため、直接呼び出し権限と安全な呼び出し経路が不可欠。

## 2. レベルアップ付与RPC：確定している観測事項

| 不変項目 | 読み取り専用の実測 |
| --- | --- |
| 署名 | `public.novelight_award_level_up_points()`、戻り値trigger |
| 所有者・権限 | `postgres`、EXECUTE ACLは`postgres=X/postgres`・`service_role=X/postgres` |
| Security mode | `LANGUAGE plpgsql`、`SECURITY DEFINER`、`SET search_path TO ''` |
| PostgreSQL関数定義MD5 | `830b9784d2e7d5bdd71054188aa06e91` |
| 取得した関数定義のSHA-256（UTF-8） | `24be8677e21321908b27733eec1005c7bdf394aba32bdaa9de0f7b071e53c1a9` |
| Trigger | `scout_xp_level_up_points` が `scout_xp_ledger` の AFTER INSERTで実行（現在enabled） |
| 旧報酬 | レベル初回到達ごとに5 Scout Point（現行仕様） |
| 冪等性 | `event_key='level_up:' || user_id || ':' || level`、`ON CONFLICT (event_key) DO NOTHING` |
| XP例外 | `xp_value<=0`、`xp_kind='light_seed_discovery'`は付与しない |

新規 `tests/fixtures/reader-reward-levelup-trigger-legacy.sql` に、**read-onlyで取得した関数定義全文**をテストfixtureとして保存。改変されないSHA-256／PG MD5を基準に、`'level_up', 5, 'confirmed'`の唯一の5を50に置換する場合だけ`source_diff_review_candidate_only`を返す。戻り値の`candidateSql`は**コードレビュー用文字列にすぎず、migrationファイル生成・SQL送信・関数書換えはしない**。SECURITY DEFINER／search_path／所有者／EXECUTE ACL／トリガー紐付け／冪等なevent key／メタデータを勝手に変更する候補は保留。OWNERや権限・トリガーの実測は入力の自己申告では証明されないため、適用時にカタログの独立再照合が必要。

## 3. 旧単位でPointを書ける経路を「全停止」させる必要

当該レベルアップトリガーだけを止めても**安全ではない**。カタログに以下の関数が残存する：旧Rank内部用レベル付与`novelight_award_level_up_points_rank_internal_20260928()`、旧Rank内部用発掘付与`novelight_award_discovery_points_rank_internal_20260928()`、称号評価`novelight_apply_scout_badge_evaluation(...)`、称号進捗`novelight_apply_scout_badge_progress(...)`、運営操作`novelight_admin_scout_point_action(...)`。これらのうち旧関数の一部は現在のトリガーに直結していない場合があるが、**関数が残っているだけで到達不能と断定しない**。service_role／直接RPC／Cron／Edge／再送キュー／旧APIルートも棚卸し対象。

- XPからの付与：`scout_xp_ledger`には`scout_xp_beta_level_cap`、`scout_xp_level_up_points`、`scout_xp_refresh_reader_badges`の3トリガーがenabled。
- Point台帳には`scout_point_earning_control`（BEFORE INSERT）、`scout_point_refresh_reader_badges`（AFTER INSERT又はstatus変更）がenabled。**Point値のUPDATEのみでは称号進捗が自動追随しない**ため、2つのPoint累積称号の進捗を一括調整し、再評価による重複授与を発生させない。
- 9分類の書込み経路（XP／旧Rank／発掘／称号／運営／service_role／Cron・Edge・Queue／読書・コメントAPI／retry・outbox）を一括で停止・排他確認。未分類経路が0、in-flight付与・再送が0、実DBで旧・新単位が混在できないfenceが存在すると別経路の証拠で確認するまでは再開不可。
- 新規純粋関数`quoteScoutOldUnitWriterStop`は全経路が`paused`等だと自己申告されても**safeToResume=false／mayWriteDb=false**。実権限・到達性・Cron／Edge構成は実カタログ＋実行環境から別途確認する。

## 4. 永続切替マーカーと一回限りの原子commit（設計のみ）

新規`quoteScoutDurableMarker`は、**外部公開していないprivate schema**に、一意制約`(cutover_scope, target_unit_version)`を備えた専用永続マーカーを設ける案を提示する。名前やDDL・アクセス制御は未確定。general service-roleやクライアントから自由に書き換えられず、権限を持つ限定operatorが監査付きで操作することを要件にする。

切替の一致境界は**同一DBトランザクション**で次をまとめる必要がある：旧Version確認・マーカー作成、全LedgerのPoint数値10倍、称号報酬定義10倍、Point累積称号の閾値と進捗10倍、運営調整額10倍、所有者／ACL／search_pathを保った50pt新RPCの切替、Event監査と状態突合。部分commit／途中再試行で再10倍しない。履歴はevent_id／user_id／event_key／status／source／reversalを維持し、Point以外のXP・読書数・Rank・称号獲得回数は不変。**既存の台帳追記不可変原則と既存行換算の整合レビューが別途必要**。

すべての入力条件をtrueにしても、純粋関数は`markerCreated=false`／`migrationApplied=false`／`mayWriteDb=false`。DDLや永続migration実行コードを追加していない。

## 5. バックアップ、ロールバック、切替失敗後の復旧条件

1. 最新main／候補HEAD、Issue #294 scope専用承認、Productionと別Staging refの固定、全writer台帳のfresh監査。
2. **適切なStaging全体バックアップ取得＋独立DBへの完全復元**。SQL表だけでなく、関数、トリガー、権限、RLS、extensionsや利用中の非DB資産への依存も確認。バックアップ本体・キー・個別user履歴はログへ出さない。
3. 付与／閲覧／再送経路の安全な停止窓を設け、全Writerが止まったことをDB上のfenceと権限・動的設定の証拠で確認。
4. 前述のprivateマーカーと5つのPoint関連データ面、Writer RPCを**単一トランザクション**で更新。前後の全行再照合（Point、新規発行、event_key、status、reversal、earned、XP、RPC digest、SECURITY DEFINER owner/ACL/search_path、既存トリガー）と異常系／二重実行／rollbackの証明が完了するまで書込み停止を維持。
5. **commit前に障害**：トランザクションをROLLBACKし、旧バージョンと旧関数・データが丸ごと残ることを独立確認。**commit後に新規正当なPointを発行した後**：古いバックアップで上書きすると発行を消してしまうため、一律巻戻しは禁止。旧・新Ledger差分、マーカー、provider/outbox、再送を比較し、forward repair等の別承認復旧を検討。
6. Stagingで全Write-path・Read RPC・表示・本人RLS・再試行／並走の実証ができた場合にのみ、再開を別途判断。Productionには**別の専用承認**が必要。

**注意：** 独立Draft PR #2763のROLLBACK-only SQLは、既存の`SECURITY DEFINER`安全フィルターにより**50pt Writer RPC変更を含められない**。PR #2762の承認workflowはまだmainにない。したがって、どちらも完全な永続切替の実行許可や復旧保証にはならない。今回の作業でもその制限を解除・迂回していない。

## 6. 非公開実装・自動テスト

追加（本体Draft PR #2762だけ）：

- `api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js`：read-only pure ESM。署名・関数MD5／SHA256固定→5pt→50pt差分候補、SECURITY DEFINER parity、既存Writerの停止条件、private永続マーカー設計、12段階依存ゲート。
- `tests/fixtures/reader-reward-levelup-trigger-legacy.sql`：read-only観測のレベルアップ付与RPC全文の固定fixture（秘密値・user IDなし）。
- `tests/reader-reward-point-tenfold-writer-cutover-contract.test.mjs`：**49 focused tests**。5→50唯一差分、署名・所有者・ACL・search_path・旧Rank writer経路・イベントkey・すべてself-certifiedでもNO write、markerや全Gateのfail-closed。
- 本レポート。

ローカルの隔離Node24上で、今回の49件は49 PASS。過去Gateと本体PR #2762相当テスト431件を含む**480 PASS／0 FAIL**。さらに独立SQL候補PR #2763の28件を合わせてすべて走らせた場合は508 PASS／0 FAIL（これは**別PR同士の混合ローカル試験**であり、本体PRに508件のテストをコミットしたという意味ではない）。Prettier／ESLint／Node構文は確認。

GitHub CI／CodeQLの最終結果は本体Draft PR #2762最新HEADの実行結果で追記する。main／#2763の差分には触れない。

## 7. 完了／未完了の判定

| 対象 | 判定 |
| --- | --- |
| 正式MASTER、安全ゲートとPR2本のfresh確認 | 完了 |
| 現行5pt RPCと権限・trigger／旧Rank writerの実DB SELECT監査 | 完了（read-only） |
| 50pt関数の**1箇所のみ**の文字列差分と危険変更の拒否 | 非実行コード＋focused tests完了 |
| 旧単位Writer停止とprivateマーカー依存関係 | 設計・fail-closedテスト完了、実装・実証は未完了 |
| Stagingバックアップ／独立Restore、SQL／RPC適用、実ブラウザ検証 | **未実施** |
| 実Staging／Production DBの書込み、main統合、本番deploy | **未実施** |

**次の承認判断：** 現行のrollback-only経路にSECURITY DEFINERを書き込める権限を追加するのでなく、独立した「安全なRPC切替の審査・実行契約」と「単一トランザクションで切替できるwriter freeze＋marker／復旧証明」を別途開発・レビューする。main統合もProduction DB変更も今回の承認には含まれない。
