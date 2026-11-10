// Deterministic in-memory repository for isolated formal-reward development.
// Never import into a live server. This is not PostgreSQL persistence.
// A later approved DB adapter must implement the same transaction boundary.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy = (value) => JSON.parse(JSON.stringify(value));

export function createOfflineFormalUsageRepository({
  readers = [],
  budgets = {}
} = {}) {
  const users = new Map();
  for (const reader of readers) {
    const userId = reader.userId;
    const balance = reader.availablePoints;
    const eligible = reader.exchangeEligiblePoints;
    if (
      !UUID.test(userId || '') ||
      users.has(userId) ||
      !Number.isSafeInteger(balance) ||
      !Number.isSafeInteger(eligible) ||
      balance < 0 ||
      eligible < 0 ||
      eligible > balance
    ) {
      throw new TypeError('Invalid offline wallet fixture');
    }
    users.set(userId, {
      wallet: {
        userId,
        availablePoints: balance,
        exchangeEligiblePoints: eligible,
        reservedPoints: 0,
        heldPoints: reader.heldPoints || 0,
        revision: 0
      },
      account: copy(reader.account || {}),
      history: copy(reader.history || [])
    });
  }

  const allowedPurposes = ['external_exchange', 'ai_direct_use'];
  const budgetMap = new Map();
  for (const purpose of allowedPurposes) {
    const row = budgets[purpose];
    if (
      !row ||
      typeof row.scopeId !== 'string' ||
      !Number.isSafeInteger(row.limitPoints) ||
      row.limitPoints < 0
    )
      throw new TypeError('Approved offline budget fixture required');
    budgetMap.set(purpose, {
      scopeId: row.scopeId,
      limitPoints: row.limitPoints,
      committedPoints: 0,
      reservedPoints: 0,
      revision: 0
    });
  }
  const operations = new Map();
  let tail = Promise.resolve();

  async function transact(userId, callback) {
    if (!users.has(userId)) return { status: 'wallet_unavailable' };
    let unlock;
    const next = new Promise((resolve) => {
      unlock = resolve;
    });
    const prior = tail;
    tail = next;
    await prior;
    try {
      // Global serialization protects the shared budget as well as wallets.
      // A real DB implementation must lock both, not merely the user row.
      const localUsers = new Map(
        [...users].map(([id, state]) => [id, copy(state)])
      );
      const localBudgets = new Map(
        [...budgetMap].map(([id, state]) => [id, copy(state)])
      );
      const localOps = new Map(
        [...operations].map(([id, state]) => [id, copy(state)])
      );
      const tx = {
        getWallet(id) {
          return copy(localUsers.get(id)?.wallet ?? null);
        },
        getBudget(purpose) {
          return copy(localBudgets.get(purpose) ?? null);
        },
        getOperation(id) {
          return copy(localOps.get(id) ?? null);
        },
        save({ wallet, budget, operation }) {
          const user = localUsers.get(operation.userId);
          if (
            !user ||
            user.wallet.userId !== wallet.userId ||
            !localBudgets.has(operation.purpose)
          )
            throw new Error('OFFLINE_TRANSACTION_INVALID');
          const priorOp = localOps.get(operation.operationId);
          user.wallet = { ...user.wallet, ...copy(wallet) };
          localBudgets.set(operation.purpose, copy(budget));
          localOps.set(operation.operationId, copy(operation));
          const record = user.history.find(
            (entry) => entry.operationId === operation.operationId
          );
          if (!priorOp) {
            user.history.unshift({
              operationId: operation.operationId,
              kind: operation.purpose === 'ai_direct_use' ? 'ai' : 'exchange',
              points: -operation.amountPoints,
              status: 'pending',
              at: 'offline-development-only'
            });
          } else if (record) {
            record.status =
              operation.phase === 'committed'
                ? 'confirmed'
                : operation.phase === 'released'
                  ? 'cancelled'
                  : 'pending';
          }
        }
      };
      const result = await callback(tx);
      // Persist only successful callback completion; throw = full rollback.
      users.clear();
      for (const [id, state] of localUsers) users.set(id, state);
      budgetMap.clear();
      for (const [id, state] of localBudgets) budgetMap.set(id, state);
      operations.clear();
      for (const [id, state] of localOps) operations.set(id, state);
      return result;
    } finally {
      unlock();
    }
  }

  return Object.freeze({
    transact,
    async readReader(userId) {
      const s = users.get(userId);
      if (!s) return null;
      return copy({
        wallet: {
          ...s.wallet,
          heldPoints: s.wallet.heldPoints + s.wallet.reservedPoints
        },
        account: s.account,
        history: s.history
      });
    },
    async findOperation(operationId) {
      return copy(operations.get(operationId) ?? null);
    },
    async listPendingExchanges() {
      return [...operations.values()]
        .filter(
          (op) => op.purpose === 'external_exchange' && op.phase === 'reserved'
        )
        .map(copy);
    }
  });
}
