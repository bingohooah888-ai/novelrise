\set ON_ERROR_STOP on

-- Run only on disposable replay/test databases. A transaction rolls back fixtures.
begin;

insert into auth.users (id, raw_user_meta_data)
values
 ('79300000-0000-0000-0000-000000000011', '{"display_name":"Note Delete A"}'::jsonb),
 ('79300000-0000-0000-0000-000000000012', '{"display_name":"Note Delete B"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
 ('79300000-0000-0000-0000-000000000011', 'Note Delete A'),
 ('79300000-0000-0000-0000-000000000012', 'Note Delete B')
on conflict (id) do update set display_name = excluded.display_name;

set local role authenticated;
select set_config('request.jwt.claim.sub','79300000-0000-0000-0000-000000000011',true);
select set_config(
 'novelight.test.note_delete_published',
 public.novelight_save_my_author_note(null,'削除対象・公開','公開用メモ',null) ->> 'note_id',
 true
);
select set_config(
 'novelight.test.note_delete_archived',
 public.novelight_save_my_author_note(null,'削除対象・非公開','非公開用メモ',null) ->> 'note_id',
 true
);
select public.novelight_archive_my_author_note(
 current_setting('novelight.test.note_delete_archived')::bigint
);

-- A second authenticated author must never remove the first author's notes.
select set_config('request.jwt.claim.sub','79300000-0000-0000-0000-000000000012',true);
do $$
begin
  begin
    perform public.novelight_delete_my_author_note(
      current_setting('novelight.test.note_delete_published')::bigint
    );
    raise exception 'Cross-author published deletion unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_delete_my_author_note(
      current_setting('novelight.test.note_delete_archived')::bigint
    );
    raise exception 'Cross-author archived deletion unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
begin
  begin
    perform public.novelight_delete_my_author_note(
      current_setting('novelight.test.note_delete_published')::bigint
    );
    raise exception 'Anonymous note deletion unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  begin
    perform public.novelight_delete_my_author_note(
      current_setting('novelight.test.note_delete_published')::bigint
    );
    raise exception 'Unauthenticated user with authenticated role unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub','79300000-0000-0000-0000-000000000011',true);
do $$
declare
  v_owned jsonb;
begin
  v_owned := public.novelight_manage_my_author_notes(100);
  if pg_catalog.jsonb_array_length(v_owned) <> 2 then
    raise exception 'Cross-author attempt deleted or exposed an owner note';
  end if;
end
$$;

-- Verify deletion is irreversible from both author and reader feeds.
do $$
declare
  v_result boolean;
begin
  v_result := public.novelight_delete_my_author_note(
    current_setting('novelight.test.note_delete_published')::bigint
  );
  if v_result is distinct from true then
    raise exception 'Published note deletion did not succeed';
  end if;
  v_result := public.novelight_delete_my_author_note(
    current_setting('novelight.test.note_delete_archived')::bigint
  );
  if v_result is distinct from true then
    raise exception 'Archived note deletion did not succeed';
  end if;

  if pg_catalog.jsonb_array_length(public.novelight_manage_my_author_notes(100)) <> 0
     or pg_catalog.jsonb_array_length(public.novelight_public_author_notes(
       '79300000-0000-0000-0000-000000000011',5
     )) <> 0 then
    raise exception 'Deleted author notes are still present in author or reader feed';
  end if;

  begin
    perform public.novelight_delete_my_author_note(
      current_setting('novelight.test.note_delete_published')::bigint
    );
    raise exception 'Repeated deletion should fail for unavailable note';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
