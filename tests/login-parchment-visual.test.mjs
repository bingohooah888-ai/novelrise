import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const login = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
const css = fs.readFileSync(
  path.join(root, 'novelight-login-parchment.css'),
  'utf8'
);

test(
  'login loads the parchment visual layer without replacing auth wiring',
  () => {
    assert.ok(login.includes('href="novelight-login-parchment.css"'));
    assert.ok(login.includes('id="loginForm"'));
    assert.ok(login.includes('function safeRedirectTarget(raw)'));
    assert.ok(
      login.includes('supabaseClient.auth.signInWithPassword({email,password})')
    );
  }
);

test(
  'login parchment styling keeps the approved palette and fixes header sizing',
  () => {
    assert.ok(css.includes('#f1e5c9'));
    assert.ok(css.includes('#e6d3ad'));
    assert.ok(css.includes('#dcc294'));
    assert.ok(css.includes('#3a2618'));
    assert.ok(css.includes('header.site-header'));
    assert.ok(css.includes('height: auto !important'));
    assert.ok(css.includes('linear-gradient(135deg, #4b3021, #745034)'));
  }
);
