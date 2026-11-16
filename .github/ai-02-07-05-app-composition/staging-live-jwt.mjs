// AI 02-07-05: real synthetic Auth/JWT, RLS, CAS, claim evidence adapter.
// This is a dormant trusted-runner dependency; no CLI or import-time I/O.
// Every mutation is scoped to one fixed reserved Staging fixture and two
// independently verified synthetic Auth users. Never delete claim tombstones.
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { verifyStagingMigrationTarget } from '../../scripts/verify-staging-migration-target.mjs';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + REF + '.supabase.co';
const NOVEL = 998892071;
const CLAIM_NOVEL = 998892074; // disposable proof only, tombstone retained
const EPISODE = 998892072; // reserved for the eventual protected provider
const CLAIM_EPISODE = 998892073; // distinct: proof never spends paid chunk
const TITLE = 'NOVELIGHT合成試験';
const CONTENT = '架空の主人公が青い鍵を拾った。';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT = createHash('sha256').update('novelight-ai-020705-synthetic-claim').digest('hex');
const CHUNK_HASH = createHash('sha256').update(CONTENT).digest('hex');
const SOURCE = createHash('sha256').update(JSON.stringify([TITLE, CONTENT])).digest('hex');

function deny() { throw new Error('AI_020705_STAGING_JWT_DENIED'); }
function serviceReady(client) {
  return client && typeof client.auth?.admin?.createUser === 'function' &&
    typeof client.auth?.admin?.getUserById === 'function' &&
    typeof client.auth?.admin?.deleteUser === 'function' &&
    typeof client.auth?.getClaims === 'function' &&
    typeof client.rpc === 'function' && typeof client.from === 'function';
}

