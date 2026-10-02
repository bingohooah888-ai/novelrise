const CONFIRMATION_TEXT = 'アカウントを削除';
const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  'canceled',
  'incomplete_expired'
]);

function getBearerToken(req) {
  const header = String(
    req.headers?.authorization || req.headers?.Authorization || ''
  );
  const match = header.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || '';
}

function uniquePaths(rows, key) {
  return [
    ...new Set(
      (rows || []).map((row) => String(row?.[key] || '').trim()).filter(Boolean)
    )
  ];
}

async function removeStoragePaths(supabase, bucket, paths) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}

async function cancelStripeSubscriptions(stripe, profile) {
  const customerId = String(profile?.stripe_customer_id || '').trim();
  const profileSubscriptionId = String(
    profile?.stripe_subscription_id || ''
  ).trim();
  const subscriptions = new Map();

  if (customerId) {
    let startingAfter;
    do {
      const page = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });
      for (const subscription of page.data || []) {
        subscriptions.set(subscription.id, subscription);
      }
      startingAfter = page.has_more ? page.data?.at(-1)?.id : undefined;
    } while (startingAfter);
  }

  if (profileSubscriptionId && !subscriptions.has(profileSubscriptionId)) {
    const subscription = await stripe.subscriptions.retrieve(
      profileSubscriptionId
    );
    subscriptions.set(subscription.id, subscription);
  }

  for (const subscription of subscriptions.values()) {
    if (
      !subscription?.id ||
      TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)
    )
      continue;
    await stripe.subscriptions.cancel(subscription.id);
  }
}

async function collectDeletionTargets(supabase, userId) {
  const [profileResult, novelsResult, illustrationsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('avatar_path,stripe_customer_id,stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('novels').select('id').eq('user_id', userId),
    supabase
      .from('episode_illustrations')
      .select('storage_path')
      .eq('owner_user_id', userId)
  ]);

  for (const result of [profileResult, novelsResult, illustrationsResult]) {
    if (result.error) throw result.error;
  }

  const novelIds = (novelsResult.data || []).map((row) => row.id);
  let renderRows = [];
  if (novelIds.length) {
    const renderResult = await supabase
      .from('novel_thumbnail_compositions')
      .select('render_storage_path')
      .in('novel_id', novelIds);
    if (renderResult.error) throw renderResult.error;
    renderRows = renderResult.data || [];
  }

  return {
    profile: profileResult.data || null,
    avatarPaths: uniquePaths([profileResult.data], 'avatar_path'),
    illustrationPaths: uniquePaths(illustrationsResult.data, 'storage_path'),
    renderPaths: uniquePaths(renderRows, 'render_storage_path')
  };
}

async function deleteUserData(supabase, userId) {
  const illustrationDelete = await supabase
    .from('episode_illustrations')
    .delete()
    .eq('owner_user_id', userId);
  if (illustrationDelete.error) throw illustrationDelete.error;

  const novelsDelete = await supabase
    .from('novels')
    .delete()
    .eq('user_id', userId);
  if (novelsDelete.error) throw novelsDelete.error;

  const episodesDelete = await supabase
    .from('episodes')
    .delete()
    .eq('user_id', userId);
  if (episodesDelete.error) throw episodesDelete.error;

  const authDelete = await supabase.auth.admin.deleteUser(userId);
  if (authDelete.error) throw authDelete.error;
}

export function createDeleteAccountHandler({ stripe, supabase }) {
  return async function deleteAccount(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user?.id)
      return res.status(401).json({ error: 'UNAUTHORIZED' });

    if (req.body?.confirmation !== CONFIRMATION_TEXT) {
      return res.status(400).json({ error: 'CONFIRMATION_REQUIRED' });
    }

    try {
      const targets = await collectDeletionTargets(supabase, user.id);

      await cancelStripeSubscriptions(stripe, targets.profile);
      await removeStoragePaths(supabase, 'author-avatars', targets.avatarPaths);
      await removeStoragePaths(
        supabase,
        'episode-illustrations',
        targets.illustrationPaths
      );
      await removeStoragePaths(
        supabase,
        'novel-thumbnail-renders',
        targets.renderPaths
      );
      await deleteUserData(supabase, user.id);

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('account deletion failed', {
        userId: user.id,
        name: error?.name || null,
        message: error?.message || null
      });
      return res.status(500).json({ error: 'ACCOUNT_DELETE_FAILED' });
    }
  };
}

export { CONFIRMATION_TEXT };
