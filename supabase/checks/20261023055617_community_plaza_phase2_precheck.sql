-- Read-only Phase 2 migration precheck: never lifts the public gate.
DO $phase2_precheck$
BEGIN
  IF to_regclass('public.community_runtime_control') IS NULL
     OR to_regclass('public.community_comments') IS NULL
     OR to_regclass('public.community_hidden_posts') IS NULL
     OR to_regclass('public.community_reports') IS NULL
     OR to_regprocedure('public.novelight_community_post_visible(text)') IS NULL
     OR to_regprocedure('public.novelight_admin_community_moderate(uuid,text,text,uuid,text)') IS NULL
  THEN RAISE EXCEPTION 'Community Phase 1 dependency is missing'; END IF;
  IF to_regclass('public.community_board_threads') IS NOT NULL
  THEN RAISE EXCEPTION 'Board table exists: review migration state before reapplying'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_runtime_control ctl
    WHERE ctl.singleton AND ctl.public_enabled IS FALSE AND ctl.activated_at IS NULL
  ) THEN RAISE EXCEPTION 'Shared community runtime gate is not safely disabled'; END IF;
END
$phase2_precheck$;
