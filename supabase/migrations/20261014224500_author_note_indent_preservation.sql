-- #61 Preserve author-chosen indentation while stripping only boundary line breaks.
-- Database-side counterpart to author-notes.html; existing notes are not modified.
begin;

CREATE OR REPLACE FUNCTION public.novelight_save_my_author_note(p_note_id bigint, p_title text, p_body text, p_linked_novel_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''), E'\r\n');
  v_note_id bigint;
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 then
    raise exception using errcode='22023', message='Title must be 1 to 80 characters after trimming';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(v_body)) < 1 or pg_catalog.char_length(v_body) > 1000 then
    raise exception using errcode='22023', message='Body must be 1 to 1000 characters after trimming';
  end if;
  if p_linked_novel_id is not null and not exists (
    select 1 from public.novels novel
     where novel.id = p_linked_novel_id
       and novel.user_id = v_uid
       and novel.status = 'published'
  ) then
    raise exception using errcode='42501', message='Linked novel must be your currently published novel';
  end if;

  if p_note_id is null then
    if (select count(*) from public.author_notes where author_user_id = v_uid and status = 'published') >= 100 then
      raise exception using errcode='22023', message='At most 100 published author notes are allowed';
    end if;
    insert into public.author_notes (
      author_user_id, title, body, linked_novel_id, status,
      published_at, created_at, updated_at
    ) values (
      v_uid, v_title, v_body, p_linked_novel_id, 'published',
      v_now, v_now, v_now
    ) returning id into v_note_id;
  else
    update public.author_notes
       set title = v_title,
           body = v_body,
           linked_novel_id = p_linked_novel_id,
           updated_at = v_now
     where id = p_note_id
       and author_user_id = v_uid
       and status = 'published'
     returning id into v_note_id;
    if v_note_id is null then
      raise exception using errcode='42501', message='Published author note unavailable';
    end if;
  end if;

  return pg_catalog.jsonb_build_object('note_id', v_note_id, 'status', 'published');
end
$function$;

revoke all on function public.novelight_save_my_author_note(bigint,text,text,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_save_my_author_note(bigint,text,text,bigint)
  to authenticated;

commit;
