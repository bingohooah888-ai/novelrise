\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79600000-0000-0000-0000-000000000001', '{"display_name":"Interaction Author"}'::jsonb),
  ('79600000-0000-0000-0000-000000000002', '{"display_name":"Interaction Reader"}'::jsonb),
  ('79600000-0000-0000-0000-000000000003', '{"display_name":"Other Author"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79600000-0000-0000-0000-000000000001', 'Interaction Author'),
  ('79600000-0000-0000-0000-000000000002', 'Interaction Reader'),
  ('79600000-0000-0000-0000-000000000003', 'Other Author')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79600000-0000-0000-0000-000000000004',
  'Interaction fixture thumbnail',
  'official/79600000-0000-0000-0000-000000000004.webp',
  'https://example.invalid/interaction-fixture.webp',
  '79600000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    796001,
    '79600000-0000-0000-0000-000000000001',
    'Interaction Work A',
    'B #11 fixture A',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '79600000-0000-0000-0000-000000000004'
  ),
  (
    796002,
    '79600000-0000-0000-0000-000000000001',
    'Interaction Work B',
    'B #11 fixture B',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '79600000-0000-0000-0000-000000000004'
  ),
  (
    796003,
    '79600000-0000-0000-0000-000000000003',
    'Other Author Work',
    'B #11 ownership fixture',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '79600000-0000-0000-0000-000000000004'
  );

do $$
begin
  if (
    select count(*)
      from public.novel_typo_report_settings
     where novel_id in (796001, 796002, 796003)
       and enabled = false
       and inherits_author_default = true
  ) <> 3 then
    raise exception 'New novels did not inherit the default typo reception state';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79600000-0000-0000-0000-000000000001',
  true
);

select public.novelight_set_author_interaction_defaults(false, true);

do $$
declare
  v_a jsonb;
begin
  v_a := public.novelight_author_novel_interaction_settings(796001);
  if (v_a ->> 'comments_effective')::boolean <> false
     or (v_a ->> 'typo_reports_effective')::boolean <> true
     or v_a -> 'comments_override' <> 'null'::jsonb
     or v_a -> 'typo_reports_override' <> 'null'::jsonb then
    raise exception 'Author defaults were not inherited by work A';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (
    select count(*)
      from public.novel_typo_report_settings
     where novel_id in (796001, 796002)
       and enabled = true
       and inherits_author_default = true
  ) <> 2 then
    raise exception 'Inherited typo settings did not follow the author default';
  end if;
end
$$;

set local role anon;
do $$
declare
  v_state jsonb;
begin
  v_state := public.novelight_novel_comment_reception_state(796001);
  if (v_state ->> 'comments_enabled')::boolean <> false then
    raise exception 'Public comment reception state did not reflect author default';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79600000-0000-0000-0000-000000000002',
  true
);

do $$
begin
  begin
    perform public.post_novel_comment('796001', 'must be blocked');
    raise exception 'Comment unexpectedly succeeded while reception was disabled';
  exception
    when check_violation then
      if position('COMMENTS_DISABLED' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if exists (
    select 1 from public.novel_comments
     where novel_id = 796001
       and user_id = '79600000-0000-0000-0000-000000000002'
  ) then
    raise exception 'Blocked comment created stored comment evidence';
  end if;
  if exists (
    select 1 from public.scout_event_ledger
     where novel_id_snapshot = '796001'
       and user_id = '79600000-0000-0000-0000-000000000002'
       and event_type = 'comment_posted'
  ) then
    raise exception 'Blocked comment created SCOUT event evidence';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79600000-0000-0000-0000-000000000001',
  true
);

select public.novelight_set_novel_interaction_settings(796001, true, false);

do $$
declare
  v_a jsonb;
begin
  v_a := public.novelight_author_novel_interaction_settings(796001);
  if (v_a ->> 'comments_effective')::boolean <> true
     or (v_a ->> 'comments_override')::boolean <> true
     or (v_a ->> 'typo_reports_effective')::boolean <> false
     or (v_a ->> 'typo_reports_override')::boolean <> false then
    raise exception 'Per-work override was not applied';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79600000-0000-0000-0000-000000000002',
  true
);
select public.post_novel_comment('796001', 'allowed by work override');
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (
    select count(*)
      from public.novel_comments
     where novel_id = 796001
       and user_id = '79600000-0000-0000-0000-000000000002'
       and deleted_at is null
  ) <> 1 then
    raise exception 'Enabled work override did not allow comment';
  end if;
  if (
    select count(*)
      from public.scout_event_ledger
     where novel_id_snapshot = '796001'
       and user_id = '79600000-0000-0000-0000-000000000002'
       and event_type = 'comment_posted'
  ) <> 1 then
    raise exception 'Accepted comment did not create exactly one SCOUT event';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79600000-0000-0000-0000-000000000001',
  true
);

select public.novelight_set_author_interaction_defaults(true, false);
select public.novelight_set_novel_interaction_settings(796001, null, null);

do $$
declare
  v_a jsonb;
begin
  v_a := public.novelight_author_novel_interaction_settings(796001);
  if (v_a ->> 'comments_effective')::boolean <> true
     or v_a -> 'comments_override' <> 'null'::jsonb
     or (v_a ->> 'typo_reports_effective')::boolean <> false
     or v_a -> 'typo_reports_override' <> 'null'::jsonb then
    raise exception 'Reset to author defaults failed';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if not exists (
    select 1
      from public.novel_typo_report_settings
     where novel_id = 796001
       and enabled = false
       and inherits_author_default = true
  ) then
    raise exception 'Typo reception did not return to inherited state';
  end if;

  if has_table_privilege('authenticated', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_comment_reception_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_comment_reception_settings', 'INSERT')
     or has_table_privilege('anon', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('anon', 'public.novel_comment_reception_settings', 'SELECT') then
    raise exception 'Raw B #11 preference tables are client-accessible';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79600000-0000-0000-0000-000000000003',
  true
);

do $$
begin
  begin
    perform public.novelight_set_novel_interaction_settings(796001, false, false);
    raise exception 'Other author unexpectedly changed B #11 settings';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

rollback;
