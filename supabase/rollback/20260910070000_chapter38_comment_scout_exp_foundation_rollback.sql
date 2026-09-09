-- Roll back the Chapter 38 comment runtime without deleting comment evidence.
-- Stored comments and scout_event_ledger remain intact for later replay.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910070000:rollback'));

delete from public.scout_xp_ledger x
where x.xp_kind = 'comment'
  and x.rule_version = 'beta-v1';

revoke all on function public.novelight_comment_feed(text, integer) from public, anon, authenticated;
revoke all on function public.post_novel_comment(text, text) from public, anon, authenticated;
revoke all on function public.delete_novel_comment(uuid) from public, anon, authenticated;

drop function public.novelight_comment_feed(text, integer);
drop function public.post_novel_comment(text, text);
drop function public.delete_novel_comment(uuid);

-- Deliberately preserve public.novel_comments and raw comment_posted /
-- comment_deleted SCOUT events. Reapplying the migration derives EXP again from
-- that immutable history instead of pretending the beta activity never happened.

commit;
