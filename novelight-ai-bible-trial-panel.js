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

  async function attach({
    client,
    ownerId,
    novelId,
    doc = root.document,
    fetcher = root.fetch,
    reviewPanel = root.NovelightAiBibleReviewActions
  } = {}) {
    const host = doc?.getElementById?.('main-content');
    const work = positive(novelId);
    if (
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
      section.append(heading, description, action, review, status);

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
        if (disposed || busy || submitted) return;
        busy = true;
        submitted = true; // Never automatically retry a potentially billed POST.
        action.disabled = true;
        review.disabled = true;
        status.textContent = '本人認証・許諾・原価を確認して解析しています。';
        try {
          if (!(await current())) {
            clear();
            return;
          }
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
          const result = await response.json();
          if (
            result?.novelId !== work ||
            !Number.isSafeInteger(result.stagedCount) ||
            result.stagedCount < 0 ||
            result.stagedCount > 12 ||
            result.requiresAuthorReview !== true
          ) {
            clear();
            return;
          }
          status.textContent =
            '解析結果を確認待ち候補として保存しました（' +
            result.stagedCount + '件）。正式設定には自動反映しません。';
          await showReview();
        } catch {
          if (!disposed) {
            status.textContent =
              '解析の完了を確認できませんでした。自動再試行はしません。';
          }
        } finally {
          busy = false;
          review.disabled = false;
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
