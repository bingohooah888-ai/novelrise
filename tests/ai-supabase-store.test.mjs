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

function ownerCanonClients({
  ownerId = OWNER,
  characters = [],
  notes = [],
  failRpc = null
} = {}) {
  const calls = [];
  const serviceClient = mockClient({ authorId: ownerId });
  const originalFrom = serviceClient.from;
  serviceClient.from = (table) => {
    calls.push({ table });
    return originalFrom(table);
  };
  const authorClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: name === 'novelight_author_character_list' ? characters : notes,
        error: name === failRpc ? { code: '42501' } : null
      };
    }
  };
  return { serviceClient, authorClient, calls };
}

test('owner-only canon uses the existing authenticated RPCs', async () => {
  const clients = ownerCanonClients({
    characters: [{ id: 3, name: 'Hero', aliases: ['Alias'] }],
    notes: [
      {
        id: 8,
        note_type: 'character',
        character_id: 3,
        title: 'Backstory',
        body: 'Private plot'
      }
    ]
  });
  const bible = createSupabaseAiBible(clients);
  const view = await bible.listOwnerCanon({ actorId: OWNER, novelId: 17 });
  assert.equal(view.characters[0].name, 'Hero');
  assert.equal(view.notes[0].body, 'Private plot');
  assert.deepEqual(
    clients.calls.filter((x) => x.name).map((x) => x.name),
    ['novelight_author_character_list', 'novelight_private_story_notes']
  );
  assert.deepEqual(
    clients.calls.filter((x) => x.name).map((x) => x.args.p_novel_id),
    [17, 17]
  );
  assert.deepEqual(
    clients.calls.filter((x) => x.table).map((x) => x.table),
    ['novels']
  );
});

test('owner check denies strangers before invoking private RPCs', async () => {
  const clients = ownerCanonClients();
  const bible = createSupabaseAiBible(clients);
  await assert.rejects(
    bible.listOwnerCanon({ actorId: OTHER, novelId: 17 }),
    /AI_ACCESS_DENIED/
  );
  assert.equal(
    clients.calls.some((x) => x.name),
    false
  );
});

test('missing author client never uses service-role RPCs', async () => {
  const clients = ownerCanonClients();
  const noAuthor = createSupabaseAiBible({
    serviceClient: clients.serviceClient
  });
  await assert.rejects(
    noAuthor.listOwnerCanon({ actorId: OWNER, novelId: 17 }),
    AiStorageError
  );
  await assert.rejects(
    createSupabaseAiBible({
      serviceClient: clients.serviceClient,
      authorClient: clients.serviceClient
    }).listOwnerCanon({ actorId: OWNER, novelId: 17 }),
    AiStorageError
  );
  assert.equal(
    clients.calls.some((x) => x.name),
    false
  );
});

test('RPC authorization failure and invalid canon are fail-closed', async () => {
  const failed = createSupabaseAiBible(
    ownerCanonClients({ failRpc: 'novelight_private_story_notes' })
  );
  await assert.rejects(
    failed.listOwnerCanon({ actorId: OWNER, novelId: 17 }),
    AiStorageError
  );
  const malformed = createSupabaseAiBible(
    ownerCanonClients({
      characters: [{ id: 1, name: 'Foreign', aliases: [123] }]
    })
  );
  await assert.rejects(
    malformed.listOwnerCanon({ actorId: OWNER, novelId: 17 }),
    /AI_NOVEL_BIBLE_INVALID_SOURCE/
  );
});
