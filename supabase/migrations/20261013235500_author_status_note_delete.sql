-- Explicit owner-only hard deletion for author status notes (#19).
-- No deletions occur when this migration is applied.
begin;

create or replace function public.novelight_delete_my_author_note(
  p_note_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_note_id is null or p_note_id < 1 then
    raise exception using errcode = '22023', message = 'Invalid author note ID';
  end if;

  delete from public.author_notes note
   where note.id = p_note_id
     and note.author_user_id = v_uid;

  if not found then
    raise exception using errcode = '42501', message = 'Author note unavailable';
  end if;

  return true;
end
$$;

revoke all on function public.novelight_delete_my_author_note(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_delete_my_author_note(bigint)
  to authenticated;

comment on function public.novelight_delete_my_author_note(bigint) is
  'Permanently delete exactly one status note owned by the signed-in author, whether published or archived. Cannot be undone; no raw table privileges are granted.';

commit;
