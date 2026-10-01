import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChatGptPage,
  extractPluginId,
  isAllowedChatGptUrl,
  normalizePluginName
} from '../src/chatgpt-plugin-bootstrap.js';

test('extractPluginId finds personal plugin technical IDs', () => {
  assert.equal(
    extractPluginId('https://chatgpt.com/plugins/plugin_asdk_app_abcd1234/details'),
    'plugin_asdk_app_abcd1234'
  );
  assert.equal(extractPluginId('https://chatgpt.com/plugins'), null);
});

test('ChatGPT URL guard only accepts chatgpt.com HTTPS', () => {
  assert.equal(isAllowedChatGptUrl('https://chatgpt.com/plugins'), true);
  assert.equal(isAllowedChatGptUrl('http://chatgpt.com/plugins'), false);
  assert.equal(isAllowedChatGptUrl('https://evil.example/chatgpt.com'), false);
});

test('login surfaces are detected without reading credentials', () => {
  assert.equal(
    classifyChatGptPage({
      url: 'https://chatgpt.com/auth/login',
      bodyText: 'Log in Sign up'
    }),
    'login_required'
  );
});

test('plugin names are bounded and newline-free', () => {
  assert.equal(normalizePluginName(' NOVELIGHT NLO '), 'NOVELIGHT NLO');
  assert.throws(() => normalizePluginName('bad\nname'));
});
