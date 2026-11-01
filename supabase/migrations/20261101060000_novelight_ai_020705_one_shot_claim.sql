-- 02-07-05 Staging-only candidate migration. NOT applied by creating this PR.
-- No model call, authorization ledger, Preview, budget or AI activation.
-- A consumed claim is an immutable, non-secret audit tombstone. Keep it
-- after fixture cleanup to block replay of a previously approved invocation.
begin;

create table public.novelight_ai_020705_one_shot_claims (
  approval_comment_id bigint primary key check (approval_comment_id > 0),
  actor_id uuid not null,
  novel_id bigint not null,
  episode_id bigint not null,
  main_sha text not null check (main_sha ~ '^[a-f0-9]{40}$'),
  preview_deployment_id text not null check (
    preview_deployment_id ~ '^dpl_[A-Za-z0-9]+$'
  ),
  provider text not null check (provider = 'openai'),
  model text not null check (model = 'gpt-5.6-luna'),
  ceiling_micros bigint not null check (
    ceiling_micros between 1 and 10000000
  ),
  consumed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > consumed_at),
  check (expires_at <= consumed_at + interval '1 hour'),
  unique (main_sha, preview_deployment_id, actor_id, novel_id, episode_id)
);

-- Do not cascade this tombstone on fixture/user removal: deleting a synthetic
-- user must never re-open a consumed approval. The table holds no manuscript,
-- token, original provider response, or email.
alter table public.novelight_ai_020705_one_shot_claims
  enable row level security;
revoke all on table public.novelight_ai_020705_one_shot_claims
  from public, anon, authenticated;
grant select, insert on public.novelight_ai_020705_one_shot_claims
  to service_role;

create function public.novelight_ai_020705_claim_once(
  p_approval_comment_id bigint,
  p_actor_id uuid,
  p_novel_id bigint,
  p_episode_id bigint,
  p_main_sha text,
  p_preview_deployment_id text,
  p_provider text,
  p_model text,
  p_ceiling_micros bigint,
  p_expires_at timestamptz,
  p_project_ref text
) returns boolean language plpgsql security invoker
set search_path = '' as $$
declare
  v_runtime public.novelight_ai_runtime_settings%rowtype;
  v_consumed bigint;
begin
  if current_user <> 'service_role' or
     p_project_ref is distinct from 'wmlzjgvxgoyrovdhbqbg' then
    raise exception using errcode = '42501',
      message = 'AI trial service and Staging project required';
  end if;
  if p_approval_comment_id is null or p_approval_comment_id <= 0
     or p_actor_id is null
     or p_novel_id is null or p_novel_id <= 0
     or p_episode_id is null or p_episode_id <= 0
     or p_main_sha is null or p_main_sha !~ '^[a-f0-9]{40}$'
     or p_preview_deployment_id is null
     or p_preview_deployment_id !~ '^dpl_[A-Za-z0-9]+$'
     or p_provider is distinct from 'openai'
     or p_model is distinct from 'gpt-5.6-luna'
     or p_ceiling_micros is null
     or p_ceiling_micros not between 1 and 10000000
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '1 hour'
  then
    return false;
  end if;
  -- The live runtime must already have budget admission. A claimed token
  -- never enables the global switch, alters caps, or creates a reservation.
  select * into v_runtime from public.novelight_ai_runtime_settings
    where singleton = 1;
  if not found or v_runtime.enabled is not true or
     v_runtime.user_day_cap_micros < p_ceiling_micros or
     v_runtime.user_month_cap_micros < p_ceiling_micros or
     v_runtime.global_day_cap_micros < p_ceiling_micros or
     v_runtime.global_month_cap_micros < p_ceiling_micros or
     greatest(v_runtime.user_day_cap_micros,
       v_runtime.user_month_cap_micros,
       v_runtime.global_day_cap_micros,
       v_runtime.global_month_cap_micros) > 10000000 then
    return false;
  end if;
  if not exists (
    select 1 from public.novels n
      join public.episodes e on e.novel_id = n.id
    where n.id = p_novel_id and e.id = p_episode_id
      and n.user_id = p_actor_id
  ) then
    return false;
  end if;

  -- Atomic across concurrent serverless instances. A timeout or provider
  -- failure does NOT delete this claim; never replay or retry a paid POST.
  insert into public.novelight_ai_020705_one_shot_claims (
    approval_comment_id, actor_id, novel_id, episode_id,
    main_sha, preview_deployment_id, provider, model,
    ceiling_micros, expires_at
  ) values (
    p_approval_comment_id, p_actor_id, p_novel_id, p_episode_id,
    p_main_sha, p_preview_deployment_id, p_provider, p_model,
    p_ceiling_micros, p_expires_at
  ) on conflict do nothing
  returning approval_comment_id into v_consumed;
  return v_consumed is not null;
end
$$;

revoke all on function public.novelight_ai_020705_claim_once(
  bigint, uuid, bigint, bigint, text, text, text, text, bigint,
  timestamptz, text
) from public, anon, authenticated;
grant execute on function public.novelight_ai_020705_claim_once(
  bigint, uuid, bigint, bigint, text, text, text, text, bigint,
  timestamptz, text
) to service_role;

comment on table public.novelight_ai_020705_one_shot_claims is
  'Consumed non-secret approval tombstones; service-role only, no manuscript, credentials or resends.';
commit;
