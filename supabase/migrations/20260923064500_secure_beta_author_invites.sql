-- NOVELIGHT: bind Founding Author preregistrations to Auth users through
-- a private, email-delivered bearer invite instead of email-value matching.
--
-- Raw invite tokens are never persisted. The Before User Created hook validates
-- only SHA-256 hashes, and the post-insert trigger consumes the invite and
-- removes the transport token from Auth metadata in the same transaction.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260923064500'));

create table public.beta_author_invites (
  id bigint generated always as identity primary key,
  preregistration_id bigint not null unique
    references public.beta_author_preregistrations(id) on delete restrict,
  token_version integer not null check (token_version > 0),
  token_hash text not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  sent_at timestamptz,
  consumed_at timestamptz,
  redeemed_auth_user_id uuid,
  revoked_at timestamptz,
  resend_email_id text,
  delivery_status text not null default 'prepared',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_author_invites_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint beta_author_invites_expiry_check
    check (expires_at > issued_at),
  constraint beta_author_invites_resend_email_id_length
    check (resend_email_id is null or char_length(resend_email_id) <= 200),
  constraint beta_author_invites_delivery_status_check
    check (
      delivery_status in (
        'prepared',
        'accepted',
        'delivered',
        'bounced',
        'complained'
      )
      or delivery_status ~ '^error_[0-9]{3}$'
    )
);

create index beta_author_invites_expiry_idx
  on public.beta_author_invites (expires_at)
  where consumed_at is null and revoked_at is null;

create index beta_author_invites_delivery_idx
  on public.beta_author_invites (delivery_status, sent_at);

alter table public.beta_author_invites enable row level security;

revoke all on table public.beta_author_invites
  from public, anon, authenticated;
revoke all on sequence public.beta_author_invites_id_seq
  from public, anon, authenticated;

grant select, insert, update, delete on table public.beta_author_invites
  to service_role;
grant usage, select on sequence public.beta_author_invites_id_seq
  to service_role;

-- The Auth hook is SECURITY INVOKER. Give it only the columns it needs.
grant select (
  preregistration_id,
  token_hash,
  expires_at,
  sent_at,
  consumed_at,
  revoked_at
) on table public.beta_author_invites to supabase_auth_admin;

create policy beta_author_invites_auth_signup_lookup
  on public.beta_author_invites
  for select
  to supabase_auth_admin
  using (true);

grant select (id, auth_user_id)
  on table public.beta_author_preregistrations
  to supabase_auth_admin;

create or replace function public.hook_novelight_beta_signup_gate(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_campaign_state text;
  v_email text;
  v_token text;
  v_token_hash text;
  v_is_reserved boolean := false;
  v_has_valid_invite boolean := false;
begin
  select config.state
    into v_campaign_state
    from public.beta_author_preregistration_config as config
   where config.id = 1;

  if v_campaign_state is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', '新規会員登録を一時的に停止しています。'
      )
    );
  end if;

  if v_campaign_state = 'PRE_REGISTRATION' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '現在は先行作者登録期間です。一般会員登録はβ版公開までお待ちください。'
      )
    );
  end if;

  v_email := lower(btrim(coalesce(event #>> '{user,email}', '')));
  v_token := btrim(
    coalesce(event #>> '{user,user_metadata,novelight_invite_token}', '')
  );

  if char_length(v_token) = 43
     and v_token ~ '^[A-Za-z0-9_-]{43}$' then
    v_token_hash := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
      'hex'
    );
  end if;

  if v_email <> '' then
    select exists (
      select 1
        from public.beta_author_preregistrations p
       where p.email_normalized = v_email
         and p.status <> 'cancelled'
         and p.auth_user_id is null
    )
      into v_is_reserved;
  end if;

  if v_token_hash is not null and v_email <> '' then
    select exists (
      select 1
        from public.beta_author_invites i
        join public.beta_author_preregistrations p
          on p.id = i.preregistration_id
       where i.token_hash = v_token_hash
         and i.sent_at is not null
         and i.consumed_at is null
         and i.revoked_at is null
         and i.expires_at > now()
         and p.email_normalized = v_email
         and p.status <> 'cancelled'
         and p.auth_user_id is null
    )
      into v_has_valid_invite;
  end if;

  if v_campaign_state = 'AUTHOR_PREOPEN' then
    if v_has_valid_invite then
      return '{}'::jsonb;
    end if;

    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '先行作者プレオープン中です。登録メールへお送りしたご本人専用の招待URLから会員登録してください。'
      )
    );
  end if;

  if v_campaign_state in ('BETA_OPEN', 'CLOSED') then
    if v_is_reserved and not v_has_valid_invite then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 403,
          'message', 'このメールアドレスには先行登録資格があります。Founding Author資格を安全に紐付けるため、登録メールへお送りしたご本人専用の招待URLから会員登録してください。'
        )
      );
    end if;

    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 503,
      'message', '新規会員登録を一時的に停止しています。'
    )
  );
