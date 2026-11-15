// Owner-only manual trial panel. It remains off-DOM until an authenticated,
// consent-checked and funded server readiness GET explicitly returns success.
// Never sends a model request on page load or automatically repeats a POST.
(function (root) {
  'use strict';

  const attached = new WeakSet();
  const pending = new WeakSet();

  function positive(value) {
    if (!/^[1-9]\d*$/.test(String(value))) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  }

  function sameSession(session, ownerId, token) {
    return (
      session?.user?.id === ownerId &&
      typeof session.access_token === 'string' &&
      session.access_token === token
    );
  }

  function validReady(value, novelId) {
    return (
      value?.trialReady === true &&
      value.novelId === novelId &&
      positive(value.episodeId) &&
      value.chunkIndex === 0 &&
      Object.keys(value).every((key) =>
        ['trialReady', 'novelId', 'episodeId', 'chunkIndex'].includes(key)
      )
    );
  }

  // Optional unmounted offline trial injection. Production story-notes does
  // not supply this; it cannot change the deployed HTTP billing boundary.
  // The plan comes from a trusted owner-scoped server runtime or synthetic
  // offline fixture. UI does not accept a client-declared owner or consent.
  function validOfflinePlan(value, novelId, episodeId) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 5 ||
      Object.keys(value).some(
        (key) =>
          ![
            'novelId',
            'episodeId',
            'chunkCount',
            'nextChunkIndex',
            'status'
          ].includes(key)
      ) ||
      value.novelId !== novelId ||
      value.episodeId !== episodeId ||
      !Number.isSafeInteger(value.chunkCount) ||
      value.chunkCount < 0 ||
      value.chunkCount > 64
    ) {
      return false;
    }
    const index = value.nextChunkIndex;
    if (value.status === 'unchanged' || value.status === 'completed') {
      return index === null;
    }
    if (value.status === 'zero_cost_completion') {
      return value.chunkCount === 0 && (index === null || index === 0);
    }
    if (value.status === 'replan_required') {
      return value.chunkCount > 0 && index === 0;
    }
    return (
      value.status === 'ready' &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < value.chunkCount &&
      index < 64
    );
  }

  async function attach({
    client,
    ownerId,
    novelId,
    doc = root.document,
    fetcher = root.fetch,
    reviewPanel = root.NovelightAiBibleReviewActions,
    offlineTrial
  } = {}) {
    const host = doc?.getElementById?.('main-content');
    const work = positive(novelId);
    const offline = offlineTrial?.enabled === true;
    if (
      (offlineTrial !== undefined &&
        (!offline ||
          typeof offlineTrial.inspectPlan !== 'function' ||
          typeof offlineTrial.stage !== 'function')) ||
      !host ||
      !work ||
      attached.has(host) ||
      pending.has(host) ||
      typeof ownerId !== 'string' ||
      typeof client?.auth?.getSession !== 'function' ||
      typeof client?.auth?.onAuthStateChange !== 'function' ||
      typeof fetcher !== 'function'
    ) {
      return false;
    }
    pending.add(host);
    let section = null;
    let subscription = null;
    let disposed = false;
    let mounted = false;
    let busy = false;
    let submitted = false;
    let reviewMounted = false;

    function clear() {
      disposed = true;
      if (section) {
        section.textContent = '';
        section.remove();
      }
      subscription?.unsubscribe();
      if (mounted) attached.delete(host);
    }

    try {
      const first = await client.auth.getSession();
      const session = !first.error && first.data?.session;
      const token = session?.access_token;
      if (!sameSession(session, ownerId, token)) return false;

      async function current() {
        const next = await client.auth.getSession();
        return !next.error && sameSession(next.data?.session, ownerId, token);
      }

      const endpoint = '/api/ai-owner-bible-analyze';
      const readiness = await fetcher(
        endpoint + '?novel_id=' + encodeURIComponent(work),
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + token,
            'X-Novelight-Ai-Trial-Status': '1'
          },
          cache: 'no-store',
          credentials: 'same-origin'
        }
      );
      if (!readiness.ok) return false;
      const ready = await readiness.json();
      if (!validReady(ready, work) || !(await current())) return false;

      section = doc.createElement('section');
      section.className = 'panel novelight-ai-bible-trial-section';
      section.setAttribute('aria-label', 'AI作品カルテの限定試用');
      const heading = doc.createElement('h3');
      heading.textContent = 'AI作品カルテ・管理人限定試用';
      const description = doc.createElement('p');
      description.textContent =
        '対象：作品 ' + work + ' ／ 話 ' + ready.episodeId +
        '。実行すると許諾済みの原稿の一部が外部AIに送信され、利用料金が発生する場合があります。';
      const action = doc.createElement('button');
      action.type = 'button';
      action.className = 'btn';
      action.textContent = 'この1話をAI解析する';
      const review = doc.createElement('button');
      review.type = 'button';
      review.className = 'btn';
      review.textContent = '解析候補を確認';
      const status = doc.createElement('p');
      status.setAttribute('role', 'status');
      status.className = 'status';
      const inspectButton = offline ? doc.createElement('button') : null;
      let planned = null;
      if (inspectButton) {
        inspectButton.type = 'button';
        inspectButton.className = 'btn novelight-ai-bible-inspect-plan';
        inspectButton.textContent = '解析予定・再開位置を確認（課金なし）';
        action.disabled = true;
        description.textContent +=
          ' このオフライン操作は合成データで検証し、公開画面には接続しません。';
        section.append(heading, description, inspectButton, action, review, status);
      } else {
        section.append(heading, description, action, review, status);
      }

      if (inspectButton) {
        inspectButton.addEventListener('click', async () => {
          if (disposed || busy || submitted) return;
          busy = true;
          inspectButton.disabled = true;
          action.disabled = true;
          planned = null;
          status.textContent = '解析対象を確認しています（課金なし）。';
          try {
            if (!(await current())) {
              clear();
              return;
            }
            const plan = await offlineTrial.inspectPlan({
              token,
              novelId: work,
              episodeId: ready.episodeId
            });
            if (!(await current())) {
              clear();
              return;
            }
            if (!validOfflinePlan(plan, work, ready.episodeId)) {
              throw new Error('INVALID_OFFLINE_PLAN');
            }
            planned = plan;
            if (plan.nextChunkIndex !== null) {
              action.disabled = false;
              action.textContent =
                'チャンク ' + (plan.nextChunkIndex + 1) + ' を1回だけ解析';
              status.textContent =
                '全 ' +
                plan.chunkCount +
                ' チャンク／次の対象 ' +
                (plan.nextChunkIndex + 1) +
                '。実行は別の明示操作が必要です。';
            } else {
              status.textContent =
                plan.status === 'completed' || plan.status === 'unchanged'
                  ? 'この話に追加解析が必要な箇所はありません。'
                  : '解析対象はありません。';
            }
          } catch {
            if (!disposed) {
              planned = null;
              action.disabled = true;
              status.textContent =
                '解析予定を確認できませんでした。再確認してください。';
            }
          } finally {
            busy = false;
            if (!disposed) inspectButton.disabled = false;
          }
        });
      }

      async function showReview() {
        if (disposed || reviewMounted) return;
        if (!(await current())) {
          clear();
          return;
        }
        if (typeof reviewPanel?.attach !== 'function') {
          status.textContent = '候補画面を開けませんでした。';
          return;
        }
        const opened = await reviewPanel.attach({
          client,
          novelId: work,
          ownerId,
          doc,
          fetcher
        });
        if (!opened || !(await current())) {
          if (!(await current())) clear();
          else status.textContent = '候補画面を開けませんでした。';
          return;
        }
        reviewMounted = true;
      }

      review.addEventListener('click', () => {
        if (disposed || busy) return;
        void showReview();
      });
      action.addEventListener('click', async () => {
        if (disposed || busy || submitted || (offline && !planned)) return;
        busy = true;
        submitted = true; // Never automatically retry a potentially billed POST.
        action.disabled = true;
        review.disabled = true;
        if (inspectButton) inspectButton.disabled = true;
        status.textContent = '本人認証・許諾・原価を確認して解析しています。';
        try {
          if (!(await current())) {
            clear();
            return;
          }
          let result;
          if (offline) {
            // Never trust a previously displayed index for a possibly billed
            // action. Check the plan and session again before one stage call.
            const fresh = await offlineTrial.inspectPlan({
              token,
              novelId: work,
              episodeId: ready.episodeId
            });
            if (
              !validOfflinePlan(fresh, work, ready.episodeId) ||
              fresh.nextChunkIndex !== planned.nextChunkIndex ||
              fresh.status !== planned.status ||
              fresh.chunkCount !== planned.chunkCount
            ) {
              status.textContent =
                '原稿または解析状態が変化しました。再読込して確認してください。';
              return;
            }
            if (!(await current())) {
              clear();
              return;
            }
            result = await offlineTrial.stage({
              token,
              novelId: work,
              episodeId: ready.episodeId,
              chunkIndex: planned.nextChunkIndex
            });
          } else {
            const response = await fetcher(endpoint, {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'X-Novelight-Ai-Trial': '1'
              },
              credentials: 'same-origin',
              cache: 'no-store',
              body: JSON.stringify({
                novelId: work,
                episodeId: ready.episodeId,
                chunkIndex: 0
              })
            });
            if (!(await current())) {
              clear();
              return;
            }
            if (!response.ok) {
              status.textContent =
                '解析できませんでした。同意・予算・対象作品を確認してください。自動再試行はしません。';
              return;
            }
            result = await response.json();
          }
          if (!(await current())) {
            clear();
            return;
          }
          if (
            result?.novelId !== work ||
            !Number.isSafeInteger(result.stagedCount) ||
            result.stagedCount < 0 ||
            result.stagedCount > 12 ||
            (result.requiresAuthorReview !== true &&
              !(
                offline &&
                result.requiresAuthorReview === false &&
                result.stagedCount === 0
              ))
          ) {
            clear();
            return;
          }
          if (result.requiresAuthorReview === false) {
            status.textContent =
              '追加解析は不要でした。課金・候補追加はありません。';
            return;
          }
          status.textContent =
            '解析結果を確認待ち候補として保存しました（' +
            result.stagedCount +
            '件）。正式設定には自動反映しません。作品カルテは再読込で更新してください。';
          if (reviewMounted) {
            status.textContent +=
              ' すでに開いた候補一覧はページ再読込後に更新されます。';
          } else {
            await showReview();
          }
        } catch {
          if (!disposed) {
            status.textContent =
              '解析の完了を確認できませんでした。自動再試行はしません。';
          }
        } finally {
          busy = false;
          if (!disposed) review.disabled = false;
        }
      });

      const listener = client.auth.onAuthStateChange((_event, next) => {
        if (!sameSession(next, ownerId, token)) clear();
      });
      subscription = listener?.data?.subscription;
      if (
        typeof subscription?.unsubscribe !== 'function' ||
        !(await current()) ||
        disposed
      ) {
        clear();
        return false;
      }
      host.appendChild(section);
      attached.add(host);
      mounted = true;
      return true;
    } catch {
      clear();
      return false;
    } finally {
      pending.delete(host);
    }
  }

  root.NovelightAiBibleTrialPanel = Object.freeze({ attach });
})(globalThis);
