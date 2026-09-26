import assert from 'node:assert/strict';
import test from 'node:test';

import { createXserverDnsActions } from '../tools/novelight-commander/src/xserver-dns.js';

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

test('xserver dns preview bootstraps a missing CLI profile with local masked login', async () => {
  const calls = [];
  let loginStarted = 0;
  let dnsLists = 0;

  const actions = createXserverDnsActions({
    env: {},
    platform: 'win32',
    interactiveAuthLauncher: async () => {
      loginStarted += 1;
    },
    cliRunner: async args => {
      calls.push(args);
      if (args.includes('auth') && args.includes('status')) {
        return { code: 0, stdout: '{}', stderr: '' };
      }
      if (args.includes('list')) {
        dnsLists += 1;
        if (dnsLists === 1) {
          return {
            code: 1,
            stdout: '',
            stderr:
              '認証設定が見つかりません。`xserver auth login` を実行してください。'
          };
        }
        return { code: 0, stdout: JSON.stringify({ records: [] }), stderr: '' };
      }
      throw new Error('Unexpected CLI args: ' + JSON.stringify(args));
    }
  });

  const result = await actions.preview({ args: TARGET_ARGS });

  assert.equal(loginStarted, 1);
  assert.match(result, /xserver_authenticated: true/);
  assert.match(result, /credential_source: cli_profile/);
  assert.match(result, /would_add: true/);
  assert.match(result, /secret_value_exposed: false/);
  assert.equal(calls.length, 3);
});
