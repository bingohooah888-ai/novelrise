-- NOVELIGHT beta content-rating v2.
-- Replace the two-state general/mature model with explicit beta zoning.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260926113000'));

alter table public.novels
  drop constraint if exists novels_content_rating_check;

-- Existing `mature` works are mapped conservatively to the 15+ tier.
-- Authors can explicitly opt into the 18+ non-sexual tier after reviewing
-- their work and warnings under the beta-2 policy.
update public.novels
   set content_rating = 'sensitive_15'
 where content_rating = 'mature';

alter table public.novels
  add constraint novels_content_rating_check
  check (content_rating in ('general', 'sensitive_15', 'adult_18_nonsexual'));

create or replace function public.enforce_novel_beta_classification()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Zero-downtime compatibility for an already-open pre-deploy browser tab.
  -- The legacy value is accepted at the trigger boundary but never persisted.
  if new.content_rating = 'mature' then
    new.content_rating := 'sensitive_15';
  end if;

  if new.status = 'published' then
    if new.ai_usage = 'unspecified' then
      raise exception using
        errcode = '23514',
        message = '公開作品はAI利用区分を選択してください';
    end if;

    if not new.content_policy_ack
       or new.content_policy_version is null
       or btrim(new.content_policy_version) = '' then
      raise exception using
        errcode = '23514',
        message = '公開前に投稿ガイドラインの確認が必要です';
    end if;

    if new.content_rating in ('sensitive_15', 'adult_18_nonsexual')
       and cardinality(new.content_warnings) = 0 then
      raise exception using
        errcode = '23514',
        message = 'センシティブ15+ / 18+作品には内容警告を1つ以上設定してください';
    end if;
  end if;

  return new;
end
$$;

commit;
