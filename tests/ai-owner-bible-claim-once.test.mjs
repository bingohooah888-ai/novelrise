// OFFLINE ONLY: synthetic storage and source contract checks, not real DB proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createOfflineOwnerNovelBibleCheckpoint,
  createSupabaseOwnerNovelBibleCheckpointRepository
} from '../api/_lib/ai/owner-novel-bible-checkpoint.js';
import { createOwnerNovelBibleModelBridge } from '../api/_lib/ai/owner-novel-bible-model-bridge.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-jwt-never-real';
const TEXT = '凛は青い鍵を持っていた。';
// prettier-ignore
const proposal = readFileSync(
  new URL(
    '../reports/sql/novelight_ai_checkpoint_claim_once_v1_PROPOSAL.sql',
    import.meta.url
  ),
  'utf8'
);

// prettier-ignore
test('SQL claim is OFFLINE, unique, service-only and separate from CAS', () => {
  assert.match(proposal, /OFFLINE-ONLY/u);
  assert.match(proposal, /NOT a migration/u);
  assert.match(proposal, /create table public\.novelight_ai_chunk_claims/u);
  assert.match(
    proposal,
    /primary key\s*\(actor_id,novel_id,episode_id,source_hash,fingerprint,chunk_index\)/u
  );
  assert.match(proposal, /enable row level security/u);
  assert.match(
    proposal,
    /revoke all on table public\.novelight_ai_chunk_claims from public,anon,authenticated,service_role/u
  );
  assert.match(
    proposal,
    /grant select,insert on table public\.novelight_ai_chunk_claims to service_role/u
  );
  assert.match(
    proposal,
    /returns boolean language plpgsql security invoker set search_path = ''/u
  );
  assert.match(proposal, /current_user <> 'service_role'/u);
  assert.match(
    proposal,
    /from public\.novels n where n\.id = p_novel_id for share/u
  );
  assert.match(
    proposal,
    /from public\.episodes e where e\.id = p_episode_id for share/u
  );
  assert.match(proposal, /where a\.episode_id = p_episode_id for update/u);
  assert.match(proposal, /v_current_hash is distinct from p_source_hash/u);
  assert.match(proposal, /p_chunk_index >= v_count/u);
  assert.match(
    proposal,
    /on conflict on constraint novelight_ai_chunk_claims_pkey do nothing/u
  );
  assert.match(
    proposal,
    /revoke all on function public\.novelight_ai_checkpoint_claim_once_v1/u
  );
  assert.match(proposal, /to service_role;\s*commit;/u);
  assert.doesNotMatch(
    proposal,
    /create or replace function public\.novelight_ai_checkpoint_cas_v1/u
  );
  assert.doesNotMatch(
    proposal,
    /(?:delete|truncate) from public\.novelight_ai_chunk_claims/u
  );
  assert.match(proposal, /Unknown outcome:/u);
});

