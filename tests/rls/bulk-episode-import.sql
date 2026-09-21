\set ON_ERROR_STOP on
begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('91000000-0000-0000-0000-000000000001', '{"display_name":"Bulk Owner"}'::jsonb),
  ('91000000-0000-0000-0000-000000000002', '{"display_name":"Bulk Other"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('91000000-0000-0000-0000-000000000001', 'Bulk Owner'),
  ('91000000-0000-0000-0000-000000000002', 'Bulk Other')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, is_active
)
values (
  '91000000-0000-0000-0000-000000000010',
  'Bulk import fixture thumbnail',
  'official/91000000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/bulk-import.webp',
  true
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id, created_at
)
overriding system value
values
  (
    910001, '91000000-0000-0000-0000-000000000001',
    'Bulk existing 30', 'fixture', '現代ファンタジー', 'draft', 0, 'human',
    true, 'beta-2026-08-23', '91000000-0000-0000-0000-000000000010',
    '2026-09-01T00:00:00Z'
  ),
  (
    910002, '91000000-0000-0000-0000-000000000001',
    'Bulk fifty', 'fixture', '現代ファンタジー', 'draft', 0, 'human',
    true, 'beta-2026-08-23', '91000000-0000-0000-0000-000000000010',
    '2026-09-02T00:00:00Z'
  ),
  (
    910003, '91000000-0000-0000-0000-000000000001',
    'Bulk hundred', 'fixture', '現代ファンタジー', 'draft', 0, 'human',
    true, 'beta-2026-08-23', '91000000-0000-0000-0000-000000000010',
    '2026-09-03T00:00:00Z'
  ),
  (
    910004, '91000000-0000-0000-0000-000000000001',
    'Bulk atomic fail', 'fixture', '現代ファンタジー', 'draft', 0, 'human',
    true, 'beta-2026-08-23', '91000000-0000-0000-0000-000000000010',
    '2026-09-04T00:00:00Z'
  );

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
)
select
  910001,
  '91000000-0000-0000-0000-000000000001',
  g,
  'Existing ' || g,
  'existing body ' || g,
  'draft',
  0
from generate_series(1, 30) g;

set local role anon;
do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      910001,
      '[{"title":"x","content":"y"}]'::jsonb
    );
    raise exception 'Anon unexpectedly executed bulk import';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_record_bulk_import_event(
      'bulk_import_opened',
      null,
      0
    );
    raise exception 'Anon unexpectedly executed bulk import analytics';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  v_count integer;
begin
  select public.novelight_bulk_import_episode_drafts(
    910001,
    (
      select jsonb_agg(
        jsonb_build_object(
          'title', 'Imported ' || g,
          'content', case when g = 1
            then 'line 1' || chr(10) || chr(10) || 'line 3'
            else 'body ' || g
          end
        )
        order by g
      )
      from generate_series(1, 10) g
    )
  ) into v_count;

  if v_count <> 10 then
    raise exception 'Expected 10 imported episodes, got %', v_count;
  end if;
end
$$;

do $$
begin
  if (
    select count(*)
    from public.episodes
    where novel_id = 910001
      and episode_number between 31 and 40
      and status = 'draft'
  ) <> 10 then
    raise exception '10 episode import did not create draft episodes 31-40';
  end if;

  if (
    select content
    from public.episodes
    where novel_id = 910001
      and episode_number = 31
  ) <> 'line 1' || chr(10) || chr(10) || 'line 3' then
    raise exception 'Bulk import did not preserve blank lines';
  end if;

  if (
    select created_at
    from public.novels
    where id = 910001
  ) <> '2026-09-01T00:00:00Z'::timestamptz then
    raise exception 'Bulk import changed the novel created_at value';
  end if;
end
$$;

select public.novelight_bulk_import_episode_drafts(
  910002,
  (
    select jsonb_agg(
      jsonb_build_object('title', 'Fifty ' || g, 'content', 'body ' || g)
      order by g
    )
    from generate_series(1, 50) g
  )
);

