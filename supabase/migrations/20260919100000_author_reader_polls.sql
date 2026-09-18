-- NOVELIGHT competitor audit B-C item #20: author-created reader polls.
-- Poll engagement is isolated from Rank, LIGHT SEED, SCOUT, PV, favorites, discovery, exposure, analytics, and recommendations.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919100000'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.user_blocks') is null then
    raise exception '#20 reader polls require profiles, novels, and user_blocks';
  end if;
  if to_regclass('public.novel_polls') is not null
     or to_regclass('public.novel_poll_options') is not null
     or to_regclass('public.novel_poll_votes') is not null
     or to_regprocedure('public.novelight_public_novel_poll(bigint)') is not null then
    raise exception '#20 reader poll runtime already exists';
  end if;
end
$$;

create table public.novel_polls (
  id bigint generated always as identity primary key,
  novel_id bigint not null references public.novels(id) on delete cascade,
  question text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint novel_polls_question_valid
    check (char_length(btrim(question)) between 1 and 200),
  constraint novel_polls_status_valid
    check (status in ('active', 'closed')),
  constraint novel_polls_close_state_valid
    check (
      (status = 'active' and closed_at is null)
      or (status = 'closed' and closed_at is not null)
    )
);

create unique index novel_polls_one_active_per_novel_idx
  on public.novel_polls (novel_id)
  where status = 'active';
create index novel_polls_management_idx
  on public.novel_polls (novel_id, created_at desc, id desc);

create table public.novel_poll_options (
  id bigint generated always as identity primary key,
  poll_id bigint not null references public.novel_polls(id) on delete cascade,
  position smallint not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint novel_poll_options_position_valid
    check (position between 1 and 6),
  constraint novel_poll_options_label_valid
    check (char_length(btrim(label)) between 1 and 80),
  constraint novel_poll_options_poll_position_unique
    unique (poll_id, position),
  constraint novel_poll_options_poll_id_id_unique
    unique (poll_id, id)
);

create unique index novel_poll_options_label_unique_idx
  on public.novel_poll_options (poll_id, lower(btrim(label)));

create table public.novel_poll_votes (
  poll_id bigint not null references public.novel_polls(id) on delete cascade,
  option_id bigint not null,
  voter_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter_user_id),
  constraint novel_poll_votes_option_belongs_to_poll
    foreign key (poll_id, option_id)
    references public.novel_poll_options(poll_id, id)
    on delete cascade
);

create index novel_poll_votes_option_count_idx
  on public.novel_poll_votes (poll_id, option_id);

alter table public.novel_polls enable row level security;
alter table public.novel_poll_options enable row level security;
alter table public.novel_poll_votes enable row level security;

revoke all on table public.novel_polls from public, anon, authenticated, service_role;
revoke all on table public.novel_poll_options from public, anon, authenticated, service_role;
revoke all on table public.novel_poll_votes from public, anon, authenticated, service_role;
revoke all on sequence public.novel_polls_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.novel_poll_options_id_seq from public, anon, authenticated, service_role;

create or replace function public.novelight_public_novel_poll(p_novel_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll record;
  v_viewer_option_id bigint;
  v_show_results boolean := false;
  v_vote_reason text;
  v_options jsonb := '[]'::jsonb;
  v_total_votes bigint;
begin
  select
    poll.id,
    poll.novel_id,
    poll.question,
    poll.status,
    poll.created_at,
    poll.closed_at,
    novel.user_id as owner_user_id
  into v_poll
  from public.novel_polls poll
  join public.novels novel on novel.id = poll.novel_id
  where poll.novel_id = p_novel_id
    and novel.status = 'published'
  order by
    case when poll.status = 'active' then 0 else 1 end,
    poll.created_at desc,
    poll.id desc
  limit 1;

  if not found then
    return null;
  end if;

  if v_uid is not null then
    select vote.option_id
    into v_viewer_option_id
    from public.novel_poll_votes vote
    where vote.poll_id = v_poll.id
      and vote.voter_user_id = v_uid;
  end if;

  v_show_results := v_poll.status = 'closed' or v_viewer_option_id is not null;

  if v_poll.status = 'closed' then
    v_vote_reason := 'closed';
  elsif v_uid is null then
    v_vote_reason := 'login_required';
  elsif v_uid = v_poll.owner_user_id then
    v_vote_reason := 'own_novel';
  elsif exists (
    select 1
    from public.user_blocks block
    where (block.blocker_user_id = v_poll.owner_user_id and block.blocked_user_id = v_uid)
       or (block.blocker_user_id = v_uid and block.blocked_user_id = v_poll.owner_user_id)
  ) then
    v_vote_reason := 'blocked';
  elsif v_viewer_option_id is not null then
    v_vote_reason := 'already_voted';
  else
    v_vote_reason := 'eligible';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', option.id,
        'label', option.label,
        'position', option.position,
        'vote_count', case
          when v_show_results then (
            select count(*)
            from public.novel_poll_votes vote
            where vote.poll_id = v_poll.id
              and vote.option_id = option.id
          )
          else null
        end
      )
      order by option.position
    ),
    '[]'::jsonb
  )
  into v_options
  from public.novel_poll_options option
  where option.poll_id = v_poll.id;

  if v_show_results then
    select count(*)
    into v_total_votes
    from public.novel_poll_votes vote
    where vote.poll_id = v_poll.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'poll_id', v_poll.id,
    'novel_id', v_poll.novel_id,
    'question', v_poll.question,
    'status', v_poll.status,
    'created_at', v_poll.created_at,
    'closed_at', v_poll.closed_at,
    'options', v_options,
    'total_votes', v_total_votes,
    'viewer_option_id', v_viewer_option_id,
    'can_vote', v_vote_reason = 'eligible',
    'vote_reason', v_vote_reason
  );
