-- Data-preserving rollback for NOVELIGHT trusted public impression receipts.
--
-- This rollback intentionally disables only the v2 trusted public receipt API.
-- It keeps viewer_key, nullable viewer_id, expanded constraints, and collected
-- exposure/receipt data intact so rollback never destroys author analytics data.
-- The browser code falls back to the existing v1/legacy discovery paths when
-- these v2 RPCs are unavailable.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:rollback:trusted-public-impression-receipts'));

revoke all on function public.novelight_trusted_discovery_feed_v2(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.novelight_trusted_plan_extra_feed_v2(integer, text[], text) from public, anon, authenticated;
revoke all on function public.novelight_issue_visible_allocation_receipts_v2(text, text[], text, integer, text) from public, anon, authenticated;
revoke all on function public.record_trusted_allocation_receipts_v2(uuid[], text) from public, anon, authenticated;

drop function if exists public.novelight_trusted_discovery_feed_v2(text, integer, text, text, text);
drop function if exists public.novelight_trusted_plan_extra_feed_v2(integer, text[], text);
drop function if exists public.novelight_issue_visible_allocation_receipts_v2(text, text[], text, integer, text);
drop function if exists public.record_trusted_allocation_receipts_v2(uuid[], text);

revoke all on function private.novelight_trusted_discovery_feed_v2_impl(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function private.novelight_trusted_plan_extra_feed_v2_impl(integer, text[], text) from public, anon, authenticated;
revoke all on function private.novelight_issue_visible_allocation_receipts_v2_impl(text, text[], text, integer, text) from public, anon, authenticated;
revoke all on function private.record_trusted_allocation_receipts_v2_impl(uuid[], text) from public, anon, authenticated;

drop function if exists private.novelight_trusted_discovery_feed_v2_impl(text, integer, text, text, text);
drop function if exists private.novelight_trusted_plan_extra_feed_v2_impl(integer, text[], text);
drop function if exists private.novelight_issue_visible_allocation_receipts_v2_impl(text, text[], text, integer, text);
drop function if exists private.record_trusted_allocation_receipts_v2_impl(uuid[], text);

-- Keep generic direct impression writers unavailable after rollback.
revoke all on function public.record_novel_impressions(text, text[], text) from public, anon, authenticated;
revoke all on function public.record_novel_impressions_v2(text, text[], text) from public, anon, authenticated;

commit;