export function create020705StagingJwtAdapter({
  scope,
  connectionString,
  secretKey,
  publishableKey,
  serviceClient = createClient(URL, secretKey ?? '', {
    auth: { autoRefreshToken: false, persistSession: false }
  }),
  authorClient = createClient(URL, publishableKey ?? '', {
    auth: { autoRefreshToken: false, persistSession: false }
  }),
  outsiderClient = createClient(URL, publishableKey ?? '', {
    auth: { autoRefreshToken: false, persistSession: false }
  }),
  dbFactory = () => new pg.Client({
    connectionString, ssl: { rejectUnauthorized: true },
    application_name: 'novelight_ai_020705_jwt_proof'
  })
} = {}) {
  if (scope?.stagingProjectRef !== REF ||
      scope?.supabaseUrl !== URL ||
      scope?.prNumber !== 2895 ||
      scope?.maxPaidCalls !== 1 ||
      typeof connectionString !== 'string' ||
      typeof secretKey !== 'string' || secretKey.length < 16 ||
      typeof publishableKey !== 'string' ||
      !publishableKey.startsWith('sb_publishable_') ||
      !serviceReady(serviceClient) ||
      typeof authorClient.auth?.signInWithPassword !== 'function' ||
      typeof authorClient.auth?.signOut !== 'function' ||
      typeof outsiderClient.auth?.signInWithPassword !== 'function' ||
      typeof dbFactory !== 'function') deny();
  try {
    verifyStagingMigrationTarget({
      STAGING_SUPABASE_URL: URL,
      STAGING_DATABASE_URL: connectionString,
      PGSSLMODE: 'require'
    });
  } catch { deny(); }

  let attempted = false;
  let ownerId = null;
  let outsiderId = null;
  let ownerEmail = null;
  let outsiderEmail = null;
  let ownerPassword = null;
  let outsiderPassword = null;
  let createdNovel = false;
  let createdClaimNovel = false;
  let paidApproved = false;
  let client = null;

  async function database(statement, args = []) {
    if (!client) deny();
    return client.query(statement, args);
  }
  async function ensureEmptyFixture() {
    const state = await database(
      'select (select count(*)::integer from public.novels where id in ($1,$4)) as novels, ' +
      '(select count(*)::integer from public.episodes where id in ($2,$3)) as episodes',
      [NOVEL, EPISODE, CLAIM_EPISODE, CLAIM_NOVEL]
    );
    if (state.rows?.length !== 1 ||
        state.rows[0].novels !== 0 ||
        state.rows[0].episodes !== 0) deny();
  }

  async function createSynthetic(email, password) {
    const r = await serviceClient.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { internal_e2e: true }
    });
    const user = r?.data?.user;
    if (user && UUID.test(user.id ?? '') &&
        user.email === email &&
        user.app_metadata?.internal_e2e === true) return user.id;
    deny();
  }

  async function assertSynthetic(id, email) {
    if (!UUID.test(id ?? '') || typeof email !== 'string' ||
        !email.startsWith('novelight-ai-020705-')) deny();
    const res = await serviceClient.auth.admin.getUserById(id);
    if (res?.error || res.data?.user?.id !== id ||
        res.data.user.email !== email ||
        res.data.user.app_metadata?.internal_e2e !== true) deny();
  }

  async function cleanUser(id, email) {
    if (!id) return;
    await assertSynthetic(id, email);
    const r = await serviceClient.auth.admin.deleteUser(id);
    if (r?.error) deny();
  }

  async function cleanupOnFailure() {
    // Directly verify exact fixture ownership; never remove another work.
    if (createdNovel) {
      const check = await database(
        'select user_id::text from public.novels where id=$1',
        [NOVEL]
      );
      if (check.rows?.length !== 1 || check.rows[0].user_id !== ownerId)
        deny();
      await database('delete from public.novels where id=$1 and user_id=$2', [
        NOVEL, ownerId
      ]);
      createdNovel = false;
    }
    if (createdClaimNovel) {
      const check = await database(
        'select user_id::text from public.novels where id=$1',
        [CLAIM_NOVEL]
      );
      if (check.rows?.length !== 1 || check.rows[0].user_id !== ownerId)
        deny();
      await database('delete from public.novels where id=$1 and user_id=$2', [
        CLAIM_NOVEL, ownerId
      ]);
      createdClaimNovel = false;
    }
    // Synthetic test replay claims are permanently retained by design.
    // These user deletions never touch rows in novelight_ai_chunk_claims.
    if (outsiderId) await cleanUser(outsiderId, outsiderEmail);
    if (ownerId) await cleanUser(ownerId, ownerEmail);
  }

  async function runSyntheticJwtProof() {
    if (attempted) deny();
    attempted = true;
    let validated = false;
    try {
      client = dbFactory();
      await client.connect();
      const current = await database(
        'select current_user as db_role, current_database() as db'
      );
      if (current.rows?.[0]?.db !== 'postgres' ||
          current.rows?.[0]?.db_role !== 'postgres') deny();
      await ensureEmptyFixture();

      const stamp = randomBytes(12).toString('hex');
      ownerEmail = 'novelight-ai-020705-owner-' + stamp + '@example.invalid';
      outsiderEmail = 'novelight-ai-020705-other-' + stamp + '@example.invalid';
      ownerPassword = randomBytes(32).toString('hex');
      outsiderPassword = randomBytes(32).toString('hex');
      ownerId = await createSynthetic(ownerEmail, ownerPassword);
      outsiderId = await createSynthetic(outsiderEmail, outsiderPassword);
      await assertSynthetic(ownerId, ownerEmail);
      await assertSynthetic(outsiderId, outsiderEmail);

      await database(
        "insert into public.novels(id,user_id,title,status) values($1,$2,$3,'draft')",
        [NOVEL, ownerId, TITLE]
      );
      createdNovel = true;
      await database(
        "insert into public.novels(id,user_id,title,status) values($1,$2,$3,'draft')",
        [CLAIM_NOVEL, ownerId, TITLE]
      );
      createdClaimNovel = true;
      await database(
        "insert into public.episodes(id,novel_id,user_id,title,content,status) " +
        "values($1,$2,$3,$4,$5,'draft'),($6,$7,$3,$4,$5,'draft')",
        [EPISODE, NOVEL, ownerId, TITLE, CONTENT, CLAIM_EPISODE, CLAIM_NOVEL]
      );

      const owner = await authorClient.auth.signInWithPassword({
        email: ownerEmail, password: ownerPassword
      });
      const outsider = await outsiderClient.auth.signInWithPassword({
        email: outsiderEmail, password: outsiderPassword
      });
      const token = owner?.data?.session?.access_token;
      if (owner?.error || outsider?.error ||
          typeof token !== 'string' || token.length < 60 ||
          owner.data?.user?.id !== ownerId ||
          outsider.data?.user?.id !== outsiderId) deny();

      const claims = await serviceClient.auth.getClaims(token);
      const sessionId = claims?.data?.claims?.session_id;
      if (claims.error || claims.data?.claims?.sub !== ownerId ||
          !UUID.test(sessionId ?? '')) deny();
      const active = await serviceClient.rpc(
        'novelight_ai_owner_session_exists_v1',
        { p_session_id: sessionId, p_actor_id: ownerId }
      );
      if (active.error || active.data !== true) deny();

      const saved = await serviceClient.rpc(
        'novelight_ai_owner_review_state_cas',
        {
          p_actor_id: ownerId, p_novel_id: NOVEL,
          p_session_id: sessionId,
          p_expected_revision: 0,
          p_reviewed_ids: []
        }
      );
      if (saved.error || saved.data?.length !== 1 ||
          saved.data[0]?.revision !== 1) deny();
      const foreign = await outsiderClient
        .from('novelight_ai_owner_review_states')
        .select('actor_id,novel_id').eq('novel_id', NOVEL);
      if (foreign.error || foreign.data?.length !== 0) deny();
      const outsiderToken = outsider?.data?.session?.access_token;
      if (typeof outsiderToken !== 'string') deny();
      const outsiderClaims = await serviceClient.auth.getClaims(outsiderToken);
      const outsiderSessionId = outsiderClaims?.data?.claims?.session_id;
      if (outsiderClaims?.error ||
          outsiderClaims?.data?.claims?.sub !== outsiderId ||
          !UUID.test(outsiderSessionId ?? '')) deny();
      const wrongOwnerCas = await serviceClient.rpc(
        'novelight_ai_owner_review_state_cas',
        {
          p_actor_id: outsiderId, p_novel_id: NOVEL,
          p_session_id: outsiderSessionId,
          p_expected_revision: 0, p_reviewed_ids: []
        }
      );
      if (!wrongOwnerCas.error && wrongOwnerCas.data?.length) deny();
      const conflict = await serviceClient.rpc(
        'novelight_ai_owner_review_state_cas',
        {
          p_actor_id: ownerId, p_novel_id: NOVEL,
          p_session_id: sessionId,
          p_expected_revision: 0,
          p_reviewed_ids: []
        }
      );
      if (conflict.error || conflict.data?.length !== 0) deny();

      const claimArgs = {
        p_actor_id: ownerId, p_novel_id: CLAIM_NOVEL,
        p_episode_id: CLAIM_EPISODE,
        p_source_hash: SOURCE,
        p_previous_source_hash: null,
        p_fingerprint: FINGERPRINT, p_chunk_index: 0,
        p_chunk_hash: CHUNK_HASH
      };
      const once = await serviceClient.rpc(
        'novelight_ai_checkpoint_claim_once_v1', claimArgs
      );
      const replay = await serviceClient.rpc(
        'novelight_ai_checkpoint_claim_once_v1', claimArgs
      );
      if (once.error || once.data !== true ||
          replay.error || replay.data !== false) deny();

      const signOut = await authorClient.auth.signOut();
      if (signOut.error) deny();
      const revoked = await serviceClient.rpc(
        'novelight_ai_owner_session_exists_v1',
        { p_session_id: sessionId, p_actor_id: ownerId }
      );
      if (revoked.error || revoked.data !== false) deny();
      const revokedSave = await serviceClient.rpc(
        'novelight_ai_owner_review_state_cas',
        {
          p_actor_id: ownerId, p_novel_id: NOVEL,
          p_session_id: sessionId,
          p_expected_revision: 1,
          p_reviewed_ids: []
        }
      );
      if (!revokedSave.error && revokedSave.data?.length) deny();

      // The claim test's own novel is removed; its journal stays immutable.
      const claimOwner = await database(
        'select user_id::text from public.novels where id=$1',
        [CLAIM_NOVEL]
      );
      if (claimOwner.rows?.length !== 1 ||
          claimOwner.rows[0].user_id !== ownerId) deny();
      await database('delete from public.novels where id=$1 and user_id=$2', [
        CLAIM_NOVEL, ownerId
      ]);
      createdClaimNovel = false;
      // Remove the second synthetic identity immediately; the protected
      // single-call cleanup handles only the OWNER and their reserved novel.
      await cleanUser(outsiderId, outsiderEmail);
      outsiderId = null;
      await assertSynthetic(ownerId, ownerEmail);
      paidApproved = true;
      validated = true;
      return Object.freeze({
        verifiedSynthetic: true,
        realSignedJwt: true, ownerOnly: true,
        rlsDeniedOtherActor: true, revokedSessionDenied: true,
        casConflictDenied: true, claimOnceDeniedReplay: true,
        stagingProjectRef: REF,
        candidateSha: scope.candidateSha,
        actorId: ownerId, novelId: NOVEL, episodeId: EPISODE,
        claimEpisodeId: CLAIM_EPISODE
      });
    } catch {
      deny();
    } finally {
      if (!validated) {
        try { await cleanupOnFailure(); } catch { /* original denial stands */ }
      }
    }
  }

  // Called only after the future protected paid runner confirms it has
  // separately killed the model route and completed its own scoped cleanup.
  async function finalCensus() {
    if (!paidApproved || !client) deny();
    const result = await database(
      'select (select count(*)::integer from auth.users where id=$1) as users, ' +
      '(select count(*)::integer from public.novels where id in ($2,$5)) as novels, ' +
      '(select count(*)::integer from public.episodes where id in ($3,$4)) as episodes, ' +
      '(select count(*)::integer from public.novelight_ai_chunk_claims ' +
      ' where actor_id=$1 and novel_id=$5) as proof_claims, ' +
      '(select count(*)::integer from public.novelight_ai_chunk_claims ' +
      ' where actor_id=$1 and novel_id=$2) as paid_claims',
      [ownerId, NOVEL, EPISODE, CLAIM_EPISODE, CLAIM_NOVEL]
    );
    const row = result.rows?.[0];
    if (!row || row.users !== 0 || row.novels !== 0 ||
        row.episodes !== 0 || row.proof_claims !== 1 ||
        ![0,1].includes(row.paid_claims)) deny();
    return true;
  }

  async function emergencyCleanup() {
    if (!client) deny();
    await cleanupOnFailure();
    paidApproved = false;
    return true;
  }

  async function close() {
    if (client) { await client.end(); client = null; }
  }
  return Object.freeze({
    runSyntheticJwtProof,
    emergencyCleanup,
    finalCensus,
    close,
    get synthetic() {
      if (!paidApproved) deny();
      return Object.freeze({
        verifiedSynthetic: true,
        projectRef: REF,
        supabaseUrl: URL,
        userId: ownerId,
        novelId: NOVEL,
        approvalCommentId: scope.approvalCommentId
      });
    }
  });
}
