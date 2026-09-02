begin;

create table public.announcements (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  category text not null,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length check (char_length(title) between 1 and 120),
  constraint announcements_body_length check (char_length(body) between 1 and 10000),
  constraint announcements_category_length check (char_length(category) between 1 and 40),
  constraint announcements_status_check check (status in ('draft', 'published', 'archived')),
  constraint announcements_published_at_check check (
    status <> 'published' or published_at is not null
  )
);

create index announcements_public_idx
  on public.announcements (status, published_at desc, id desc);

alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;
revoke all on sequence public.announcements_id_seq from anon, authenticated;

create table public.admin_operation_audit (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_operation_audit_action_length check (char_length(action) between 1 and 80),
  constraint admin_operation_audit_resource_type_length check (char_length(resource_type) between 1 and 80),
  constraint admin_operation_audit_resource_id_length check (char_length(resource_id) between 1 and 120)
);

create index admin_operation_audit_created_at_idx
  on public.admin_operation_audit (created_at desc);

alter table public.admin_operation_audit enable row level security;
revoke all on table public.admin_operation_audit from anon, authenticated;
revoke all on sequence public.admin_operation_audit_id_seq from anon, authenticated;

create or replace function public.novelight_admin_create_announcement(
  p_admin_user_id uuid,
  p_title text,
  p_body text,
  p_category text,
  p_status text default 'draft'
)
returns setof public.announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_category text := trim(coalesce(p_category, ''));
  v_status text := lower(trim(coalesce(p_status, 'draft')));
  v_row public.announcements%rowtype;
begin
  if p_admin_user_id is null then
    raise exception 'Admin identity is required' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Announcement title is invalid' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 10000 then
    raise exception 'Announcement body is invalid' using errcode = '22023';
  end if;
  if char_length(v_category) not between 1 and 40 then
    raise exception 'Announcement category is invalid' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'Announcement status is invalid' using errcode = '22023';
  end if;

  insert into public.announcements (
    title,
    body,
    category,
    status,
    published_at
  ) values (
    v_title,
    v_body,
    v_category,
    v_status,
    case when v_status = 'published' then now() else null end
  )
  returning * into v_row;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'announcement.create',
    'announcement',
    v_row.id::text,
    jsonb_build_object('status', v_row.status)
  );

  return next v_row;
end;
$$;

create or replace function public.novelight_admin_update_announcement(
  p_admin_user_id uuid,
  p_id bigint,
  p_title text,
  p_body text,
  p_category text,
  p_status text
)
returns setof public.announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_category text := trim(coalesce(p_category, ''));
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.announcements%rowtype;
begin
  if p_admin_user_id is null or p_id is null or p_id <= 0 then
    raise exception 'Admin identity and announcement ID are required' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Announcement title is invalid' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 10000 then
    raise exception 'Announcement body is invalid' using errcode = '22023';
  end if;
  if char_length(v_category) not between 1 and 40 then
    raise exception 'Announcement category is invalid' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'Announcement status is invalid' using errcode = '22023';
  end if;

  update public.announcements
     set title = v_title,
         body = v_body,
         category = v_category,
         status = v_status,
         published_at = case
           when v_status = 'published' then coalesce(published_at, now())
           when v_status = 'draft' then null
           else published_at
         end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'announcement.update',
    'announcement',
    v_row.id::text,
    jsonb_build_object('status', v_row.status)
  );

  return next v_row;
end;
$$;

create or replace function public.novelight_admin_update_contact_inquiry_status(
  p_admin_user_id uuid,
  p_id bigint,
  p_status text
)
returns table (
  id bigint,
  subject text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.contact_inquiries%rowtype;
begin
  if p_admin_user_id is null or p_id is null or p_id <= 0 then
    raise exception 'Admin identity and inquiry ID are required' using errcode = '22023';
  end if;
  if v_status not in ('new', 'reviewing', 'resolved') then
    raise exception 'Inquiry status is invalid' using errcode = '22023';
  end if;

  update public.contact_inquiries
     set status = v_status
   where public.contact_inquiries.id = p_id
   returning public.contact_inquiries.* into v_row;

  if not found then
    raise exception 'Inquiry not found' using errcode = 'P0002';
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'contact_inquiry.status',
    'contact_inquiry',
    v_row.id::text,
    jsonb_build_object('status', v_row.status)
  );

  return query
  select v_row.id, v_row.subject, v_row.status, v_row.created_at;
end;
$$;

revoke all on function public.novelight_admin_create_announcement(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.novelight_admin_update_announcement(uuid, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.novelight_admin_update_contact_inquiry_status(uuid, bigint, text) from public, anon, authenticated;

grant execute on function public.novelight_admin_create_announcement(uuid, text, text, text, text) to service_role;
grant execute on function public.novelight_admin_update_announcement(uuid, bigint, text, text, text, text) to service_role;
grant execute on function public.novelight_admin_update_contact_inquiry_status(uuid, bigint, text) to service_role;

comment on table public.announcements is
  'Operator-managed NOVELIGHT announcements. Client roles have no direct table access; published rows are exposed only through the public server endpoint.';
comment on table public.admin_operation_audit is
  'Private audit trail for allowlisted server-side ADMIN write operations.';
comment on function public.novelight_admin_create_announcement(uuid, text, text, text, text) is
  'Service-role-only atomic announcement creation plus ADMIN audit record.';
comment on function public.novelight_admin_update_announcement(uuid, bigint, text, text, text, text) is
  'Service-role-only atomic announcement update plus ADMIN audit record.';
comment on function public.novelight_admin_update_contact_inquiry_status(uuid, bigint, text) is
  'Service-role-only atomic contact inquiry status update plus ADMIN audit record.';

commit;
