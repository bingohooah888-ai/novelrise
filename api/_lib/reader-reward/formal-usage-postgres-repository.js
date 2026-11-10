// Future-only PostgreSQL repository for the formal Point usage service.
// No real connection, schema creation, connection string, or API route here.
// A dedicated, OWNER-approved server must inject a restricted pg-like pool.
// The corresponding SQL is docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql.
const TABLE = 'novelight_formal_private';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = new Set(['external_exchange', 'ai_direct_use']);
const PHASES = new Set(['reserved', 'committed', 'released']);
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
    limitPoints: int(row.limit_points, 'budget limit'),
    committedPoints: int(row.committed_points, 'budget committed'),
    reservedPoints: int(row.reserved_points, 'budget reserved'),
    revision: int(row.revision, 'budget revision')
  };
  if (
    typeof out.scopeId !== 'string' ||
    out.committedPoints + out.reservedPoints > out.limitPoints
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
  readCanonicalPointHistory
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
  async function transact(userId, callback) {
    if (!uuid(userId) || typeof callback !== 'function')
      throw new TypeError('Verified formal transaction user required');
    const client = await pool.connect();
    let begun = false;
    try {
      await client.query('BEGIN');
      begun = true;
      // All transitions lock wallet first, purpose budget second, operation
      // last. The operation primary key prevents cross-user UUID re-use.
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
  return Object.freeze({
    transact,
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
      const [account, history] = await Promise.all([
        readFormalAccount(userId),
        readCanonicalPointHistory(userId)
      ]);
      if (!account || !Array.isArray(history))
        throw new Error('FORMAL_REWARD_AUTHORITATIVE_READER_UNAVAILABLE');
      wallet.heldPoints += wallet.reservedPoints;
      return { wallet, account, history };
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
    }
  });
}
