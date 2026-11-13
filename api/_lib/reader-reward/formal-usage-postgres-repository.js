// Future-only PostgreSQL repository for the formal Point usage service.
// No real connection, schema creation, connection string, or API route here.
// A dedicated, OWNER-approved server must inject a restricted pg-like pool.
// The corresponding SQL is docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql.
const TABLE = 'novelight_formal_private';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = new Set(['external_exchange', 'ai_direct_use']);
const PHASES = new Set(['reserved', 'committed', 'released', 'refunded']);
const int = (value, name) => {
  const n =
    typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0)
    throw new TypeError('Invalid formal Point integer: ' + name);
  return n;
};
const uuid = (value) => typeof value === 'string' && UUID.test(value);
function rowWallet(row) {
  if (!row) return null;
  const result = {
    userId: row.user_id,
    availablePoints: int(row.available_points, 'available'),
    exchangeEligiblePoints: int(row.exchange_eligible_points, 'eligible'),
    reservedPoints: int(row.reserved_points, 'reserved'),
    heldPoints: int(row.held_points, 'held'),
    revision: int(row.revision, 'revision')
  };
  if (
    !uuid(result.userId) ||
    result.exchangeEligiblePoints > result.availablePoints
  )
    throw new TypeError('Invalid formal wallet snapshot');
  return result;
}
function rowBudget(row) {
  if (!row) return null;
  const out = {
    scopeId: row.scope_id,
    limitPoints:
      row.limit_points === null ? null : int(row.limit_points, 'budget limit'),
    committedPoints: int(row.committed_points, 'budget committed'),
    reservedPoints: int(row.reserved_points, 'budget reserved'),
    revision: int(row.revision, 'budget revision')
  };
  const tracked = out.committedPoints + out.reservedPoints;
  if (
    typeof out.scopeId !== 'string' ||
    !Number.isSafeInteger(tracked) ||
    (out.limitPoints !== null && tracked > out.limitPoints)
  )
    throw new TypeError('Invalid formal budget snapshot');
  return out;
}
function rowOperation(row) {
  if (!row) return null;
  if (
    !uuid(row.operation_id) ||
    !uuid(row.user_id) ||
    !PURPOSES.has(row.purpose) ||
    !PHASES.has(row.phase)
  )
    throw new TypeError('Invalid formal operation identity');
  return {
    operationId: row.operation_id,
    userId: row.user_id,
    purpose: row.purpose,
    amountPoints: int(row.amount_points, 'operation amount'),
    phase: row.phase,
    featureId: row.feature_id,
    eligibleReservedPoints: int(
      row.eligible_reserved_points,
      'operation eligible allocation'
    ),
    revision: int(row.revision, 'operation revision')
  };
}
function requireOne(result, stage) {
  if (result?.rowCount !== 1)
    throw new Error('FORMAL_USAGE_CONCURRENT_UPDATE_' + stage);
}
export function createFormalUsagePostgresRepository({
  pool,
  readFormalAccount,
  readCanonicalPointHistory,
  canonicalReader
} = {}) {
  if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function')
    throw new TypeError('Injected pg-compatible pool required');
  if (
    typeof readFormalAccount !== 'function' ||
    typeof readCanonicalPointHistory !== 'function'
  )
    throw new TypeError(
      'Approved account and canonical Point history readers required'
    );
  if (typeof canonicalReader?.assertWalletCoherent !== 'function')
    throw new TypeError(
      'Authoritative canonical Point coherence reader required'
    );
  async function transact(userId, callback) {
    if (!uuid(userId) || typeof callback !== 'function')
      throw new TypeError('Verified formal transaction user required');
    const client = await pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN');
      begun = true;
      // Lock wallet, then operation, then budget in a fixed order.
      // All service transitions use this sequence, and the operation primary
      // key prevents cross-user UUID re-use.
      let saved = false;
      const observed = { wallet: null, budget: null, operation: undefined };
      const tx = Object.freeze({
        async getWallet(id) {
          if (id !== userId) return null;
          if (observed.wallet) return { ...observed.wallet };
          const rows = await client.query(
            'select user_id, available_points, exchange_eligible_points, reserved_points, held_points, revision ' +
              'from ' +
              TABLE +
              '.scout_point_usage_wallets where user_id = $1::uuid for update',
            [id]
          );
          observed.wallet = rowWallet(rows?.rows?.[0]);
          if (observed.wallet)
            await canonicalReader.assertWalletCoherent(
              id,
              observed.wallet,
              client.query.bind(client)
            );
          return observed.wallet ? { ...observed.wallet } : null;
        },
        async getBudget(purpose) {
          if (!PURPOSES.has(purpose)) return null;
          if (observed.budget) return { ...observed.budget };
          if (!observed.wallet) throw new Error('FORMAL_WALLET_LOCK_REQUIRED');
          const rows = await client.query(
            'select purpose, scope_id, limit_points, committed_points, reserved_points, revision ' +
              'from ' +
              TABLE +
              '.scout_point_usage_budgets where purpose = $1::text for update',
            [purpose]
          );
          observed.budget = rowBudget(rows?.rows?.[0]);
          return observed.budget ? { ...observed.budget } : null;
        },
        async getOperation(operationId) {
          if (!uuid(operationId))
            throw new TypeError('Operation UUID required');
          if (!observed.wallet) throw new Error('FORMAL_WALLET_LOCK_REQUIRED');
          const rows = await client.query(
            'select operation_id, user_id, purpose, amount_points, phase, feature_id, ' +
              'eligible_reserved_points, revision from ' +
              TABLE +
              '.scout_point_usage_operations where operation_id = $1::uuid for update',
            [operationId]
          );
          const operation = rowOperation(rows?.rows?.[0]);
          if (operation && operation.userId !== userId)
            return {
              operationId,
              userId: operation.userId,
              purpose: operation.purpose,
              amountPoints: operation.amountPoints,
              phase: operation.phase
            };
          observed.operation = operation;
          return operation ? { ...operation } : null;
        },
        async save({ wallet, budget, operation }) {
          if (saved) throw new Error('FORMAL_USAGE_MULTIPLE_SAVES');
          if (
            !observed.wallet ||
            !observed.budget ||
            wallet?.userId !== userId ||
            operation?.userId !== userId ||
            !PURPOSES.has(operation.purpose) ||
            !PHASES.has(operation.phase) ||
            !uuid(operation.operationId)
          )
            throw new Error('FORMAL_USAGE_INVALID_STATE');
          // The service has already computed the quote with prior snapshots.
          // Database CAS still rejects competing or stale updates.
          const w = await client.query(
            'update ' +
              TABLE +
              '.scout_point_usage_wallets set ' +
              'available_points=$2::bigint, exchange_eligible_points=$3::bigint, ' +
              'reserved_points=$4::bigint, revision=$5::bigint ' +
              'where user_id=$1::uuid and revision=$6::bigint',
            [
              userId,
              int(wallet.availablePoints, 'next wallet available'),
              int(wallet.exchangeEligiblePoints, 'next wallet eligible'),
              int(wallet.reservedPoints, 'next wallet reserved'),
              int(wallet.revision, 'next wallet revision'),
              observed.wallet.revision
            ]
          );
          requireOne(w, 'WALLET');
          const budgetPurpose = operation.purpose;
          const b = await client.query(
            'update ' +
              TABLE +
              '.scout_point_usage_budgets set ' +
              'committed_points=$2::bigint, reserved_points=$3::bigint, ' +
              'revision=$4::bigint where purpose=$1::text and revision=$5::bigint',
            [
              budgetPurpose,
              int(budget.committedPoints, 'budget committed'),
              int(budget.reservedPoints, 'budget reserved'),
              int(budget.revision, 'budget revision'),
              observed.budget.revision
            ]
          );
          requireOne(b, 'BUDGET');
          const values = [
            operation.operationId,
            userId,
            operation.purpose,
            int(operation.amountPoints, 'operation amount'),
            operation.phase,
            operation.featureId || null,
            int(
              operation.eligibleReservedPoints,
              'operation reserved allocation'
            ),
            int(operation.revision, 'operation revision')
          ];
          const previous = observed.operation;
          if (previous) {
            requireOne(
              await client.query(
                'update ' +
                  TABLE +
                  '.scout_point_usage_operations set ' +
                  'phase=$5::text, revision=$8::bigint, updated_at=now() ' +
                  'where operation_id=$1::uuid and user_id=$2::uuid and ' +
                  'purpose=$3::text and amount_points=$4::bigint and ' +
                  'revision=$9::bigint and feature_id is not distinct from $6::text and ' +
                  'eligible_reserved_points=$7::bigint',
                [...values, previous.revision]
              ),
              'OPERATION'
            );
          } else {
            requireOne(
              await client.query(
                'insert into ' +
                  TABLE +
                  '.scout_point_usage_operations ' +
                  '(operation_id,user_id,purpose,amount_points,phase,feature_id,' +
                  'eligible_reserved_points,revision) values ' +
                  '($1::uuid,$2::uuid,$3::text,$4::bigint,$5::text,$6::text,' +
                  '$7::bigint,$8::bigint) on conflict do nothing',
                values
              ),
              'OPERATION_UNIQUE'
            );
          }
          requireOne(
            await client.query(
              'insert into ' +
                TABLE +
                '.scout_point_usage_events ' +
                '(operation_id,user_id,purpose,phase,amount_points,feature_id) ' +
                'values ($1::uuid,$2::uuid,$3::text,$5::text,$4::bigint,$6::text)',
              values
            ),
            'HISTORY'
          );
          // Canonical Point spending is recorded ONLY after fulfillment is
          // independently verified. Reserve/release modify the private
          // hold only. Both ledgers are in this one PostgreSQL transaction.
          if (
            operation.phase === 'committed' &&
            previous?.phase === 'reserved'
          ) {
            if (operation.amountPoints > 1000000)
              throw new Error('FORMAL_CANONICAL_LEDGER_ENTRY_LIMIT');
            requireOne(
              await client.query(
                'insert into public.scout_point_ledger ' +
                  '(user_id,point_kind,point_value,status,event_key) ' +
                  "values ($1::uuid,$2::text,$3::integer,'confirmed',$4::text)",
                [
                  userId,
                  operation.purpose === 'ai_direct_use'
                    ? 'formal_ai_spend'
                    : 'formal_external_exchange',
                  -operation.amountPoints,
                  'scout-formal-spend:' + operation.operationId
                ]
              ),
              'CANONICAL_SPEND'
            );
          } else if (
            operation.phase === 'refunded' &&
            previous?.phase === 'committed'
          ) {
            if (operation.amountPoints > 1000000)
              throw new Error('FORMAL_CANONICAL_LEDGER_ENTRY_LIMIT');
            const source = await client.query(
              'select id from public.scout_point_ledger ' +
                'where user_id=$1::uuid and event_key=$2::text ' +
                "and status='confirmed' and point_value=$3::integer " +
                'for update',
              [
                userId,
                'scout-formal-spend:' + operation.operationId,
                -operation.amountPoints
              ]
            );
            if (source?.rowCount !== 1 || !uuid(source.rows?.[0]?.id))
              throw new Error('FORMAL_ORIGINAL_SETTLEMENT_NOT_FOUND');
            requireOne(
              await client.query(
                'insert into public.scout_point_ledger ' +
                  '(user_id,point_kind,point_value,status,event_key,reversal_of) ' +
                  "values ($1::uuid,$2::text,$3::integer,'confirmed',$4::text,$5::uuid)",
                [
                  userId,
                  operation.purpose === 'ai_direct_use'
                    ? 'formal_ai_refund'
                    : 'formal_external_exchange_refund',
                  operation.amountPoints,
                  'scout-formal-refund:' + operation.operationId,
                  source.rows[0].id
                ]
              ),
              'CANONICAL_REFUND'
            );
          }
          saved = true;
        }
      });
      const result = await callback(tx);
      await client.query('COMMIT');
      begun = false;
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* original error wins */
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
  // Unregistered, read-only administrator accounting view. No budget cap
  // is imposed here, and beta-era Points are never treated as formal earnings.
  async function getAdminRewardOverview() {
    const client = await pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      begun = true;
      const ledger = await client.query(
        'select ' +
          "coalesce(sum(point_value) filter (where status='confirmed' and left(point_kind,7)='formal_' and right(point_kind,7)<>'_refund' and point_value>0),0)::text as issued_total, " +
          "coalesce(sum(point_value) filter (where status='confirmed' and left(point_kind,7)='formal_' and right(point_kind,7)<>'_refund' and point_value>0 and occurred_at >= (date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')),0)::text as issued_month, " +
          "coalesce(sum(point_value) filter (where status='confirmed' and point_kind='formal_read_reward' and occurred_at >= (date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')),0)::text as read_month, " +
          "coalesce(sum(point_value) filter (where status='confirmed' and point_kind='formal_comment_reward' and occurred_at >= (date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')),0)::text as comment_month, " +
          "coalesce(sum(-point_value) filter (where status='confirmed' and point_kind='formal_external_exchange'),0)::text as gift_spent, " +
          "coalesce(sum(point_value) filter (where status='confirmed' and point_kind='formal_external_exchange_refund'),0)::text as gift_refunded, " +
          "coalesce(sum(-point_value) filter (where status='confirmed' and point_kind='formal_ai_spend'),0)::text as ai_spent, " +
          "coalesce(sum(point_value) filter (where status='confirmed' and point_kind='formal_ai_refund'),0)::text as ai_refunded " +
          'from public.scout_point_ledger'
      );
      const wallets = await client.query(
        'select coalesce(sum(exchange_eligible_points),0)::text as eligible_available ' +
          'from ' +
          TABLE +
          '.scout_point_usage_wallets'
      );
      const operations = await client.query(
        'select count(*)::text as pending_count, ' +
          'coalesce(sum(amount_points),0)::text as pending_points, ' +
          'coalesce(sum(eligible_reserved_points),0)::text as eligible_reserved ' +
          'from ' +
          TABLE +
          '.scout_point_usage_operations ' +
          "where purpose='external_exchange' and phase='reserved'"
      );
      const activity = await client.query(
        'select id,user_id,point_kind,point_value,status,occurred_at ' +
          'from public.scout_point_ledger where left(point_kind,7)=$1::text ' +
          'order by occurred_at desc,id desc limit 30',
        ['formal_']
      );
      const l = ledger?.rows?.[0];
      const w = wallets?.rows?.[0];
      const o = operations?.rows?.[0];
      if (!l || !w || !o || !Array.isArray(activity?.rows))
        throw new Error('FORMAL_ADMIN_OVERVIEW_UNAVAILABLE');
      const net = (spent, refunded) => {
        const value =
          int(spent, 'formal spending') - int(refunded, 'formal refunded');
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error('FORMAL_ADMIN_NET_SPENDING_INVALID');
        return value;
      };
      const recent = activity.rows.map((row) => {
        const points =
          typeof row.point_value === 'string' && /^-?\d+$/.test(row.point_value)
            ? Number(row.point_value)
            : row.point_value;
        const at = new Date(row.occurred_at);
        if (
          !uuid(row.id) ||
          !uuid(row.user_id) ||
          typeof row.point_kind !== 'string' ||
          !row.point_kind.startsWith('formal_') ||
          !['confirmed', 'pending', 'frozen', 'cancelled'].includes(
            row.status
          ) ||
          !Number.isSafeInteger(points) ||
          Math.abs(points) > 1000000 ||
          !Number.isFinite(at.getTime())
        )
          throw new Error('FORMAL_ADMIN_LEDGER_ROW_INVALID');
        return {
          eventId: row.id,
          userId: row.user_id,
          kind: row.point_kind,
          points,
          status: row.status,
          occurredAt: at.toISOString()
        };
      });
      const summary = Object.freeze({
        status: 'reward_overview_ready',
        period: 'current_jst_calendar_month',
        pointsPerYen: 10,
        issuedMonth: int(l.issued_month, 'issued month'),
        issuedTotal: int(l.issued_total, 'issued total'),
        readMonth: int(l.read_month, 'read month'),
        commentMonth: int(l.comment_month, 'comment month'),
        giftSpentNet: net(l.gift_spent, l.gift_refunded),
        aiSpentNet: net(l.ai_spent, l.ai_refunded),
        eligibleAvailable: int(w.eligible_available, 'eligible available'),
        eligibleReserved: int(o.eligible_reserved, 'eligible reserved'),
        pendingExchangePoints: int(o.pending_points, 'pending exchange'),
        pendingExchangeCount: int(o.pending_count, 'pending count'),
        recent
      });
      await client.query('COMMIT');
      begun = false;
      return summary;
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Keep the original read-only failure.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
  return Object.freeze({
    transact,
    getAdminRewardOverview,
    async readReader(userId) {
      if (!uuid(userId)) return null;
      const result = await pool.query(
        'select user_id,available_points,exchange_eligible_points,' +
          'reserved_points,held_points,revision from ' +
          TABLE +
          '.scout_point_usage_wallets where user_id=$1::uuid',
        [userId]
      );
      const wallet = rowWallet(result?.rows?.[0]);
      if (!wallet) return null;
      await canonicalReader.assertWalletCoherent(userId, wallet);
      const [account, history, pending] = await Promise.all([
        readFormalAccount(userId),
        readCanonicalPointHistory(userId),
        pool.query(
          'select operation_id,purpose,amount_points,phase,created_at ' +
            'from ' +
            TABLE +
            '.scout_point_usage_operations ' +
            "where user_id=$1::uuid and phase in ('reserved','released') " +
            'order by created_at desc limit 40',
          [userId]
        )
      ]);
      if (!account || !Array.isArray(history) || !Array.isArray(pending?.rows))
        throw new Error('FORMAL_REWARD_AUTHORITATIVE_READER_UNAVAILABLE');
      const usageHistory = pending.rows.map((row) => {
        if (
          !uuid(row.operation_id) ||
          !PURPOSES.has(row.purpose) ||
          !['reserved', 'released'].includes(row.phase)
        )
          throw new Error('FORMAL_REWARD_OPERATION_HISTORY_INVALID');
        return {
          operationId: row.operation_id,
          kind: row.purpose === 'ai_direct_use' ? 'ai' : 'exchange',
          points: -int(row.amount_points, 'pending operation'),
          status: row.phase === 'reserved' ? 'pending' : 'cancelled',
          at: new Date(row.created_at).toISOString()
        };
      });
      // The DB bigint fields are parsed as safe integers individually, but
      // their combined display value can still overflow JavaScript integers.
      // Never return a rounded Point balance to a reader.
      const totalHeld = wallet.heldPoints + wallet.reservedPoints;
      if (!Number.isSafeInteger(totalHeld))
        throw new RangeError('FORMAL_REWARD_HELD_SUM_OVERFLOW');
      wallet.heldPoints = totalHeld;
      return {
        wallet,
        account,
        history: [...usageHistory, ...history].slice(0, 80)
      };
    },
    async findOperation(operationId) {
      if (!uuid(operationId)) return null;
      const result = await pool.query(
        'select operation_id,user_id,purpose,amount_points,phase,feature_id,' +
          'eligible_reserved_points,revision from ' +
          TABLE +
          '.scout_point_usage_operations where operation_id=$1::uuid',
        [operationId]
      );
      return rowOperation(result?.rows?.[0]);
    },
    async listPendingExchanges() {
      const result = await pool.query(
        'select operation_id,user_id,purpose,amount_points,phase,feature_id,' +
          'eligible_reserved_points,revision from ' +
          TABLE +
          '.scout_point_usage_operations where purpose=$1::text and ' +
          'phase=$2::text order by created_at asc limit 100',
        ['external_exchange', 'reserved']
      );
      return (result.rows || []).map(rowOperation);
    },
    async listRefundCandidates() {
      const result = await pool.query(
        'select operation_id,user_id,purpose,amount_points,phase,feature_id,' +
          'eligible_reserved_points,revision from ' +
          TABLE +
          '.scout_point_usage_operations where phase=$1::text ' +
          'order by updated_at desc limit 100',
        ['committed']
      );
      return (result.rows || []).map(rowOperation);
    }
  });
}
