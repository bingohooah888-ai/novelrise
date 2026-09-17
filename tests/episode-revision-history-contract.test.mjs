import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260917143000_episode_revision_history.sql',
  import.meta.url
);
const rollbackUrl = new URL(
  '../supabase/rollback/20260917143000_episode_revision_history_rollback.sql',
  import.meta.url
);
const precheckUrl = new URL(
  '../supabase/checks/20260917143000_episode_revision_history_precheck.sql',
  import.meta.url
);
const postcheckUrl = new URL(
  '../supabase/checks/20260917143000_episode_revision_history_postcheck.sql',
  import.meta.url
);
const uiUrl = new URL('../novelight-episode-history.js', import.meta.url);
const editUrl = new URL('../episode-edit.html', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('revision history is private and bounded for beta', async () => {
  const migration = await text(migrationUrl);

  assert.match(
    migration,
    /create table if not exists public\.episode_revisions/i
  );
  assert.match(
    migration,
    /alter table public\.episode_revisions enable row level security/i
  );
  assert.match(
    migration,
    /revoke all on table public\.episode_revisions from anon/i
  );
  assert.match(
    migration,
    /revoke all on table public\.episode_revisions from authenticated/i
  );
  assert.match(migration, /episode_id bigint not null references public\.episodes\(id\)/i);
  assert.match(migration, /novel_id bigint not null references public\.novels\(id\)/i);
  assert.match(migration, /interval '90 days'/i);
  assert.match(migration, /offset 20/i);
  assert.match(
    migration,
    /before update of title, content on public\.episodes[\s\S]*novelight_capture_episode_revision/i
  );
  assert.match(migration, /old\.title is not distinct from new\.title/i);
  assert.match(migration, /old\.content is not distinct from new\.content/i);
});

test('restore mutates only title and content on the existing episode row', async () => {
  const migration = await text(migrationUrl);
  const updateBlock = migration.match(
    /update public\.episodes e\s+set[\s\S]*?where e\.id = p_episode_id\s+and e\.user_id = v_uid;/i
  )?.[0];
  const setClause = updateBlock?.match(/set[\s\S]*?where/i)?.[0] || '';

  assert.ok(updateBlock, 'restore UPDATE block must exist');
  assert.match(setClause, /set title = v_revision\.title/i);
  assert.match(setClause, /content = v_revision\.content/i);
  assert.doesNotMatch(
    setClause,
    /episode_number|status|is_public|scheduled_publish_at|last_published_at|novel_id|user_id/i
  );
  assert.match(
    migration,
    /set_config\('novelight\.revision_reason', 'restore', true\)/i
  );
  assert.match(migration, /r\.episode_id = p_episode_id/i);
  assert.match(migration, /r\.user_id = v_uid/i);
});

test('history RPCs are authenticated-only and direct table reads stay disabled', async () => {
  const [migration, postcheck] = await Promise.all([
    text(migrationUrl),
    text(postcheckUrl)
  ]);

  const signatures = [
    'novelight_list_episode_revisions\\(bigint\\)',
    'novelight_get_episode_revision\\(uuid\\)',
    'novelight_restore_episode_revision\\(bigint, uuid\\)'
  ];
  for (const signature of signatures) {
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${signature} to authenticated`,
        'i'
      )
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature} from anon`, 'i')
    );
  }
  assert.match(postcheck, /directly readable by clients/i);
  assert.match(postcheck, /anonymous revision RPC access exists/i);
});

test('author history UI renders prose as text and requires explicit restore', async () => {
  const [ui, edit] = await Promise.all([text(uiUrl), text(editUrl)]);

  assert.match(edit, /<script src="novelight-episode-history\.js"><\/script>/);
  assert.match(ui, /novelight_list_episode_revisions/);
  assert.match(ui, /novelight_get_episode_revision/);
  assert.match(ui, /novelight_restore_episode_revision/);
  assert.match(ui, /\.textContent\s*=/);
  assert.match(ui, /window\.confirm\(/);
  assert.match(ui, /hasUnsavedFormChanges/);
  assert.match(ui, /episode_number,title,content/);
  assert.doesNotMatch(
    ui,
    /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|eval\(|new Function/
  );
  assert.match(ui, /話数・公開状態・予約公開・PV・Rank・LIGHT SEED・SCOUT/);
});

test('migration safety artifacts exist and rollback removes only history objects', async () => {
  const [precheck, postcheck, rollback] = await Promise.all([
    text(precheckUrl),
    text(postcheckUrl),
    text(rollbackUrl)
  ]);

  assert.match(precheck, /public\.episodes/);
  assert.match(precheck, /public\.episode_revisions already exists/);
  assert.match(postcheck, /revision trigger is missing/);
  assert.match(
    rollback,
    /drop trigger if exists episode_revision_history_before_update on public\.episodes/i
  );
  assert.match(rollback, /drop table if exists public\.episode_revisions/i);
  assert.doesNotMatch(
    rollback,
    /drop table if exists public\.(episodes|novels)\b/i
  );
});
