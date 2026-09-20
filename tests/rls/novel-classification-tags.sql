begin;

insert into auth.users(id, raw_user_meta_data)
values
  ('93000000-0000-0000-0000-000000000001', '{"display_name":"Tag Author"}'::jsonb),
  ('93000000-0000-0000-0000-000000000002', '{"display_name":"Other Author"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, display_name, plan)
values
  ('93000000-0000-0000-0000-000000000001', 'Tag Author', 'standard'),
  ('93000000-0000-0000-0000-000000000002', 'Other Author', 'standard')
on conflict (id) do update set display_name=excluded.display_name, plan=excluded.plan;

insert into public.novels(
  id, user_id, title, description, genre, status, ai_usage,
  content_policy_ack, content_policy_version
)
overriding system value
values
  (930001,'93000000-0000-0000-0000-000000000001','Yuri Slow Life','magic cooking','異世界ファンタジー','published','human',true,'beta-test'),
  (930002,'93000000-0000-0000-0000-000000000001','Draft Yuri','draft','異世界ファンタジー','draft','human',true,'beta-test'),
  (930003,'93000000-0000-0000-0000-000000000002','No Tags Mystery','fixture','ミステリー','published','human',true,'beta-test');

set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',true);

select public.novelight_set_novel_tags(
  930001,
  array['yuri_gl','webnovel_023','fantasy_002']::text[],
  array['飯テロ','猫が重要']::text[]
);
select public.novelight_set_novel_tags(
  930002,
  array['yuri_gl']::text[],
  '{}'::text[]
);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.novel_official_tags where novel_id=930001;
  if v_count <> 3 then raise exception 'official tag persistence failed'; end if;
  select count(*) into v_count from public.novel_custom_tags where novel_id=930001;
  if v_count <> 2 then raise exception 'custom tag persistence failed'; end if;

  begin
    perform public.novelight_set_novel_tags(
      930001,
      array[
        'yuri_gl','bl','relationship_003','relationship_004','relationship_005',
        'relationship_006','relationship_007','relationship_008','relationship_009',
        'relationship_010','relationship_011'
      ]::text[],
      '{}'::text[]
    );
    raise exception 'official tag limit unexpectedly bypassed';
  exception when check_violation then null;
  end;

  begin
    perform public.novelight_set_novel_tags(
      930001,
      array['yuri_gl','yuri_gl']::text[],
      '{}'::text[]
    );
    raise exception 'duplicate official tags unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.novelight_set_novel_tags(
      930001,
      array['yuri_gl']::text[],
      array['ガールズラブ']::text[]
    );
    raise exception 'official alias unexpectedly accepted as custom tag';
  exception when check_violation then null;
  end;

  begin
    perform public.novelight_set_novel_tags(
      930001,
      array['yuri_gl']::text[],
      array['<script>alert(1)</script>']::text[]
    );
    raise exception 'unsafe custom tag unexpectedly accepted';
  exception when check_violation then null;
  end;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000002',true);

do $$
begin
  begin
    perform public.novelight_set_novel_tags(
      930001,
      array['bl']::text[],
      '{}'::text[]
    );
    raise exception 'cross-author tag mutation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role anon;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.novel_official_tags
  where novel_id=930001 and tag_id='yuri_gl';
  if v_count <> 1 then raise exception 'published official tag not publicly readable'; end if;

  select count(*) into v_count
  from public.novel_official_tags
  where novel_id=930002;
  if v_count <> 0 then raise exception 'draft official tags leaked through RLS'; end if;

  begin
    insert into public.official_tags(id,display_name,category_id,sort_order)
    values('evil_tag','evil','relationship',999);
    raise exception 'anon unexpectedly mutated tag master';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.novel_internal_search_attributes;
    raise exception 'internal search attributes unexpectedly readable';
  exception when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.novelight_neutral_search_v2(
    null,'異世界ファンタジー',array['yuri_gl','webnovel_023']::text[],'new',24,0
  );
  if v_count <> 1 then
    raise exception 'genre + AND official-tag search did not return exactly one published work';
  end if;

  select count(*) into v_count
  from public.novelight_neutral_search_v2(
    '百合',null,'{}'::text[],'new',24,0
  )
  where novel_id='930001';
  if v_count <> 1 then
    raise exception 'official tag alias keyword search failed';
  end if;

  select count(*) into v_count
  from public.novelight_neutral_search_v2(
    '飯テロ',null,'{}'::text[],'new',24,0
  )
  where novel_id='930001';
  if v_count <> 1 then
    raise exception 'custom tag keyword search failed';
  end if;

  select count(*) into v_count
  from public.novelight_neutral_search_v2(
    null,'ミステリー','{}'::text[],'new',24,0
  )
  where novel_id='930003';
  if v_count <> 1 then
    raise exception 'tagless existing-work compatibility failed';
  end if;

  select count(*) into v_count
  from public.novelight_neutral_search_v2(
    null,null,array['yuri_gl']::text[],'new',24,0
  )
  where novel_id='930002';
  if v_count <> 0 then
    raise exception 'draft work leaked through tag search';
  end if;
end
$$;

reset role;
rollback;
