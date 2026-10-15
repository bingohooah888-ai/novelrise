// Inert Stage12 SQL generator. This file itself never changes Production.
// The separate owner-signed 11/1 release, env readiness and operator check remain required.

export const CONTEST_START_PREFIX = 'NOVELIGHT_CONTEST_START_APPROVE ';

function check(ok,msg){if(!ok)throw Error('STEP12_START_BLOCKED: '+msg);}

export function verifyContestStartApproval(ctx){
 const obj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
 check(obj(ctx)&&ctx.repository==='bingohooah888-ai/novelrise'&&ctx.issueNumber===2120,'repository/issue mismatch');
 check(ctx.commentAuthor==='bingohooah888-ai'&&ctx.authorAssociation==='OWNER'&&Number.isSafeInteger(ctx.commentId)&&ctx.commentId>0,'owner comment required');
 check(typeof ctx.commentBody==='string'&&ctx.commentBody.startsWith('NOVELIGHT_CONTEST_START_APPROVE '),'independent start approval missing');
 let p;try{p=JSON.parse(ctx.commentBody.slice('NOVELIGHT_CONTEST_START_APPROVE '.length));}catch{check(false,'invalid JSON');}
 const keys=['version','operation','requestId','mainSha','contestKey','termsVersion','termsUrl','issuedAt','expiresAt','challenge','confirmation','attestations'];
 check(obj(p)&&Object.keys(p).sort().join(',')===keys.sort().join(','),'unexpected approval keys');
 check(p.version===1&&p.operation==='start-november-contest'&&/^contest-start-[a-z0-9-]{10,60}$/.test(p.requestId),'invalid operation/request');
 check(/^[0-9a-f]{40}$/.test(p.mainSha)&&p.mainSha===ctx.currentMainSha,'stale main');
 check(p.contestKey==='novelight-november-2026'&&p.termsVersion==='november-2026-v1'&&p.termsUrl==='https://novelight.jp/contest-terms','wrong terms');
 check(p.confirmation==='CHAT_CONTEST_START_APPROVED'&&p.challenge===p.mainSha.slice(0,8).toUpperCase(),'separate confirmation/challenge required');
 const required=['registrationOpenVerified','entryDeadlineVerified','scoringSafetyReviewed','readingEndpointConfigVerified','guestSecretVerified','operatorReady'];
 check(obj(p.attestations)&&Object.keys(p.attestations).sort().join(',')===required.sort().join(',')&&required.every(k=>p.attestations[k]===true),'attestations missing');
 const issued=Date.parse(p.issuedAt),expiry=Date.parse(p.expiresAt),now=Date.parse(ctx.now);
 check(typeof p.issuedAt==='string'&&typeof p.expiresAt==='string'&&/Z$/.test(p.issuedAt)&&/Z$/.test(p.expiresAt)&&Number.isFinite(issued)&&Number.isFinite(expiry)&&Number.isFinite(now)&&issued<=now&&now<expiry&&expiry-issued<=900000,'approval expired/invalid');
 return Object.freeze({mainSha:p.mainSha,commentId:ctx.commentId,challenge:p.challenge,requestId:p.requestId,approvalVerified:true,productionMutationPerformed:false});
}

export function buildContestStartSql(a){
 check(a?.approvalVerified===true&&a.productionMutationPerformed===false&&/^[0-9a-f]{40}$/.test(a.mainSha)&&Number.isSafeInteger(a.commentId)&&a.commentId>0&&/^[A-F0-9]{8}$/.test(a.challenge),'inert trusted plan required');
 return [
  '-- INERT PLAN ONLY. A separate production workflow, independent OWNER approval and fresh checks are mandatory.',
  '-- DO NOT EXECUTE FROM CHAT. Does not change env flags, grant awards or trigger reading.',
  'do $novelight_contest_start$',
  'declare',
  '  c public.novelight_contests%rowtype;',
  '  changed integer;',
  '  now_at timestamptz := pg_catalog.clock_timestamp();',
  'begin',
  "  perform pg_catalog.set_config('lock_timeout','5s',true);",
  "  perform pg_catalog.set_config('statement_timeout','20s',true);",
  "  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:contest:2026:active-start'));",
  '  select * into strict c from public.novelight_contests',
  "    where contest_key='novelight-november-2026' for update;",
  "  if c.status <> 'registration' or c.public_visible is not true",
  "     or c.terms_version <> 'november-2026-v1'",
  "     or c.terms_url <> 'https://novelight.jp/contest-terms'",
  '     or c.minimum_published_episodes <> 10',
  "     or c.entry_deadline_at <> '2026-10-31 14:59:59.999999+00'::timestamptz",
  "     or c.starts_at <> '2026-10-31 15:00:00+00'::timestamptz",
  "     or c.ends_at <> '2026-11-30 15:00:00+00'::timestamptz",
  "     or now_at < c.starts_at or now_at >= c.starts_at + interval '1 day' then",
  "    raise exception 'STEP12_START_BLOCKED: state, terms or clock mismatch';",
  '  end if;',
  "  if not exists(select 1 from public.novelight_contest_review_audit",
  "    where contest_id=c.id and action='registration_open') then",
  "    raise exception 'STEP12_START_BLOCKED: registration audit missing';",
  '  end if;',
  "  if not exists(select 1 from public.novelight_contest_entries",
  "    where contest_id=c.id and status='entered') then",
  "    raise exception 'STEP12_START_BLOCKED: no eligible entry';",
  '  end if;',
  '  if exists(select 1 from public.novelight_contest_read_events',
  '    where contest_id=c.id)',
  '     or exists(select 1 from public.novelight_contest_rank_snapshots',
  '       where contest_id=c.id)',
  '     or exists(select 1 from public.novelight_contest_awards',
  '       where contest_id=c.id) then',
  "    raise exception 'STEP12_START_BLOCKED: premature contest activity';",
  '  end if;',
  '  update public.novelight_contests',
  "    set status='active',updated_at=now_at",
  "    where id=c.id and status='registration' and public_visible=true;",
  '  get diagnostics changed = row_count;',
  '  if changed <> 1 then',
  "    raise exception 'STEP12_START_BLOCKED: atomic transition missing';",
  '  end if;',
  '  insert into public.novelight_contest_review_audit',
  '    (contest_id,action,reason_code,evidence_summary)',
  "  values(c.id,'contest_start','independent_owner_approval',",
  "    pg_catalog.jsonb_build_object('approval_comment','github-comment-"+a.commentId+"',",
  "      'approval_main_sha','"+a.mainSha+"',",
  "      'approval_challenge','"+a.challenge+"'));",
  'end;',
  '$novelight_contest_start$;'
 ].join('\n')+'\n';
}
