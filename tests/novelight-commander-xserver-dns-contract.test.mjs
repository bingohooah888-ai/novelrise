import assert from 'node:assert/strict';
import test from 'node:test';

import { createXserverDnsActions } from '../tools/novelight-commander/src/xserver-dns.js';

// These tests intentionally pin NLO to one add-only NOVELIGHT inbound MX change.
const TARGET_ARGS = {
  domain: 'novelight.jp',
  record: {
    type: 'MX',
    name: '@',
    value: 'inbound-smtp.ap-northeast-1.amazonaws.com',
    priority: 10,
    ttl: 'default'
  },
  constraints: {
    add_only: true,
    do_not_modify_existing: true,
    do_not_delete_existing: true
  }
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

test('xserver dns preview is restricted to the approved NOVELIGHT MX record', async () => {
  const actions = createXserverDnsActions({
    env: { NOVELIGHT_XSERVER_API_KEY: 'xs_test_key' },
    fetchImpl: async () => response(200, { records: [] })
  });

  await assert.rejects(
    actions.preview({
      args: { ...TARGET_ARGS, domain: 'example.com' }
    }),
    /restricted to novelight[.]jp/
  );

  await assert.rejects(
    actions.preview({
      args: {
        ...TARGET_ARGS,
        record: { ...TARGET_ARGS.record, type: 'TXT' }
      }
    }),
    /restricted to the approved NOVELIGHT Resend inbound MX record/
  );
});

test('xserver dns preview never mutates DNS', async () => {
  const calls = [];
  const actions = createXserverDnsActions({
    env: { NOVELIGHT_XSERVER_API_KEY: 'xs_test_key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, { records: [] });
    }
  });

  const result = await actions.preview({ args: TARGET_ARGS });
  assert.match(result, /would_add: true/);
  assert.match(result, /mutation_performed: false/);
  assert.match(result, /credential_source: environment/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(
    calls[0].url,
    'https://api.xserver.ne.jp/v1/domain/novelight.jp/dns'
  );
  assert.equal(calls[0].init.headers.Authorization, 'Bearer xs_test_key');
});

test(
  'xserver dns preview falls back to the official CLI profile without exposing credentials',
  async () => {
    const calls = [];
    const actions = createXserverDnsActions({
      env: {},
      cliRunner: async (args) => {
        calls.push(args);
        return {
          code: 0,
          stdout: JSON.stringify({ records: [] }),
          stderr: ''
        };
      }
    });

    const result = await actions.preview({ args: TARGET_ARGS });
    assert.match(result, /xserver_authenticated: true/);
    assert.match(result, /credential_source: cli_profile/);
    assert.match(result, /would_add: true/);
    assert.match(result, /secret_value_exposed: false/);
    assert.deepEqual(calls, [
      ['--format', 'json', 'domain', 'dns', 'list', 'novelight.jp']
    ]);
  }
);

test('xserver dns apply requires explicit Production approval', async () => {
  const actions = createXserverDnsActions({
    env: { NOVELIGHT_XSERVER_API_KEY: 'xs_test_key' },
    fetchImpl: async () => response(200, { records: [] })
  });

  await assert.rejects(
    actions.apply({
      args: { ...TARGET_ARGS, approval: 'not_approved' }
    }),
    /requires production_approved approval/
  );
});

test('xserver dns apply blocks when another apex MX already exists', async () => {
  let mutationAttempted = false;
  const actions = createXserverDnsActions({
    env: { NOVELIGHT_XSERVER_API_KEY: 'xs_test_key' },
    fetchImpl: async (_url, init) => {
      if (init.method !== 'GET') mutationAttempted = true;
      return response(200, {
        records: [
          {
            id: 7,
            type: 'MX',
            host: '@',
            content: 'mail.example.net',
            ttl: 3600,
            priority: 10
          }
        ]
      });
    }
  });

  await assert.rejects(
    actions.apply({
      args: { ...TARGET_ARGS, approval: 'production_approved' }
    }),
    /No DNS mutation was performed/
  );
  assert.equal(mutationAttempted, false);
});

test('xserver dns apply adds only the approved MX and verifies it', async () => {
  const calls = [];
  let listed = 0;
  const actions = createXserverDnsActions({
    env: { NOVELIGHT_XSERVER_API_KEY: 'xs_test_key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'GET') {
        listed += 1;
        if (listed === 1) return response(200, { records: [] });
        return response(200, {
          records: [
            {
              id: 42,
              type: 'MX',
              host: '@',
              content: 'inbound-smtp.ap-northeast-1.amazonaws.com',
              ttl: 3600,
              priority: 10
            }
          ]
        });
      }
      return response(200, {
        id: 42,
        message: 'DNSレコードを追加しました'
      });
    }
  });

  const result = await actions.apply({
    args: { ...TARGET_ARGS, approval: 'production_approved' }
  });

  assert.match(result, /record_added: true/);
  assert.match(result, /verified_after_write: true/);
  assert.deepEqual(
    calls.map((call) => call.init.method),
    ['GET', 'POST', 'GET']
  );
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body, {
    type: 'MX',
    host: '@',
    content: 'inbound-smtp.ap-northeast-1.amazonaws.com',
    ttl: 3600,
    priority: 10
  });
});

test('xserver dns apply can use the official CLI profile and verifies after write', async () => {
  const calls = [];
  let listed = 0;
  const actions = createXserverDnsActions({
    env: {},
    cliRunner: async (args) => {
      calls.push(args);
      if (args.includes('list')) {
        listed += 1;
        if (listed === 1) {
          return {
            code: 0,
            stdout: JSON.stringify({ records: [] }),
            stderr: ''
          };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            records: [
              {
                dns_id: 51,
                type: 'MX',
                host: '@',
                content: 'inbound-smtp.ap-northeast-1.amazonaws.com',
                ttl: 3600,
                priority: 10
              }
            ]
          }),
          stderr: ''
        };
      }
      return { code: 0, stdout: JSON.stringify({ id: 51 }), stderr: '' };
    }
  });

  const result = await actions.apply({
    args: { ...TARGET_ARGS, approval: 'production_approved' }
  });

  assert.match(result, /credential_source: cli_profile/);
  assert.match(result, /record_added: true/);
  assert.match(result, /verified_after_write: true/);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], [
    '--format',
    'json',
    'domain',
    'dns',
    'list',
    'novelight.jp'
  ]);
  assert.deepEqual(calls[1], [
    '--format',
    'json',
    '--yes',
    'domain',
    'dns',
    'add',
    'novelight.jp',
    '--host',
    '@',
    '--type',
    'MX',
    '--content',
    'inbound-smtp.ap-northeast-1.amazonaws.com',
    '--ttl',
    '3600',
    '--priority',
    '10'
  ]);
});

test('xserver dns apply is idempotent when the target record already exists', async () => {
  const calls = [];
  const actions = createXserverDnsActions({
    env: { NOVELIGHT_XSERVER_API_KEY: 'xs_test_key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        records: [
          {
            id: 42,
            type: 'MX',
            host: '@',
            content: 'inbound-smtp.ap-northeast-1.amazonaws.com',
            ttl: 3600,
            priority: 10
          }
        ]
      });
    }
  });

  const result = await actions.apply({
    args: { ...TARGET_ARGS, approval: 'production_approved' }
  });

  assert.match(result, /already_present: true/);
  assert.match(result, /record_added: false/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
});
