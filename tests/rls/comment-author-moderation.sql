\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79800000-0000-0000-0000-000000000001', '{"display_name":"B14 Author"}'::jsonb),
  ('79800000-0000-0000-0000-000000000002', '{"display_name":"B14 Reader One"}'::jsonb),
  ('79800000-0000-0000-0000-000000000003', '{"display_name":"B14 Reader Two"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79800000-0000-0000-0000-000000000001', 'B14 Author'),
  ('79800000-0000-0000-0000-000000000002', 'B14 Reader One'),
  ('79800000-0000-0000-0000-000000000003', 'B14 Reader Two')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79800000-0000-0000-0000-000000000004',
  'B14 fixture thumbnail',
  'official/79800000-0000-0000-0000-000000000004.webp',
  'https://example.invalid/b14-fixture.webp',
  '79800000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  798001,
  '79800000-0000-0000-0000-000000000001',
  'B14 Moderation Work',
  'B #14 comment moderation fixture',
  'ファンタジー',
  'published',
  0,
  'human',
  true,
  'beta-v1',
  '79800000-0000-0000-0000-000000000004'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000002',
  true
);
select set_config(
  'novelight.test.b14_comment_one',
  public.post_novel_comment('798001', 'reader one comment') ->> 'id',
  true
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000003',
  true
);
select set_config(
  'novelight.test.b14_comment_two',
  public.post_novel_comment('798001', 'reader two comment') ->> 'id',
  true
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'novelight.test.b14_self_comment',
  public.post_novel_comment('798001', 'author self comment') ->> 'id',
  true
);

do $$
begin
  begin
    perform public.novelight_set_comment_pin(
      current_setting('novelight.test.b14_self_comment')::uuid,
      true
    );
    raise exception 'Author unexpectedly pinned their own comment through moderation RPC';
  exception
    when invalid_parameter_value then
      if position('Only reader comments can be moderated' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.novelight_set_comment_hidden(
      current_setting('novelight.test.b14_self_comment')::uuid,
      true,
      'other'
    );
    raise exception 'Author unexpectedly hid their own comment through moderation RPC';
  exception
    when invalid_parameter_value then
      if position('Only reader comments can be moderated' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;

select public.novelight_set_comment_pin(
  current_setting('novelight.test.b14_comment_one')::uuid,
  true
);
select public.novelight_set_comment_author_reply(
  current_setting('novelight.test.b14_comment_one')::uuid,
  '作者返信です'
);
select public.novelight_set_comment_pin(
  current_setting('novelight.test.b14_comment_two')::uuid,
  true
);
select public.novelight_set_comment_hidden(
  current_setting('novelight.test.b14_comment_two')::uuid,
  true,
  'spoiler'
);

do $$
declare
  v_feed jsonb;
  v_hidden jsonb;
begin
  v_feed := public.novelight_comment_feed('798001', 50);
  select value
    into v_hidden
    from pg_catalog.jsonb_array_elements(v_feed)
   where value ->> 'id' = current_setting('novelight.test.b14_comment_two');

  if v_hidden is null
     or (v_hidden ->> 'is_hidden')::boolean <> true
     or v_hidden ->> 'hidden_reason' <> 'spoiler'
     or (v_hidden ->> 'can_moderate')::boolean <> true then
    raise exception 'Author feed did not retain hidden moderation state and reason';
  end if;
end
$$;

select public.novelight_set_comment_hidden(
  current_setting('novelight.test.b14_comment_two')::uuid,
  false,
  null
);

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (
    select count(*)
      from public.novel_comments
     where novel_id = 798001
  ) <> 3 then
    raise exception 'Moderation must not create or delete comment rows';
  end if;

  if exists (
    select 1
      from public.novel_comments
     where novel_id = 798001
       and pinned_at is not null
  ) then
    raise exception 'Hiding the currently pinned comment must clear the presentation pin';
  end if;

  if (
    select count(*)
      from public.novel_comment_moderation_events
     where novel_id = 798001
  ) <> 7 then
    raise exception 'Expected seven audited moderation transitions';
  end if;

  if (
    select count(*)
      from public.scout_event_ledger
     where novel_id_snapshot = '798001'
       and event_type = 'comment_posted'
  ) <> 3 then
    raise exception 'Moderation changed raw comment-posted SCOUT history';
  end if;

  if exists (
    select 1
      from public.scout_event_ledger
     where novel_id_snapshot = '798001'
       and event_type in ('comment_pinned','comment_hidden','comment_author_reply')
  ) then
    raise exception 'Presentation moderation must not create SCOUT events';
  end if;

  if (
    select count(*)
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where e.novel_id_snapshot = '798001'
       and x.xp_kind = 'comment'
  ) <> 2 then
    raise exception 'Moderation changed comment SCOUT XP';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.novel_comment_moderation_events',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'public.novel_comment_moderation_events',
       'INSERT'
     )
     or has_table_privilege(
       'anon',
       'public.novel_comment_moderation_events',
       'SELECT'
     )
     or has_table_privilege(
       'service_role',
       'public.novel_comment_moderation_events',
       'SELECT'
     ) then
    raise exception 'Raw B #14 moderation audit table is client-accessible';
  end if;
end
$$;

set local role anon;
do $$
declare
  v_feed jsonb;
begin
  v_feed := public.novelight_comment_feed('798001', 50);

  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_feed) e
     where e ->> 'id' = current_setting('novelight.test.b14_comment_one')
       and e ->> 'author_reply_body' = '作者返信です'
  ) then
    raise exception 'Public feed did not expose the visible author reply';
  end if;

  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_feed) e
     where e ->> 'id' = current_setting('novelight.test.b14_comment_two')
       and (e ->> 'is_hidden')::boolean = false
  ) then
    raise exception 'Unhidden comment did not return to the public feed';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000003',
  true
);
do $$
begin
  begin
    perform public.novelight_set_comment_pin(
      current_setting('novelight.test.b14_comment_one')::uuid,
      true
    );
    raise exception 'Non-author unexpectedly moderated another author work';
  exception
    when insufficient_privilege then
      if position('Author moderation unavailable' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000001',
  true
);
select public.novelight_set_user_block(
  '79800000-0000-0000-0000-000000000002',
  true
);

do $$
begin
  begin
    perform public.novelight_set_comment_author_reply(
      current_setting('novelight.test.b14_comment_one')::uuid,
      'blocked reply must fail'
    );
    raise exception 'Author reply unexpectedly crossed an active block boundary';
  exception
    when insufficient_privilege then
      if position('DIRECT_INTERACTION_UNAVAILABLE' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000002',
  true
);
do $$
declare
  v_feed jsonb;
  v_own jsonb;
begin
  v_feed := public.novelight_comment_feed('798001', 50);
  select value
    into v_own
    from pg_catalog.jsonb_array_elements(v_feed)
   where value ->> 'id' = current_setting('novelight.test.b14_comment_one');

  if v_own is null then
    raise exception 'Comment owner lost access to own visible comment';
  end if;

  if v_own ->> 'author_reply_body' is not null then
    raise exception 'Author reply remained visible across an active block boundary';
  end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

rollback;
