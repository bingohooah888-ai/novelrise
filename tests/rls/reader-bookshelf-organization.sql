\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79500000-0000-0000-0000-000000000001', '{"display_name":"Shelf Author"}'::jsonb),
  ('79500000-0000-0000-0000-000000000002', '{"display_name":"Shelf Reader A"}'::jsonb),
  ('79500000-0000-0000-0000-000000000003', '{"display_name":"Shelf Reader B"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79500000-0000-0000-0000-000000000001', 'Shelf Author'),
  ('79500000-0000-0000-0000-000000000002', 'Shelf Reader A'),
  ('79500000-0000-0000-0000-000000000003', 'Shelf Reader B')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
) values (
  '79500000-0000-0000-0000-000000000004',
  'Shelf fixture thumbnail',
  'official/79500000-0000-0000-0000-000000000004.webp',
  'https://example.invalid/shelf-fixture.webp',
  '79500000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    795001,
    '79500000-0000-0000-0000-000000000001',
    'Published Shelf Work',
    'Visible reader shelf fixture',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '79500000-0000-0000-0000-000000000004'
  ),
  (
    795002,
    '79500000-0000-0000-0000-000000000001',
    'Draft Shelf Work',
    'Must not be newly organized by readers',
    'ファンタジー',
    'draft',
    0,
    'human',
    true,
    'beta-v1',
    '79500000-0000-0000-0000-000000000004'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79500000-0000-0000-0000-000000000002',
  true
);

insert into public.reader_bookshelf_entries (
  user_id, novel_id, reading_state, list_name, memo
) values (
  '79500000-0000-0000-0000-000000000002',
  795001,
  'want_to_read',
  '  休日に読む  ',
  'reader A private memo'
);

do $$
declare
  v_row public.reader_bookshelf_entries%rowtype;
begin
  select * into strict v_row
  from public.reader_bookshelf_entries
  where novel_id = 795001;

  if v_row.list_name <> '休日に読む'
     or v_row.memo <> 'reader A private memo'
     or v_row.reading_state <> 'want_to_read' then
    raise exception 'Reader A bookshelf row was not normalized as expected';
  end if;
end
$$;

do $$
begin
  begin
    insert into public.reader_bookshelf_entries (
      user_id, novel_id, reading_state
    ) values (
      '79500000-0000-0000-0000-000000000002',
      795002,
      'reading'
    );
    raise exception 'Reader unexpectedly organized a draft work';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79500000-0000-0000-0000-000000000003',
  true
);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.reader_bookshelf_entries
  where user_id = '79500000-0000-0000-0000-000000000002';

  if v_count <> 0 then
    raise exception 'Reader B can see Reader A private bookshelf row';
  end if;

  update public.reader_bookshelf_entries
     set memo = 'tampered'
   where user_id = '79500000-0000-0000-0000-000000000002'
     and novel_id = 795001;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'Reader B updated Reader A private bookshelf row';
  end if;

  delete from public.reader_bookshelf_entries
   where user_id = '79500000-0000-0000-0000-000000000002'
     and novel_id = 795001;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'Reader B deleted Reader A private bookshelf row';
  end if;
end
$$;

do $$
begin
  begin
    insert into public.reader_bookshelf_entries (
      user_id, novel_id, reading_state
    ) values (
      '79500000-0000-0000-0000-000000000002',
      795001,
      'reading'
    );
    raise exception 'Reader B inserted a row owned by Reader A';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

insert into public.reader_bookshelf_entries (
  user_id, novel_id, reading_state, list_name, memo
) values (
  '79500000-0000-0000-0000-000000000003',
  795001,
  'reading',
  '通勤',
  'reader B private memo'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (select count(*) from public.favorites where novel_id = 795001) <> 0 then
    raise exception 'Private bookshelf organization changed favorite evidence';
  end if;

  if (select count(*) from public.reader_bookshelf_entries where novel_id = 795001) <> 2 then
    raise exception 'Expected two independent private bookshelf rows';
  end if;
end
$$;

rollback;
