# NOVELIGHT Point10倍｜PostgreSQL CAS・spent・DB fence SQLレビュー候補

**2026-11-05 JST｜REVIEW ONLY / NO-GO。未適用・非稼働・実DB接続禁止。**

このファイルはSQL migrationでも実行workflowでもない。下記は提案構造であり、テーブルの実在、カタログ権限、PostgreSQL統合動作は未確認。**すべてのSQLブロック先頭に意図的な例外を置いている。** これを外して実行する許可はない。SQL候補は docs/plans 内だけに置き、supabase/migrations、supabase/checks、.github/workflows には追加しない。

最新main 03f64b14138ec5c6a90c0d8231a0784f878e78fa、MASTER blob 91d11fa367b7de64990b13397b13d4bb6e3c0230。独立rollback-only SQL候補Draft PR #2763は変更せず、永続cutoverの代用としない。

## A. 一次CONTROL Postgres：永続domainと一度限りのspent台帳

一次ストアはStaging/Productionと独立したPostgresを候補とする。Staging復元でもspentとepochが巻き戻らないこと。新スキーマ、権限、DDLは **実DBで未確認のレビュー案** である。

```sql
BEGIN;
DO $stop$ BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY_NO_GO_DO_NOT_EXECUTE' USING ERRCODE = 'P0001';
END $stop$;
CREATE SCHEMA IF NOT EXISTS novelight_reward_private;
REVOKE ALL ON SCHEMA novelight_reward_private
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE novelight_reward_private.point10x_mutation_domain (
  domain text PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  fencing_epoch bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  phase text NOT NULL CHECK (phase IN ('idle','claimed','ack_unknown','manual_hold')),
  active_comment_id bigint,
  active_run_id bigint,
  active_operation_id text
);
CREATE TABLE novelight_reward_private.point10x_spent_approvals (
  issue_number bigint NOT NULL CHECK (issue_number = 294),
  comment_id bigint NOT NULL CHECK (comment_id > 0),
  run_id bigint NOT NULL CHECK (run_id > 0),
  operation_id text NOT NULL UNIQUE,
  scope text NOT NULL,
  mode text NOT NULL,
  main_sha text NOT NULL CHECK (main_sha ~ '^[0-9a-f]{40}$'),
  candidate_sha text NOT NULL CHECK (candidate_sha ~ '^[0-9a-f]{40}$'),
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch > 0),
  mutation_domain text NOT NULL
    REFERENCES novelight_reward_private.point10x_mutation_domain(domain),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_number, comment_id),
  UNIQUE (scope, candidate_sha),
  UNIQUE (mutation_domain, fencing_epoch)
);
REVOKE ALL ON ALL TABLES IN SCHEMA novelight_reward_private
  FROM PUBLIC, anon, authenticated, service_role;
ROLLBACK;
```

**未解決の権限設計：** 実行権限のある専用OWNER、schema/table/sequenceのGRANTとdefault privileges、owner/superuserからの直接DELETE/UPDATE改変防止、spentの永久保存と監査が別途必要。ロールや既存schemaの状態を推測して強行しない。

## B. PRIMARY側の一つのSERIALIZABLE CAS transaction

trusted-mainが最新OWNER Issue #294コメント本人性と10項目のrequest、main SHA、PR候補HEAD、scope/mode、project ref、one-shot nonceを独立に検証してから呼ぶ想定。下記のバインド名は非実行のレビュー用であり、SQLドライバー実装ではない。

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $stop$ BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY_NO_GO_DO_NOT_EXECUTE' USING ERRCODE = 'P0001';
END $stop$;
SELECT version, fencing_epoch, phase
  FROM novelight_reward_private.point10x_mutation_domain
 WHERE domain = :domain FOR UPDATE;
-- Preconditions: one domain row; idle; expected version/epoch exact.
INSERT INTO novelight_reward_private.point10x_spent_approvals
  (issue_number, comment_id, run_id, operation_id,
   scope, mode, main_sha, candidate_sha, fencing_epoch, mutation_domain)
VALUES
  (294, :comment_id, :run_id, :operation_id,
   :scope, :mode, :main_sha, :candidate_sha, :expected_epoch + 1, :domain)
ON CONFLICT DO NOTHING
RETURNING comment_id, operation_id;
-- REQUIRE EXACTLY one returned row, otherwise ROLLBACK.
UPDATE novelight_reward_private.point10x_mutation_domain
   SET phase = 'claimed', version = version + 1,
       fencing_epoch = fencing_epoch + 1,
       active_comment_id = :comment_id,
       active_run_id = :run_id, active_operation_id = :operation_id
 WHERE domain = :domain AND phase = 'idle'
   AND version = :expected_version AND fencing_epoch = :expected_epoch
