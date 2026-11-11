# SCOUT Point利用5テーブル：Staging反映ワンショット手順（2026-11-11）

対象：Draft PR #2762／`feature/reader-reward-gate01-20261104`。この文書・SQL・テストは**準備のみ**であり、Staging実行承認ではない。main・Production・Preview・実Point・外部交換・実AIは対象外。

## 対象と適用

- Supabase Staging **`wmlzjgvxgoyrovdhbqbg`**（Production `fiepaguycecrredwrcwx` の開発ブランチ）。`docs/plans/SCOUT-FORMAL-POINT-USAGE-STAGING-APPLY-20261111.sql` のみを既存の単回migration経路で適用する。適用migration名：`scout_formal_point_usage_private5_20261111`。SQLを編集してから承認を流用しない。
- 作成するのは `novelight_formal_private` 内の `scout_point_usage_wallets`、`scout_point_usage_budgets`、`scout_point_usage_operations`、`scout_point_usage_events`、`scout_point_usage_credit_claims` の5テーブルと付随インデックス・制約・RLS・対象限定ACLだけ。既存のLEVELテーブル3件／関数3件、既存Point/XP台帳、その他既存スキーマ権限に変更を加えない。
- 既存Draft SQLの型・Point換算・最低交換額を維持。Point発行・加算関数、報酬トリガー、初期walletデータ、budget行、RLS policy、GRANTは作らない。正式報酬を配布・消費・公開する機能は起動しない。

## 実サーバーDBロールの確定状況とACL

2026-11-11の**Staging読み取り専用**確認で、適用セッションは`postgres`、`service_role` は **NOLOGIN / BYPASSRLS**、5対象テーブルは未作成だった。既存の正式用途Hostは未登録・pg pool未接続。したがって`service_role`を「実際のPostgresサーバーログイン」とみなすのは誤りであり、現在の正式機能のアプリDBログインロールは**未存在／未確定**。

今回の最小権限は**公開ロール・service_roleを含むアプリ向けテーブルDML権限ゼロ**、5テーブルRLS有効・ポリシーなし。既存の共有`novelight_formal_private` schemaに対する全体REVOKEは行わない。将来実接続を組む時に、**実際の接続ロール／SET ROLEを検証してから**、必要テーブルにだけSELECT / INSERT / UPDATE（イベント／credit claimは原則SELECT / INSERT）のGRANTと必要なRLS policyを別工程で設定する。BYPASSRLSの`postgres`をアプリ用writerとして無検証で利用しない。これは今回の空テーブル作成の阻害要因ではない。

## 「ステージング承認①」後の一括実施（追加Workflowなし）

1. 最新PR HEAD、SQL blob、Staging refの一致を確認する。既存の承認済みバックアップ・復旧手順を再利用し、Stagingの復旧可能なスナップショットと復元検証結果を確認する（参考：`docs/plans/READER-REWARD-POINT10X-STAGING-APPROVAL-RUNBOOK-20261105.md`）。復元可能状態の確認ができなければ**書込みを開始しない**。新たなWatchdog・Runner・Workflowを作らない。
2. このSQLだけをStagingに**1回**migrationとして適用する。新しいDDLを付け足さない。実行結果が失敗なら重複実行せず原因とDB状態を確認する。
3. 対象5テーブルの存在、RLS有効、必要なPK・FK・CHECK・UNIQUE・インデックス、公開ロール・service_roleのDML権限なし、5テーブル行数0、既存LEVEL資産変更なしを、read-only catalog / countで確認する。Stagingの実JWT書込み、報酬付与、外部交換・AI試用は行わない。
4. 合格なら次は正式LEVEL・報酬の実データ接続へ進む。アプリDB roleの確定と限定GRANTはその**接続直前**に扱い、今回のmigrationを機能公開とみなさない。

**合格条件**：5/5テーブルが意図どおり存在、5/5 RLS有効、想定インデックス／制約存在、対象テーブル空、禁止ロールDMLなし、既存LEVEL等無変更。未実証：実接続・取引原子性・RLSの実JWT動作・外部provider・Production。

### 適用直後に実行する最小のread-only確認SQL

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_dml,
       has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as user_dml,
       has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') as service_dml
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='novelight_formal_private' and c.relkind in ('r','p')
  and c.relname in (
    'scout_point_usage_wallets','scout_point_usage_budgets',
    'scout_point_usage_operations','scout_point_usage_events',
    'scout_point_usage_credit_claims')
order by c.relname;
-- exactly 5 rows; all rls_enabled=true, all *_dml=false.

select tablename,indexname from pg_indexes
where schemaname='novelight_formal_private'
  and tablename like 'scout_point_usage_%'
order by tablename,indexname;
-- Confirm PK/UNIQUE and usage secondary indexes; check FK/CHECK in pg_constraint.

select 'wallets' as name,count(*) from novelight_formal_private.scout_point_usage_wallets
union all select 'budgets',count(*) from novelight_formal_private.scout_point_usage_budgets
union all select 'operations',count(*) from novelight_formal_private.scout_point_usage_operations
union all select 'events',count(*) from novelight_formal_private.scout_point_usage_events
union all select 'credit_claims',count(*) from novelight_formal_private.scout_point_usage_credit_claims;
-- exactly 5 rows; all count=0. Existing LEVEL objects remain unchanged.
```


## 逆操作・復旧（該当5テーブルのみ）

- **データ未投入かつ依存物が未作成**であると確認できた場合に限り、復旧承認範囲の中で以下の順序で逆操作する。**CASCADEは使用しない。共有schema・既存LEVEL資産をDROPしない**。DB変更の逆操作も既存のOWNER承認境界を守る。

```sql
drop table novelight_formal_private.scout_point_usage_credit_claims;
drop table novelight_formal_private.scout_point_usage_events;
drop table novelight_formal_private.scout_point_usage_operations;
drop table novelight_formal_private.scout_point_usage_budgets;
drop table novelight_formal_private.scout_point_usage_wallets;
```
- 既にデータや依存がある場合、盲目的DROPや再適用をせず、事前に検証した既存バックアップからの復元計画に切り替える。バックアップ/復元の確認なしにSQLを実行しない。

## 禁止・完了境界

新規PR・新規Workflow・main統合・Production・Previewのデプロイ・実JWT・Pointの発行/消費・外部ギフト交換・有料AI・一般公開は実施しない。今回の作業は**SQL＋限定テスト＋既存PRへの保存**で完了し、承認後は上記の1回だけを実行する。
