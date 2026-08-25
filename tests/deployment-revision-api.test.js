import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../api/deployment-revision.js';

function createResponse() {
  const state = { statusCode: null, body: null, headers: {} };

  return {
    state,
    res: {
      setHeader(name, value) {
        state.headers[name] = value;
      },
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      }
    }
  };
}

function withCommitSha(value, callback) {
  const previous = process.env.VERCEL_GIT_COMMIT_SHA;
  if (value === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = value;

  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previous;
  }
}

test('returns the Vercel Git commit SHA for GET requests', () => {
  const commitSha = '1234567890abcdef1234567890abcdef12345678';
  const { state, res } = createResponse();

  withCommitSha(commitSha, () => handler({ method: 'GET' }, res));

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { commitSha });
  assert.equal(state.headers['Cache-Control'], 'no-store, max-age=0');
});

test('fails closed when the deployment revision is unavailable', () => {
  const { state, res } = createResponse();

  withCommitSha(undefined, () => handler({ method: 'GET' }, res));

  assert.equal(state.statusCode, 503);
  assert.deepEqual(state.body, { error: 'Deployment revision unavailable' });
});

test('rejects non-GET methods', () => {
  const { state, res } = createResponse();

  withCommitSha('1234567890abcdef1234567890abcdef12345678', () =>
    handler({ method: 'POST' }, res)
  );

  assert.equal(state.statusCode, 405);
  assert.deepEqual(state.body, { error: 'Method not allowed' });
});