end
$$;

create or replace function public.novelight_manage_my_novel_polls(
  p_novel_id bigint,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if not exists (
    select 1
    from public.novels novel
    where novel.id = p_novel_id
      and novel.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Novel unavailable';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'poll_id', poll.id,
        'question', poll.question,
        'status', poll.status,
        'created_at', poll.created_at,
        'closed_at', poll.closed_at,
        'total_votes', (
          select count(*)
          from public.novel_poll_votes vote
          where vote.poll_id = poll.id
        ),
        'options', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', option.id,
              'label', option.label,
              'position', option.position,
              'vote_count', (
                select count(*)
                from public.novel_poll_votes vote
                where vote.poll_id = poll.id
                  and vote.option_id = option.id
              )
            )
            order by option.position
          )
          from public.novel_poll_options option
          where option.poll_id = poll.id
        ), '[]'::jsonb)
      )
      order by poll.created_at desc, poll.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select poll.*
    from public.novel_polls poll
    where poll.novel_id = p_novel_id
    order by poll.created_at desc, poll.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  ) poll;

  return v_result;
end
$$;

create or replace function public.novelight_create_my_novel_poll(
  p_novel_id bigint,
  p_question text,
  p_options text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_question text := pg_catalog.btrim(coalesce(p_question, ''));
  v_option_count integer := coalesce(pg_catalog.array_length(p_options, 1), 0);
  v_poll_id bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if not exists (
    select 1
    from public.novels novel
    where novel.id = p_novel_id
      and novel.user_id = v_uid
      and novel.status = 'published'
  ) then
    raise exception using errcode='42501', message='Polls require your currently published novel';
  end if;
  if pg_catalog.char_length(v_question) not between 1 and 200 then
    raise exception using errcode='22023', message='Question must be 1 to 200 characters after trimming';
  end if;
  if v_option_count not between 2 and 6 then
    raise exception using errcode='22023', message='Polls require 2 to 6 options';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_options) as item(option_label)
    where pg_catalog.char_length(pg_catalog.btrim(coalesce(item.option_label, ''))) not between 1 and 80
  ) then
    raise exception using errcode='22023', message='Each option must be 1 to 80 characters after trimming';
  end if;
  if (
    select count(distinct pg_catalog.lower(pg_catalog.btrim(item.option_label)))
    from pg_catalog.unnest(p_options) as item(option_label)
  ) <> v_option_count then
    raise exception using errcode='22023', message='Poll options must be unique';
  end if;
  if exists (
    select 1
    from public.novel_polls poll
    where poll.novel_id = p_novel_id
      and poll.status = 'active'
  ) then
    raise exception using errcode='22023', message='Close the current poll before creating another';
  end if;
  if (
    select count(*)
    from public.novel_polls poll
    where poll.novel_id = p_novel_id
  ) >= 50 then
    raise exception using errcode='22023', message='At most 50 polls are retained per novel during beta';
  end if;

  begin
    insert into public.novel_polls (novel_id, question, status)
    values (p_novel_id, v_question, 'active')
    returning id into v_poll_id;
  exception
    when unique_violation then
      raise exception using errcode='22023', message='Close the current poll before creating another';
  end;

  insert into public.novel_poll_options (poll_id, position, label)
  select
    v_poll_id,
    input.position::smallint,
    pg_catalog.btrim(input.option_label)
  from pg_catalog.unnest(p_options) with ordinality as input(option_label, position);

  return pg_catalog.jsonb_build_object('poll_id', v_poll_id, 'status', 'active');
