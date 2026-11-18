-- Administrative reply audit. Accessible only through the authenticated ADMIN API.
-- Reply messages can contain personal information; do not grant client access.
create table if not exists public.admin_inquiry_replies (
  id bigint generated always as identity primary key,
  inquiry_id bigint not null references public.contact_inquiries(id) on delete cascade,
  admin_user_id uuid not null,
  subject text not null check (char_length(subject) between 1 and 160),
  message text not null check (char_length(message) between 1 and 10000),
  idempotency_key text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  resend_email_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_inquiry_replies_inquiry_created_idx
  on public.admin_inquiry_replies (inquiry_id, created_at desc, id desc);

-- PostgreSQL enforces the claim atomically across concurrent ADMIN requests.
-- A confirmed rejection (failed) releases the key; unknown and sent do not.
create unique index if not exists admin_inquiry_replies_active_key_unique_idx
  on public.admin_inquiry_replies (idempotency_key)
  where status in ('sending', 'sent');

alter table public.admin_inquiry_replies enable row level security;
revoke all on table public.admin_inquiry_replies from public, anon, authenticated;
revoke all on sequence public.admin_inquiry_replies_id_seq from public, anon, authenticated;
-- No anon/authenticated policies. Service role only via server ADMIN routes.