end;
$$;

revoke execute on function public.hook_novelight_beta_signup_gate(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_novelight_beta_signup_gate(jsonb)
  to supabase_auth_admin;

create or replace function public.novelight_consume_beta_author_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(new.email, ''))
  );
  v_token text := pg_catalog.btrim(
    coalesce(
      new.raw_user_meta_data ->> 'novelight_invite_token',
      ''
    )
  );
  v_token_hash text;
  v_invite_id bigint;
  v_preregistration_id bigint;
begin
  if pg_catalog.char_length(v_token) = 43
     and v_token ~ '^[A-Za-z0-9_-]{43}$' then
    v_token_hash := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
      'hex'
    );

    select i.id, p.id
      into v_invite_id, v_preregistration_id
      from public.beta_author_invites i
      join public.beta_author_preregistrations p
        on p.id = i.preregistration_id
     where i.token_hash = v_token_hash
       and i.sent_at is not null
       and i.consumed_at is null
       and i.revoked_at is null
       and i.expires_at > pg_catalog.now()
       and p.email_normalized = v_email
       and p.status <> 'cancelled'
       and p.auth_user_id is null
     for update of i, p;

    if found then
      update public.beta_author_invites i
         set consumed_at = pg_catalog.now(),
             redeemed_auth_user_id = new.id,
             updated_at = pg_catalog.now()
       where i.id = v_invite_id;

      update public.beta_author_preregistrations p
         set auth_user_id = new.id,
             email_verified = true,
             registered_at = coalesce(p.registered_at, new.created_at),
             status = case
               when p.status in ('preregistered', 'verified', 'invited')
                 then 'registered'
               else p.status
             end,
             updated_at = pg_catalog.now()
       where p.id = v_preregistration_id;
    end if;
  end if;

  -- The bearer value is transport-only. Never retain it in auth.users.
  if new.raw_user_meta_data ? 'novelight_invite_token' then
    update auth.users u
       set raw_user_meta_data =
         coalesce(u.raw_user_meta_data, '{}'::jsonb)
         - 'novelight_invite_token'
     where u.id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.novelight_consume_beta_author_invite()
  from public, anon, authenticated, service_role, supabase_auth_admin;

drop trigger if exists novelight_auth_user_00_consume_beta_author_invite
  on auth.users;

create trigger novelight_auth_user_00_consume_beta_author_invite
after insert on auth.users
for each row
execute function public.novelight_consume_beta_author_invite();