// Models a UNIQUE constraint conflict as a single atomic Map insertion.
// This is NOT evidence for Postgres transactions, locks or RPC privileges.
// prettier-ignore
function syntheticClient({ forcedClaimResult, owner = OWNER, body = TEXT } = {}) {
  let row = null;
  const claims = new Set();
  const state = { claims: 0, routerCalls: 0, stageCalls: 0 };
  const client = {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (table === 'novels') {
            return { data: { id: 41, user_id: owner }, error: null };
          }
          if (table === 'episodes') {
            return {
              data: { id: 11, novel_id: 41, title: '第一話', content: body },
              error: null
            };
          }
          if (table === 'novelight_ai_episode_analysis') {
            return { data: row, error: null };
          }
          throw new Error('Unexpected table');
        }
      };
    },
    async rpc(name, p) {
      if (name === 'novelight_ai_checkpoint_claim_once_v1') {
        state.claims += 1;
        if (forcedClaimResult === 'unknown') {
          return { data: null, error: { code: 'TIMEOUT' } };
        }
        if (forcedClaimResult === 'false') {
          return { data: false, error: null };
        }
        // Simulate the sole atomic INSERT under a unique key.
        const key = [
          p.p_actor_id,
          p.p_novel_id,
          p.p_episode_id,
          p.p_source_hash,
          p.p_fingerprint,
          p.p_chunk_index
        ].join(':');
        if (claims.has(key)) return { data: false, error: null };
        claims.add(key);
        return { data: true, error: null };
      }
      if (name === 'novelight_ai_checkpoint_cas_v1') {
        if (
          p.p_expected_revision !== (row?.revision ?? null) ||
          p.p_expected_source_hash !== (row?.source_hash ?? null)
        ) {
          return { data: [], error: null };
        }
        row = {
          episode_id: 11,
          revision: (row?.revision ?? 0) + 1,
          source_hash: p.p_next_source_hash,
          summary: { novelightPhase2: p.p_next_progress }
        };
        return { data: [JSON.parse(JSON.stringify(row))], error: null };
      }
      throw new Error('Unexpected RPC');
    }
  };
  const checkpoint = createOfflineOwnerNovelBibleCheckpoint({
    enabled: true,
    repository: createSupabaseOwnerNovelBibleCheckpointRepository({
      serviceClient: client
    }),
    atomicAdmissionEnabled: true
  });
  const bridge = createOwnerNovelBibleModelBridge({
    enabled: true,
    externalProcessingApproved: true,
    ownerId: OWNER,
    authClient: {
      auth: {
        async getUser() {
          return { data: { user: { id: OWNER } }, error: null };
        }
      }
    },
    serviceClient: client,
    permissionCheck: async () => true,
    aiRouter: {
      async run(options) {
        state.routerCalls += 1; // Includes budget reservation and provider entry.
        const excerpt = JSON.parse(options.user).untrusted_excerpt;
        return {
          text: JSON.stringify({
            suggestions: [
              {
                kind: 'character',
                key: '凛',
                summary: '青い鍵を持つ。',
                evidence: excerpt
              }
            ]
          })
        };
      }
    },
    reviewWorkflow: {
      async stage() {
        state.stageCalls += 1;
        return { novelId: 41, stagedCount: 1 };
      }
    },
    checkpoint
  });
  return { bridge, checkpoint, client, state, claims };
}

// prettier-ignore
const stage = (bridge) =>
  bridge.stage({
    token: TOKEN,
    novelId: 41,
    episodeId: 11,
    chunkIndex: 0
  });

// prettier-ignore
test('two simultaneous requests enter Router/provider at most once', async () => {
  const { bridge, state } = syntheticClient();
  const results = await Promise.allSettled([stage(bridge), stage(bridge)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(state.routerCalls, 1);
  assert.equal(state.stageCalls, 1);
  assert.equal(state.claims, 2);
  await stage(bridge); // Completed journal must not invoke the provider again.
  assert.equal(state.routerCalls, 1);
});

// prettier-ignore
test('duplicate and unknown claims block Router and model', async () => {
  for (const result of ['false', 'unknown']) {
    const { bridge, state } = syntheticClient({ forcedClaimResult: result });
    await assert.rejects(
      stage(bridge),
      /AI_BIBLE_CHECKPOINT_(?:CONFLICT|UNAVAILABLE)/u
    );
    assert.equal(state.routerCalls, 0);
    assert.equal(state.stageCalls, 0);
    assert.equal(state.claims, 1);
  }
});

// prettier-ignore
test('owner mismatch and invalid chunk index cannot enter Router', async () => {
  const foreign = syntheticClient({ owner: OTHER });
  await assert.rejects(
    stage(foreign.bridge),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(foreign.state.claims, 0);
  assert.equal(foreign.state.routerCalls, 0);

  const edited = syntheticClient({ body: '' });
  await assert.rejects(
    edited.bridge.stage({
      token: TOKEN,
      novelId: 41,
      episodeId: 11,
      chunkIndex: 8
    }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(edited.state.routerCalls, 0);

  const client = syntheticClient({ forcedClaimResult: 'false' });
  await assert.rejects(
    client.bridge.stage({
      token: TOKEN,
      novelId: 41,
      episodeId: 11,
      chunkIndex: -1
    }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(client.state.routerCalls, 0);
});

// prettier-ignore
test('unknown RPC outcome is not automatically replayed', async () => {
  const { client, state, bridge } = syntheticClient({
    forcedClaimResult: 'unknown'
  });
  await assert.rejects(stage(bridge), /AI_BIBLE_CHECKPOINT_UNAVAILABLE/u);
  assert.equal(state.claims, 1);
  assert.equal(state.routerCalls, 0);
  // A second read is allowed for reconciliation, but not a paid retry.
  assert.equal(typeof client.rpc, 'function');
});
