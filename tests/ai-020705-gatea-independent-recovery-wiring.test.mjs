import assert from 'node:assert/strict';
import test from 'node:test';
import { validate020705CensusUrl } from '../.github/ai-02-07-05-app-composition/gatea-independent-census.mjs';
import {
  create020705IndependentRecoveryRunner,
  validate020705RecoveryEnvironment
} from '../.github/ai-02-07-05-app-composition/gatea-independent-recovery-runner.mjs';

const env = {
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_RUN_ID: '9',
  GATEA_ACCESS_ORIGIN:
    'https://novelight-ai-gatea-controller.fixture.workers.dev',
  GATEA_ACCESS_CLIENT_ID: 'fixture.access',
  GATEA_ACCESS_CLIENT_SECRET: 'fixture-only',
  GATEA_CENSUS_DATABASE_URL:
    'postgresql://novelight_gatea_census:fixture@db.wmlzjgvxgoyrovdhbqbg.supabase.co:5432/postgres'
};

test('recovery credentials are scoped to trusted main and fail closed', () => {
  assert.equal(validate020705RecoveryEnvironment(env), true);
  for (const patch of [
    { GATEA_ACCESS_CLIENT_SECRET: '' },
    { GATEA_ACCESS_CLIENT_ID: '' },
    { GATEA_ACCESS_ORIGIN: 'https://other.example' },
    { GATEA_CENSUS_DATABASE_URL: '' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { OPENAI_API_KEY: 'fixture-only' },
    { STAGING_DATABASE_URL: 'fixture-only' }
  ]) {
    assert.throws(
      () => validate020705RecoveryEnvironment({ ...env, ...patch }),
      /INDEPENDENT_RUNNER_NO_GO/u
    );
  }
  assert.throws(
    () => create020705IndependentRecoveryRunner({ env }),
    /INDEPENDENT_RUNNER_NO_GO/u
  );
});

test('census rejects shared STOP and non-Staging credentials', () => {
  assert.equal(validate020705CensusUrl(env.GATEA_CENSUS_DATABASE_URL), true);
  for (const url of [
    env.GATEA_CENSUS_DATABASE_URL.replace('gatea_census', 'gatea_stop'),
    env.GATEA_CENSUS_DATABASE_URL.replace('wmlzjgvxgoyrovdhbqbg', 'other'),
    env.GATEA_CENSUS_DATABASE_URL + '?sslmode=disable'
  ]) {
    assert.throws(
      () => validate020705CensusUrl(url),
      /INDEPENDENT_CENSUS_NO_GO/u
    );
  }
});