-- Founding Author linkage is now explicit only. Matching an Auth email value is
-- no longer sufficient to claim a preregistration.
create or replace function public.novelight_sync_user_participation_qualifications(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_email text;
  v_created_at timestamptz;
  v_preregistration_id bigint;
  v_preregistration_status text;
  v_linked_user uuid;
  v_number bigint;
  v_qualified_at timestamptz;
  v_beta_start timestamptz;
  v_beta_end timestamptz;
  v_beta_id bigint;
  v_beta_matches integer;
begin
  select
    lower(btrim(coalesce(u.email, ''))),
    u.created_at
  into v_email, v_created_at
  from auth.users u
  where u.id = p_user_id;

  if not found then
    delete from public.founding_authors f
    where f.author_id = p_user_id;
    return;
  end if;

  if public.novelight_is_internal_participation_account(p_user_id) then
    delete from public.founding_authors f
    where f.author_id = p_user_id;
    delete from public.beta_participants b
    where b.auth_user_id = p_user_id
       or (v_email <> '' and b.email_normalized = v_email);
    return;
  end if;

  select
    p.id,
    p.status,
    p.auth_user_id,
    q.founding_number,
    q.qualified_at
  into
    v_preregistration_id,
    v_preregistration_status,
    v_linked_user,
    v_number,
    v_qualified_at
  from public.beta_author_preregistrations p
  join public.beta_author_founding_qualifications q
    on q.preregistration_id = p.id
  where p.auth_user_id = p_user_id
  order by p.id
  limit 1;

  if found then
    if v_linked_user is not null
       and v_linked_user <> p_user_id
       and exists (select 1 from auth.users u where u.id = v_linked_user) then
      raise exception 'Preregistration % is already linked to another active Auth user',
        v_preregistration_id;
    end if;

    update public.beta_author_preregistrations p
    set
      registered_at = coalesce(p.registered_at, v_created_at),
      updated_at = case
        when p.registered_at is null then now()
        else p.updated_at
      end
    where p.id = v_preregistration_id
      and p.registered_at is null;

    if v_preregistration_status <> 'cancelled' then
      insert into public.founding_authors (
        author_id,
        founding_number,
        qualifying_novel_id,
        qualified_at
      ) values (
        p_user_id,
        v_number,
        null,
        v_qualified_at
      )
      on conflict (author_id) do update
        set founding_number = excluded.founding_number,
            qualifying_novel_id = null,
            qualified_at = excluded.qualified_at;
    else
      delete from public.founding_authors f
      where f.author_id = p_user_id;
    end if;
  else
    delete from public.founding_authors f
    where f.author_id = p_user_id;
  end if;

  select c.starts_at, c.ends_at
  into v_beta_start, v_beta_end
  from public.beta_participation_qualification_config c
  where c.id = 1;

  if v_email <> ''
     and v_created_at >= v_beta_start
     and (v_beta_end is null or v_created_at < v_beta_end) then
    select count(*)::integer, min(b.id)
    into v_beta_matches, v_beta_id
    from public.beta_participants b
    where b.auth_user_id = p_user_id
       or b.email_normalized = v_email;

    if v_beta_matches > 1 then
      raise exception 'Conflicting beta participant identities for Auth user %', p_user_id;
    elsif v_beta_matches = 1 then
      update public.beta_participants b
      set
        auth_user_id = p_user_id,
        email_normalized = v_email,
        auth_created_at = least(b.auth_created_at, v_created_at),
        qualified_at = least(b.qualified_at, v_created_at),
        linked_at = now(),
        updated_at = now()
      where b.id = v_beta_id;
    else
      insert into public.beta_participants (
        auth_user_id,
        email_normalized,
        qualified_at,
        auth_created_at,
        linked_at
      ) values (
        p_user_id,
        v_email,
        v_created_at,
        v_created_at,
        now()
      );
    end if;
  end if;
end;
$$;

revoke all on function public.novelight_sync_user_participation_qualifications(uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_sync_user_participation_qualifications(uuid)
  to service_role;

-- New preregistrations still receive an immutable Founding number immediately,
-- but never attach themselves to an Auth user merely because an email matches.
create or replace function public.assign_beta_author_founding_qualification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_number bigint;
begin
  update public.beta_author_founding_number_allocator a
  set last_number = a.last_number + 1,
      updated_at = now()
  where a.id = 1
  returning a.last_number into v_number;

  if v_number is null then
    raise exception 'Founding number allocator is unavailable';
  end if;

  insert into public.beta_author_founding_qualifications (
    preregistration_id,
    founding_number,
    qualified_at
  ) values (
    new.id,
    v_number,
    new.created_at
  );

  return new;
end;
$$;

revoke all on function public.assign_beta_author_founding_qualification()
  from public, anon, authenticated, service_role;

comment on table public.beta_author_invites is
  'Private one-time preregistration invite ledger. Stores only hashes; raw bearer tokens are never persisted.';

comment on function public.hook_novelight_beta_signup_gate(jsonb) is
  'Supabase Before User Created hook. Requires a valid email-delivered invite for reserved preregistration identities and for all AUTHOR_PREOPEN signups.';

comment on function public.novelight_consume_beta_author_invite() is
  'Consumes a validated preregistration invite, binds the Auth user explicitly, marks inbox ownership verified, and scrubs the bearer from Auth metadata.';

commit;