select public.novelight_bulk_import_episode_drafts(
  910003,
  (
    select jsonb_agg(
      jsonb_build_object(
        'title', 'Hundred ' || g,
        'content', case when g = 100 then '<script>alert(1)</script>' else 'body ' || g end
      )
      order by g
    )
    from generate_series(1, 100) g
  )
);

do $$
begin
  if (select count(*) from public.episodes where novel_id = 910002) <> 50 then
    raise exception '50 episode import count is incorrect';
  end if;
  if (select count(*) from public.episodes where novel_id = 910003) <> 100 then
    raise exception '100 episode import count is incorrect';
  end if;
  if exists (
    select 1 from public.episodes
    where novel_id in (910002, 910003)
      and status <> 'draft'
  ) then
    raise exception 'Bulk import created a non-draft episode';
  end if;
  if (
    select content from public.episodes
    where novel_id = 910003 and episode_number = 100
  ) <> '<script>alert(1)</script>' then
    raise exception 'Literal script text was not preserved';
  end if;
end
$$;

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      910001,
      '[{"title":"tampered","content":"body","episode_number":999}]'::jsonb
    );
    raise exception 'Tampered episode_number unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
end
$$;

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      910001,
      (
        select jsonb_agg(
          jsonb_build_object('title', 'Too many ' || g, 'content', 'body')
        )
        from generate_series(1, 101) g
      )
    );
    raise exception '101 episode import unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
end
$$;

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      910001,
      '[{"title":"empty","content":""}]'::jsonb
    );
    raise exception 'Empty content unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
end
$$;

do $$
begin
  begin
    perform * from public.bulk_import_events;
    raise exception 'Authenticated user unexpectedly read raw analytics';
  exception when insufficient_privilege then null;
  end;
end
$$;

select public.novelight_record_bulk_import_event('bulk_import_opened', null, 0);
select public.novelight_record_bulk_import_event('bulk_import_started', 910001, 0);
select public.novelight_record_bulk_import_event('bulk_import_parsed', 910001, 10);
select public.novelight_record_bulk_import_event('bulk_import_parse_failed', 910001, 0);
select public.novelight_record_bulk_import_event('bulk_import_confirmed', 910001, 10);
select public.novelight_record_bulk_import_event('bulk_import_completed', 910001, 10);

do $$
begin
  perform set_config(
    'request.jwt.claim.sub',
    '91000000-0000-0000-0000-000000000002',
    true
  );
  begin
    perform public.novelight_bulk_import_episode_drafts(
      910001,
      '[{"title":"unauthorized","content":"body"}]'::jsonb
    );
    raise exception 'Other user unexpectedly imported into owner novel';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (
    select count(*)
    from public.bulk_import_events
    where user_id = '91000000-0000-0000-0000-000000000001'
  ) <> 6 then
    raise exception 'Expected six bulk import analytics events';
  end if;
end
$$;

create function public._novelight_bulk_import_test_fail()
returns trigger
language plpgsql
as $$
begin
  if new.title = 'FORCE_FAIL' then
    raise exception 'forced bulk import failure';
  end if;
  return new;
end
$$;

create trigger novelight_bulk_import_test_fail
before insert on public.episodes
for each row execute function public._novelight_bulk_import_test_fail();

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      910004,
      '[
        {"title":"one","content":"body one"},
        {"title":"two","content":"body two"},
        {"title":"FORCE_FAIL","content":"body three"},
        {"title":"four","content":"body four"}
      ]'::jsonb
    );
    raise exception 'Forced bulk import failure did not occur';
  exception when others then
    if sqlerrm <> 'forced bulk import failure' then
      raise;
    end if;
  end;

  if exists (select 1 from public.episodes where novel_id = 910004) then
    raise exception 'Failed bulk import left partially inserted episodes';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

drop trigger novelight_bulk_import_test_fail on public.episodes;
drop function public._novelight_bulk_import_test_fail();

rollback;