end
$$;

create or replace function public.novelight_close_my_novel_poll(p_poll_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll_id bigint;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  update public.novel_polls poll
  set status = 'closed',
      closed_at = pg_catalog.now()
  where poll.id = p_poll_id
    and poll.status = 'active'
    and exists (
      select 1
      from public.novels novel
      where novel.id = poll.novel_id
        and novel.user_id = v_uid
    )
  returning poll.id into v_poll_id;

  if v_poll_id is null then
    raise exception using errcode='42501', message='Active poll unavailable';
  end if;

  return pg_catalog.jsonb_build_object('poll_id', v_poll_id, 'status', 'closed');
end
$$;

create or replace function public.novelight_vote_novel_poll(
  p_poll_id bigint,
  p_option_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll record;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select poll.id, poll.novel_id, poll.status, novel.user_id as owner_user_id
  into v_poll
  from public.novel_polls poll
  join public.novels novel on novel.id = poll.novel_id
  where poll.id = p_poll_id
    and novel.status = 'published'
  for update of poll;

  if not found or v_poll.status <> 'active' then
    raise exception using errcode='22023', message='Active poll unavailable';
  end if;
  if v_poll.owner_user_id = v_uid then
    raise exception using errcode='42501', message='Authors cannot vote on their own novel poll';
  end if;
  if exists (
    select 1
    from public.user_blocks block
    where (block.blocker_user_id = v_poll.owner_user_id and block.blocked_user_id = v_uid)
       or (block.blocker_user_id = v_uid and block.blocked_user_id = v_poll.owner_user_id)
  ) then
    raise exception using errcode='42501', message='DIRECT_INTERACTION_UNAVAILABLE';
  end if;
  if not exists (
    select 1
    from public.novel_poll_options option
    where option.id = p_option_id
      and option.poll_id = p_poll_id
  ) then
    raise exception using errcode='22023', message='Poll option unavailable';
  end if;
  if exists (
    select 1
    from public.novel_poll_votes vote
    where vote.poll_id = p_poll_id
      and vote.voter_user_id = v_uid
  ) then
    raise exception using errcode='22023', message='A vote has already been recorded for this poll';
  end if;

  begin
    insert into public.novel_poll_votes (poll_id, option_id, voter_user_id)
    values (p_poll_id, p_option_id, v_uid);
  exception
    when unique_violation then
      raise exception using errcode='22023', message='A vote has already been recorded for this poll';
  end;

  return pg_catalog.jsonb_build_object(
    'poll_id', p_poll_id,
    'option_id', p_option_id,
    'status', 'recorded'
  );
end
$$;

revoke all on function public.novelight_public_novel_poll(bigint) from public, anon, authenticated, service_role;
revoke all on function public.novelight_manage_my_novel_polls(bigint,integer) from public, anon, authenticated, service_role;
revoke all on function public.novelight_create_my_novel_poll(bigint,text,text[]) from public, anon, authenticated, service_role;
revoke all on function public.novelight_close_my_novel_poll(bigint) from public, anon, authenticated, service_role;
revoke all on function public.novelight_vote_novel_poll(bigint,bigint) from public, anon, authenticated, service_role;

grant execute on function public.novelight_public_novel_poll(bigint) to anon, authenticated;
grant execute on function public.novelight_manage_my_novel_polls(bigint,integer) to authenticated;
grant execute on function public.novelight_create_my_novel_poll(bigint,text,text[]) to authenticated;
grant execute on function public.novelight_close_my_novel_poll(bigint) to authenticated;
grant execute on function public.novelight_vote_novel_poll(bigint,bigint) to authenticated;

comment on table public.novel_polls is
  'B #20 author-created novel polls. Poll activity never changes Rank, LIGHT SEED, SCOUT, PV, favorites, search, discovery, exposure, analytics, or recommendations.';
comment on table public.novel_poll_votes is
  'Private raw poll votes. Voter identities are never returned by public or author management RPCs.';
comment on function public.novelight_public_novel_poll(bigint) is
  'Returns one active poll, or the latest closed poll when none is active. Active results stay hidden until the current authenticated reader votes.';
comment on function public.novelight_vote_novel_poll(bigint,bigint) is
  'Records one immutable authenticated-reader vote. The current novel owner cannot vote on their own poll.';

commit;