RETURNING version, fencing_epoch;
-- REQUIRE EXACTLY one returned row, otherwise ROLLBACK.
COMMIT;
```

**候補のままでは不十分：** 2つのRETURNING件数を単一トランザクション内で強制する安全な関数／専用実行器がまだない。SQLSTATE 40001（serialization failure）、23505（unique conflict）、あるいはCOMMIT応答喪失は、同じ承認を再取得する理由にしない。PRIMARYのread-only再照合までHOLD。GitHub CLAIMED/CONSUMEDコメントは副監査であり、PRIMARY committed spent tombstoneの代用不可。

## C. Staging Data Planeの強制fence設計（既存DBへ未適用）

**通常RLSとアプリ側tokenだけではservice_role、SECURITY DEFINER、所有者を必ず遮断できない。** 既存の9種類のWriter、5関係の全DML（INSERT/UPDATE/DELETE/TRUNCATE）、旧RPC、Edge/Cron/retry、直接service_roleを棚卸しすることが先決。

下は**freeze中の全DMLを拒否する概念**で、切替時に正当な更新のみ許す経路はまだ未設計。実トランザクションで適用する権限・ロールとtrigger状態・TRUNCATE専用trigger・DDL迂回の保護が確認できないため、NO-GOを解除しない。

```sql
BEGIN;
DO $stop$ BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY_NO_GO_DO_NOT_EXECUTE' USING ERRCODE = 'P0001';
END $stop$;
CREATE TABLE novelight_reward_private.point10x_writer_fence (
  domain text PRIMARY KEY,
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch >= 0),
  freeze_mode text NOT NULL CHECK (freeze_mode IN ('closed','manual_hold')),
  primary_epoch_confirmed bigint NOT NULL CHECK (primary_epoch_confirmed >= 0),
  CHECK (fencing_epoch >= primary_epoch_confirmed)
);
CREATE FUNCTION novelight_reward_private.deny_point10x_frozen_dml()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $guard$
DECLARE state text;
BEGIN
  SELECT freeze_mode INTO state
    FROM novelight_reward_private.point10x_writer_fence
   WHERE domain = 'issue294-point10x-all-staging-writers'
   FOR SHARE;
  IF NOT FOUND OR state IN ('closed','manual_hold') THEN
    RAISE EXCEPTION 'POINT10X_FENCE_DENY' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$guard$;
REVOKE ALL ON FUNCTION novelight_reward_private.deny_point10x_frozen_dml()
  FROM PUBLIC, anon, authenticated, service_role;
-- No CREATE TRIGGER on real Point/XP/Badge/Operator tables.
-- A row-level DML trigger does NOT guard TRUNCATE; a statement-level
-- BEFORE TRUNCATE trigger and owner/DDL/trigger-disable privileges need review.
ROLLBACK;
```

実際のData Planeは別DBのCONTROL CASとの分散atomic COMMITを前提にできない。CONTROLのepoch先行commit、Staging側fence失敗時は**停止を維持**する。Stagingスナップショット復元でlocal epochが巻き戻った場合も、CONTROL側epochを独立read-only再取得するまで古いWriterを再開しない。session GUC/current_settingを認可の根拠にしない。superuserは通常のRLS／triggerを回避できるため、役割分離とカタログ検証が不可欠。

## D. PostgreSQL catalogを読むだけの調査候補（今回も未実行）

```sql
BEGIN READ ONLY;
DO $stop$ BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY_NO_GO_DO_NOT_EXECUTE' USING ERRCODE = 'P0001';
END $stop$;
SELECT c.oid::regclass, c.relowner::regrole,
       c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('scout_xp_ledger','scout_point_ledger',
      'scout_badge_definitions','user_scout_badges',
      'scout_point_operator_actions');
SELECT p.oid::regprocedure, p.proowner::regrole, p.prosecdef,
       p.proconfig, p.proacl, pg_get_functiondef(p.oid)
  FROM pg_proc p WHERE p.proname = 'novelight_award_level_up_points';
SELECT t.tgrelid::regclass, t.tgname, t.tgenabled, t.tgtype
  FROM pg_trigger t
 WHERE t.tgrelid IN ('public.scout_point_ledger'::regclass,
                     'public.scout_xp_ledger'::regclass);
ROLLBACK;
```

必要な追加調査：既存role membership、table/sequenceの実GRANT、TRUNCATE権限、owner／superuser・SECURITY DEFINER・同名関数の署名、triggerのenabled state、Data API公開schema。**本ターンでは実DBのSELECTすら実施しない。**

**参照：** PostgreSQL 18 Explicit Locking（FOR UPDATE／advisory lockは自主的に協調する実装が必要）、Supabase Row Level Security（GRANTとRLSの別判定、service_role bypassrls）、Supabase 2026 breaking-change changelog。実際の互換性はStaging限定の許可済み統合試験でしか証明できない。

**最終判定：REVIEW ONLY / NO-GO。**
