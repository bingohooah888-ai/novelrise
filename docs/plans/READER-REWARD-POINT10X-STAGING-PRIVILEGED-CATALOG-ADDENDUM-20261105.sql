-- NOVELIGHT Point10x / PRIVILEGED CATALOG ADDENDUM / INERT REVIEW ONLY.
-- Separate additive candidate; not a migration and not executable in this turn.
-- Existing eight-query SQL pack and its SHA256 MUST remain unchanged.
-- Fresh, new OWNER-scoped approval would be required for any future execution.
-- No row data, secrets, function bodies, job command payloads, or DDL/DML.
-- PostgreSQL 15+ syntax proposed; has NOT been run on any database.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- NL-GAP-01: dynamic trigger inventory including scout triggers on non-scout tables.
SELECT
  'NL-GAP-01' AS evidence_id,
  n.nspname AS table_schema,
  c.relname AS table_name,
  pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
  t.tgname AS trigger_name,
  t.tgenabled AS trigger_enable_state,
  t.tgisinternal AS internal_trigger,
  p.oid::regprocedure::text AS invoked_function_identity,
  pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
  owner_role.rolsuper AS owner_superuser,
  owner_role.rolbypassrls AS owner_bypassrls,
  p.prosecdef AS is_security_definer,
  EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS cfg(setting)
    WHERE cfg.setting LIKE 'search_path=%'
  ) AS function_has_fixed_search_path,
  CASE WHEN sr.oid IS NULL THEN NULL
       ELSE pg_catalog.has_function_privilege(sr.oid, p.oid, 'EXECUTE')
  END AS service_role_can_execute,
  t.tgtype AS trigger_type_mask
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
LEFT JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
LEFT JOIN pg_catalog.pg_roles sr ON sr.rolname = 'service_role'
WHERE n.nspname = 'public'
  AND (
    t.tgname ~ '^scout_'
    OR p.proname ~ '^novelight_.*(scout|seed|badge|point)'
  )
ORDER BY c.relname, t.tgname, p.oid::regprocedure::text;

-- NL-GAP-02: public function registry, including renamed legacy and unknown SECDEF.
-- Enumerate relevant identities, not a hardcoded 12-signature allowlist.
WITH roles(target_role) AS (
  VALUES ('service_role'), ('anon'), ('authenticated')
)
SELECT
  'NL-GAP-02' AS evidence_id,
  p.oid::regprocedure::text AS function_identity,
  pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
  owner_role.rolsuper AS owner_superuser,
  owner_role.rolbypassrls AS owner_bypassrls,
  p.prosecdef AS is_security_definer,
  EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS cfg(setting)
    WHERE cfg.setting LIKE 'search_path=%'
  ) AS function_has_fixed_search_path,
  p.proacl IS NOT NULL AS explicit_function_acl_present,
  r.target_role,
  role_record.oid IS NOT NULL AS role_found,
  CASE WHEN role_record.oid IS NULL THEN NULL
       ELSE pg_catalog.has_function_privilege(role_record.oid, p.oid, 'EXECUTE')
  END AS role_can_execute,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgfoid = p.oid
  ) AS referenced_by_trigger
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
CROSS JOIN roles r
LEFT JOIN pg_catalog.pg_roles role_record ON role_record.rolname = r.target_role
WHERE n.nspname = 'public'
  AND (
    p.proname ~ '^novelight_.*(scout|seed|badge|point)'
    OR p.oid IN (
      SELECT t.tgfoid
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace tn ON tn.oid = c.relnamespace
      WHERE tn.nspname = 'public' AND t.tgname ~ '^scout_'
    )
  )
ORDER BY p.oid::regprocedure::text, r.target_role;

-- NL-GAP-03: effective rights on tables reached by scout-related triggers.
-- This is a review inventory, not proof that DDL owners cannot disable triggers.
WITH target_table AS (
  SELECT DISTINCT t.tgrelid AS relid
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (
      t.tgname ~ '^scout_'
      OR p.proname ~ '^novelight_.*(scout|seed|badge|point)'
    )
), roles(target_role) AS (
  VALUES ('service_role'), ('anon'), ('authenticated')
)
SELECT
  'NL-GAP-03' AS evidence_id,
  c.oid::regclass::text AS relation_identity,
  pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner,
  owner_role.rolsuper AS owner_superuser,
  owner_role.rolbypassrls AS owner_bypassrls,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  r.target_role,
  role_record.oid IS NOT NULL AS role_found,
  CASE WHEN role_record.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(role_record.oid,c.oid,'INSERT')
  END AS can_insert,
  CASE WHEN role_record.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(role_record.oid,c.oid,'UPDATE')
  END AS can_update,
  CASE WHEN role_record.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(role_record.oid,c.oid,'DELETE')
  END AS can_delete,
  CASE WHEN role_record.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(role_record.oid,c.oid,'TRUNCATE')
  END AS can_truncate,
  CASE WHEN role_record.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(role_record.oid,c.oid,'TRIGGER')
  END AS can_trigger
FROM target_table selected
JOIN pg_catalog.pg_class c ON c.oid = selected.relid
LEFT JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = c.relowner
CROSS JOIN roles r
LEFT JOIN pg_catalog.pg_roles role_record ON role_record.rolname = r.target_role
ORDER BY c.oid::regclass::text, r.target_role;

ROLLBACK;
