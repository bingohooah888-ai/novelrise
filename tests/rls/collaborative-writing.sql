begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79600000-0000-0000-0000-000000000001', '{"display_name":"B22 Owner"}'::jsonb),
  ('79600000-0000-0000-0000-000000000002', '{"display_name":"B22 Editor"}'::jsonb),
  ('79600000-0000-0000-0000-000000000003', '{"display_name":"B22 Outsider"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79600000-0000-0000-0000-000000000001', 'B22 Owner'),
  ('79600000-0000-0000-0000-000000000002', 'B22 Editor'),
  ('79600000-0000-0000-0000-000000000003', 'B22 Outsider')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79600000-0000-0000-0000-000000000010',
  'B22 fixture thumbnail',
  'official/79600000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/b22-fixture.webp',
  '79600000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  796001,
  '79600000-0000-0000-0000-000000000001',
  'B22 Collaborative Work',
  'fixture draft',
  'ファンタジー',
  'draft',
  0,
  'human',
  true,
  'beta-v1',
  '79600000-0000-0000-0000-000000000010'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  7960011,
  796001,
  '79600000-0000-0000-0000-000000000001',
  1,
  'Owner Draft',
  'owner content',
  'draft',
  0
);

do $$
begin
  if has_table_privilege('anon','public.novel_collaborators','select')
     or has_table_privilege('authenticated','public.novel_collaborators','select')
     or has_table_privilege('authenticated','public.novel_collaboration_events','insert') then
    raise exception 'B22 raw collaboration tables must remain private';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000001', true);

select set_config(
  'novelight.test.b22_token',
  public.novelight_rotate_collaboration_invite(796001) ->> 'token',
  true
);

do $$
declare
  v_manage jsonb;
begin
  v_manage := public.novelight_manage_novel_collaborators(796001);
  if v_manage ->> 'invite_active' <> 'true' then
    raise exception 'B22 owner invite should be active';
  end if;
  if pg_catalog.jsonb_array_length(v_manage -> 'members') <> 0 then
    raise exception 'B22 should begin with no collaborators';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000002', true);

do $$
declare
  v_join jsonb;
begin
  v_join := public.novelight_accept_collaboration_invite(
    current_setting('novelight.test.b22_token')
  );
  if v_join ->> 'novel_id' <> '796001' then
    raise exception 'B22 invite joined wrong novel';
  end if;
end
$$;

do $$
declare
  v_access jsonb;
begin
  v_access := public.novelight_collaboration_access(796001);
  if v_access ->> 'can_edit' <> 'true'
     or v_access ->> 'is_owner' <> 'false'
     or v_access ->> 'role' <> 'editor' then
    raise exception 'B22 editor access contract mismatch';
  end if;
end
$$;

select set_config(
  'novelight.test.b22_episode',
  public.novelight_create_collaboration_draft(
    796001,
    'Collaborator Draft',
    'first collaborative content'
  )::text,
  true
);

do $$
declare
  v_episode bigint := current_setting('novelight.test.b22_episode')::bigint;
  v_owner uuid;
  v_number bigint;
  v_status text;
begin
  select e.user_id, e.episode_number, e.status
    into v_owner, v_number, v_status
    from public.episodes e where e.id=v_episode;
  if v_owner <> '79600000-0000-0000-0000-000000000001'::uuid
     or v_number <> 2 or v_status <> 'draft' then
    raise exception 'B22 collaborator draft violated owner/order/draft contract';
  end if;
end
$$;

select public.novelight_update_collaboration_episode(
  current_setting('novelight.test.b22_episode')::bigint,
  'Collaborator Draft Updated',
  'second collaborative content'
);

reset role;

do $$
declare
  v_episode bigint := current_setting('novelight.test.b22_episode')::bigint;
begin
  if not exists (
    select 1 from public.episode_revisions r
    where r.episode_id=v_episode
      and r.user_id='79600000-0000-0000-0000-000000000001'::uuid
  ) then
    raise exception 'B22 collaborative edit must preserve owner revision history';
  end if;
  if not exists (
    select 1 from public.novel_collaboration_events e
    where e.novel_id=796001
      and e.actor_user_id='79600000-0000-0000-0000-000000000002'::uuid
      and e.event_type='episode_edited'
  ) then
    raise exception 'B22 collaborative edit must record private actor audit';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000002', true);

do $$
declare
  v_count integer;
begin
  update public.episodes
     set title='RAW TAKEOVER'
   where id=7960011;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'B22 collaborator raw UPDATE unexpectedly succeeded';
  end if;

  delete from public.episodes where id=7960011;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'B22 collaborator raw DELETE unexpectedly succeeded';
  end if;
end
$$;

do $$
begin
  begin
    perform public.novelight_publish_episode_draft_atomic(
      current_setting('novelight.test.b22_episode')::bigint
    );
    raise exception 'B22 collaborator publish unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000003', true);

do $$
begin
  begin
    perform public.novelight_accept_collaboration_invite(
      current_setting('novelight.test.b22_token')
    );
    raise exception 'B22 one-time invite unexpectedly reused';
  exception
    when sqlstate '22023' then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000001', true);
select public.novelight_set_user_block(
  '79600000-0000-0000-0000-000000000002'::uuid,
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000002', true);

do $$
begin
  if public.novelight_collaboration_access(796001) ->> 'can_edit' <> 'false' then
    raise exception 'B22 block relationship must disable collaboration edit access';
  end if;
  begin
    perform public.novelight_update_collaboration_episode(
      current_setting('novelight.test.b22_episode')::bigint,
      'Blocked Edit',
      'blocked'
    );
    raise exception 'B22 blocked editor update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79600000-0000-0000-0000-000000000001', true);
select public.novelight_set_user_block(
  '79600000-0000-0000-0000-000000000002'::uuid,
  false
);
select public.novelight_remove_novel_collaborator(
  796001,
  '79600000-0000-0000-0000-000000000002'::uuid
);

do $$
declare
  v_manage jsonb;
  v_access jsonb;
begin
  v_manage := public.novelight_manage_novel_collaborators(796001);
  if pg_catalog.jsonb_array_length(v_manage -> 'members') <> 0 then
    raise exception 'B22 owner removal did not revoke membership';
  end if;

  v_access := public.novelight_collaboration_access(796001);
  if v_access ->> 'owner_user_id'
     <> '79600000-0000-0000-0000-000000000001' then
    raise exception 'B22 collaboration changed novel ownership';
  end if;
end
$$;

reset role;
rollback;
