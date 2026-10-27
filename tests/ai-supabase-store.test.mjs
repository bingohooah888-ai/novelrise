import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiStorageError,
  createSupabaseAiBudget,
  createSupabaseAiAudit,
  createSupabaseAiBible
} from '../api/_lib/ai/supabase-store.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REQUEST = 'a'.repeat(64);
const RESERVATION = '33333333-3333-4333-8333-333333333333';

function mockClient({ rpcResult, authorId = OWNER, onInsert } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return rpcResult?.(name, args) ?? { data: RESERVATION, error: null };
    },
    from(table) {
      const current = { table };
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          current[key] = value;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [], error: null });
        },
        async maybeSingle() {
          if (table === 'novels') {
            return { data: { id: 17, user_id: authorId }, error: null };
          }
          return { data: { id: 18, novel_id: 17 }, error: null };
        },
        insert(value) {
          calls.push({ table, inserted: value });
          const result = onInsert?.(table, value) ?? {
            data: { id: 9, revision: 1, provenance: 'ai_inferred' },
            error: null
          };
          return {
            select() {
              return {
                async single() {
                  return result;
                }
              };
            },
            then(resolve) {
              return Promise.resolve(result).then(resolve);
            }
          };
        }
      };
      return query;
    }
  };
}

test('usage adapter sends only allowlisted fields to service-only RPC', async () => {
  const client = mockClient({
    rpcResult(name) {
      return name === 'novelight_ai_reserve_usage'
        ? { data: RESERVATION, error: null }
        : { data: true, error: null };
    }
  });
  const store = createSupabaseAiBudget({ serviceClient: client });
  const result = await store.reserve({
    actorId: OWNER,
    featureKey: 'prepublish-check',
    workId: 17,
    ceilingMicros: 800,
    requestHash: REQUEST
  });
  assert.deepEqual(result, { id: RESERVATION });
  await store.settle({ reservationId: RESERVATION, chargedMicros: 200 });
  assert.deepEqual(
    client.calls.map((call) => call.name),
    ['novelight_ai_reserve_usage', 'novelight_ai_settle_usage']
  );
  assert.equal(client.calls[0].args.p_ceiling_micros, 800);
  assert.equal(client.calls[1].args.p_charged_micros, 200);
});

test('kill switch and missing RPC fail closed', async () => {
  const disabled = createSupabaseAiBudget({
    serviceClient: mockClient({
      rpcResult: () => ({ data: null, error: null })
    })
  });
  assert.equal(
    await disabled.reserve({
      actorId: OWNER,
      featureKey: 'prepublish-check',
      workId: null,
      ceilingMicros: 20,
      requestHash: REQUEST
    }),
    null
  );
  const broken = createSupabaseAiBudget({
    serviceClient: mockClient({
      rpcResult: () => ({ data: null, error: { code: 'PGRST202' } })
    })
  });
  await assert.rejects(
    broken.reserve({
      actorId: OWNER,
      featureKey: 'prepublish-check',
      workId: 17,
      ceilingMicros: 20,
      requestHash: REQUEST
    }),
    AiStorageError
  );
});

test('invalid feature, invalid identity and settlement never contact database', async () => {
  const client = mockClient();
  const store = createSupabaseAiBudget({ serviceClient: client });
  await assert.rejects(
    store.reserve({
      actorId: OWNER,
      featureKey: 'no-such-ai-feature',
      workId: null,
      ceilingMicros: 20,
      requestHash: REQUEST
    }),
    /AI_FEATURE_NOT_APPROVED/
  );
  await assert.rejects(
    store.reserve({
      actorId: 'fabricated-author',
      featureKey: 'prepublish-check',
      workId: null,
      ceilingMicros: 20,
      requestHash: REQUEST
    }),
    /AI_INVALID_IDENTITY/
  );
  await assert.rejects(
    store.settle({ reservationId: RESERVATION, chargedMicros: -1 }),
    /AI_INVALID_SETTLEMENT/
  );
  assert.equal(client.calls.length, 0);
});

test('AI audit records no prompts, story content, or generated output', async () => {
  const client = mockClient();
  const audit = createSupabaseAiAudit({ serviceClient: client });
  await audit.record({
    actorId: OWNER,
    workId: 17,
    featureKey: 'prepublish-check',
    provider: 'mock',
    model: 'mock',
    chargedMicros: 2,
    cacheHit: false,
    outcome: 'success',
    user: 'PRIVATE DRAFT',
    system: 'SECRET',
    text: 'MODEL OUTPUT'
  });
  const result = JSON.stringify(client.calls);
  assert.doesNotMatch(result, /PRIVATE DRAFT|SECRET|MODEL OUTPUT/);
  assert.match(result, /novelight_ai_usage_audit/);
});

