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
    ownerStudio = root.NovelightAiBibleOwnerStudio,
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
      const cancelButton = offline ? doc.createElement('button') : null;
      const refreshButton = offline ? doc.createElement('button') : null;
      let planned = null;
      // Never issue the same potentially billed chunk twice from one view.
      // A changed manuscript with the same index needs a fresh page.
      const attemptedChunks = new Set();
      if (inspectButton) {
        cancelButton.type = 'button';
        cancelButton.className = 'btn novelight-ai-bible-cancel-plan';
        cancelButton.textContent = '実行前に中止';
        cancelButton.disabled = true;
        refreshButton.type = 'button';
        refreshButton.className = 'btn novelight-ai-bible-refresh-views';
        refreshButton.textContent = '候補一覧・作品カルテを再読込';
        refreshButton.disabled = true;
        inspectButton.type = 'button';
        inspectButton.className = 'btn novelight-ai-bible-inspect-plan';
        inspectButton.textContent = '解析予定・再開位置を確認（課金なし）';
        action.disabled = true;
        description.textContent +=
          ' このオフライン操作は合成データで検証し、公開画面には接続しません。';
        section.append(
          heading,
          description,
          inspectButton,
          cancelButton,
          action,
          review,
          refreshButton,
          status
        );
      } else {
        section.append(heading, description, action, review, status);
      }

      if (inspectButton) {
        inspectButton.addEventListener('click', async () => {
          if (disposed || busy || submitted) return;
          busy = true;
          inspectButton.disabled = true;
          action.disabled = true;
          cancelButton.disabled = true;
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
              if (attemptedChunks.has(plan.nextChunkIndex)) {
                planned = null;
                status.textContent =
                  'このチャンクは既に実行を試みています。再実行せず、保存状態を確認してページを開き直してください。';
                return;
              }
              action.disabled = false;
              cancelButton.disabled = false;
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
              cancelButton.disabled = true;
              status.textContent =
                '解析予定を確認できませんでした。再確認してください。';
            }
          } finally {
            busy = false;
            if (!disposed) inspectButton.disabled = false;
          }
        });
      }

      // This only cancels a local, unsubmitted plan. It does not claim to
      // abort a paid request already in flight or alter server checkpoints.
      if (cancelButton) {
        cancelButton.addEventListener('click', () => {
          if (disposed || busy || submitted || !planned) return;
          planned = null;
          action.disabled = true;
          cancelButton.disabled = true;
          status.textContent =
            '解析を実行前に中止しました。再開する場合は解析予定をもう一度確認してください。';
        });
      }

      async function showReview({ preferRefresh = false } = {}) {
        if (disposed) return false;
        if (preferRefresh) {
          if (typeof reviewPanel?.refresh !== 'function' && reviewMounted) {
            status.textContent = '候補の再読込機能がありません。ページを再読み込みしてください。';
            return false;
          }
          if (typeof reviewPanel?.refresh === 'function') {
            const refreshed = await reviewPanel.refresh({
              client,
              ownerId,
              novelId: work,
              doc
            });
            if (!(await current())) {
              clear();
              return false;
            }
            if (refreshed === true) {
              reviewMounted = true;
              return true;
            }
            if (refreshed === false || reviewMounted) {
              status.textContent =
                '候補の再読込に失敗しました。ページを再読み込みしてください。';
              return false;
            }
          }
        }
        if (reviewMounted) return true;
        if (!(await current())) {
          clear();
          return false;
        }
        if (typeof reviewPanel?.attach !== 'function') {
          status.textContent = '候補画面を開けませんでした。';
          return false;
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
          return false;
        }
        reviewMounted = true;
        return true;
      }

      if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
          if (disposed || busy || refreshButton.disabled) return;
          busy = true;
          refreshButton.disabled = true;
          status.textContent =
            '候補と作品カルテの最新情報を確認しています。未保存の選択は破棄される場合があります。';
          try {
            if (!(await current())) {
              clear();
              return;
            }
            // Read-only, owner-authenticated GETs. No stage/POST, no
            // automatic author-canon promotion or payment is initiated.
            const reviewed = await showReview({ preferRefresh: true });
            if (!reviewed) {
              if (!(await current())) clear();
              else status.textContent =
                '候補を再読込できませんでした。ページを再読み込みしてください。';
              return;
            }
            const bible =
              typeof ownerStudio?.refresh === 'function'
                ? await ownerStudio.refresh({
                    client,
                    ownerId,
                    novelId: work,
                    doc
                  })
                : null;
            if (!(await current())) {
              clear();
              return;
            }
            if (bible === false) {
              status.textContent =
                '作品カルテを再読込できませんでした。保存状態を確認してください。';
              return;
            }
            status.textContent =
              bible === true
                ? '候補一覧と作品カルテを再読込しました。確認済み情報は自動変更しません。'
                : '候補一覧を再読込しました。作品カルテはこの画面に表示されていません。';
          } catch {
            if (!disposed) {
              status.textContent =
                '再読込に失敗しました。古い候補を採用せず、ページを開き直してください。';
            }
          } finally {
            busy = false;
            if (!disposed) refreshButton.disabled = false;
          }
        });
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
        if (cancelButton) cancelButton.disabled = true;
        let stageStarted = false;
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
              // No stage() has run: a fresh inspection is safe, but the
              // old plan must never be reused for a possibly paid request.
              planned = null;
              submitted = false;
              action.disabled = true;
              inspectButton.disabled = false;
              status.textContent =
                '原稿または解析状態が変化しました。解析予定を再確認してください（必要ならページ再読込）。';
              return;
            }
            if (!(await current())) {
              clear();
              return;
            }
            if (attemptedChunks.has(planned.nextChunkIndex)) {
              planned = null;
              submitted = false;
              inspectButton.disabled = false;
              status.textContent =
                '同じチャンクの二重解析を防止しました。保存状態を確認してください。';
              return;
            }
            // Mark BEFORE the async stage call. Uncertain paid outcomes must
            // not be retried merely because the user pressed a button again.
            attemptedChunks.add(planned.nextChunkIndex);
            stageStarted = true;
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
          // A confirmed response permits a separate, fresh inspection of
          // a DIFFERENT next chunk, never replay of this attempted index.
          if (offline) {
            planned = null;
            submitted = false;
            action.disabled = true;
            cancelButton.disabled = true;
            inspectButton.disabled = false;
          }
          if (offline) refreshButton.disabled = false;
          if (result.requiresAuthorReview === false) {
            status.textContent =
              '追加解析は不要でした。次の操作前に保存状態を確認してください。';
            return;
          }
          status.textContent =
            '解析結果を確認待ち候補として保存しました（' +
            result.stagedCount +
            '件）。正式設定には自動反映しません。作品カルテは再読込で更新してください。' +
            (offline
              ? ' 次のチャンクは「解析予定・再開位置を確認」で確認してください。'
              : '');
          if (reviewMounted) {
            status.textContent +=
              ' 候補一覧・作品カルテの再読込ボタンで最新情報を確認できます。';
          } else {
            await showReview();
          }
        } catch {
          if (!disposed) {
            if (offline && !stageStarted) {
              // Purely read-only failure: allow a new plan inspection.
              planned = null;
              submitted = false;
              action.disabled = true;
              cancelButton.disabled = true;
              inspectButton.disabled = false;
              status.textContent =
                '解析前の確認に失敗しました。再度、解析予定を確認してください。';
            } else {
              status.textContent =
                '解析の完了を確認できませんでした。再送せず、作品カルテと候補一覧を確認してください。';
            }
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