test('Novel Bible rejects another author before any private fact lookup', async () => {
  const client = mockClient();
  const bible = createSupabaseAiBible({ serviceClient: client });
  await assert.rejects(
    bible.listOwnerFacts({ actorId: OTHER, novelId: 17 }),
    /AI_ACCESS_DENIED/
  );
  assert.equal(
    client.calls.some((call) => call.table === 'novelight_ai_bible_facts'),
    false
  );
});

test('AI inference never overwrites an existing confirmed fact', async () => {
  const client = mockClient({
    onInsert(table) {
      if (table === 'novelight_ai_bible_facts') {
        return {
          data: null,
          error: { code: '23505', message: 'unique constraint' }
        };
      }
      return undefined;
    }
  });
  const bible = createSupabaseAiBible({ serviceClient: client });
  const result = await bible.saveAiInference({
    actorId: OWNER,
    novelId: 17,
    episodeId: 18,
    kind: 'world',
    key: 'location',
    payload: { name: 'Arden' },
    sourceHash: REQUEST
  });
  assert.deepEqual(result, { unchanged: true });
  const inserted = client.calls.find(
    (call) => call.table === 'novelight_ai_bible_facts'
  );
  assert.equal(inserted.inserted.provenance, 'ai_inferred');
  assert.equal(
    client.calls.some((call) => call.updated),
    false
  );
});

test('Novel Bible rejects cross-work episode source before creating a fact', async () => {
  const client = mockClient({ authorId: OWNER });
  client.from = (function (base) {
    return function (table) {
      if (table !== 'episodes') return base(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: { id: 18, novel_id: 99 }, error: null };
        }
      };
    };
  })(client.from);
  const bible = createSupabaseAiBible({ serviceClient: client });
  await assert.rejects(
    bible.saveAiInference({
      actorId: OWNER,
      novelId: 17,
      episodeId: 18,
      kind: 'world',
      key: 'planet',
      payload: { id: 1 },
      sourceHash: REQUEST
    }),
    /AI_ACCESS_DENIED/
  );
});


function ownerCanonClient({
  ownerId = OWNER,
  characters = [],
  notes = [],
  failTable = null
} = {}) {
  const calls = [];
  return {
    calls,
    rpc() { throw new Error('no rpc calls expected'); },
    from(table) {
      const query = {
        select(fields) { calls.push({ table, fields }); return query; },
        eq(key, value) { calls.push({ table, key, value }); return query; },
        order() { return query; },
        async limit(limit) {
          calls.push({ table, limit });
          return {
            data: table === 'novel_characters' ? characters : notes,
            error: table === failTable ? { code: '42501' } : null
          };
        },
        async maybeSingle() {
          calls.push({ table, single: true });
          return {
            data: { id: 17, user_id: ownerId },
            error: table === failTable ? { code: '42501' } : null
          };
        }
      };
      return query;
    }
  };
}

test('owner-only Novel Bible canon reads the existing private tables safely', async () => {
  const client = ownerCanonClient({
    characters: [
      { id: 3, novel_id: 17, name: 'Hero', aliases: ['Alias'] }
    ],
    notes: [{
      id: 8, novel_id: 17, note_type: 'character',
      character_id: 3, title: 'Backstory', body: 'Private plot'
    }]
  });
  const bible = createSupabaseAiBible({ serviceClient: client });
  const view = await bible.listOwnerCanon({ actorId: OWNER, novelId: 17 });
  assert.equal(view.characters[0].name, 'Hero');
  assert.equal(view.notes[0].body, 'Private plot');
  assert.deepEqual(
    client.calls.filter(x => x.limit).map(x => [x.table, x.limit]),
    [['novel_characters', 101], ['novel_private_story_notes', 201]]
  );
  assert.deepEqual(
    client.calls.filter(x => x.key === 'novel_id').map(x => x.value),
    [17, 17]
  );
  assert.equal(client.calls.some(x => x.inserted || x.updated), false);
});

test('owner check denies other authors before touching private notes', async () => {
  const client = ownerCanonClient();
  const bible = createSupabaseAiBible({ serviceClient: client });
  await assert.rejects(
    bible.listOwnerCanon({ actorId: OTHER, novelId: 17 }),
    /AI_ACCESS_DENIED/
  );
  assert.equal(
    client.calls.some(x =>
      x.table === 'novel_characters' || x.table === 'novel_private_story_notes'
    ),
    false
  );
});

test('partial read failure and forged cross-work canon are fail-closed', async () => {
  const storageFailure = ownerCanonClient({ failTable: 'novel_private_story_notes' });
  await assert.rejects(
    createSupabaseAiBible({ serviceClient: storageFailure })
      .listOwnerCanon({ actorId: OWNER, novelId: 17 }),
    AiStorageError
  );
  const mismatch = ownerCanonClient({
    characters: [{ id: 1, novel_id: 99, name: 'Foreign', aliases: [] }]
  });
  await assert.rejects(
    createSupabaseAiBible({ serviceClient: mismatch })
      .listOwnerCanon({ actorId: OWNER, novelId: 17 }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
});
