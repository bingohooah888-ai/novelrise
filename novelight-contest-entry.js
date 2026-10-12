// Shared author-only contest entry client, used by "自分の作品" (phase 03)
// and the contest landing page (phase 04). All decisions are server-verified.
(function () {
  'use strict';

  const CONTEST_KEY = 'novelight-november-2026';
  const RPC_CONTEXT = 'novelight_contest_entry_context';
  const RPC_ACTION = 'novelight_contest_entry_action';

  function reasonMessage(reason, result) {
    const messages = {
      contest_unavailable: 'コンテスト情報を取得できませんでした。',
      registration_closed: '現在、エントリー受付期間外です。',
      insufficient_published_episodes:
        '公開話数が不足しています（現在' +
        String(result?.published_episodes ?? '—') +
        '話）。',
      not_owned_published_work: '本人の公開作品のみエントリーできます。',
      invalid_work: '有効な作品を選択してください。',
      entry_locked: '運営の確認が必要なため変更できません。',
      invalid_action: '操作を確認できませんでした。'
    };
    return messages[reason] || '操作を完了できませんでした。';
  }

  function createButton(label, action, novelId, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'work-action nl-contest-entry-button';
    button.textContent = label;
    button.dataset.contestAction = action;
    if (novelId !== undefined && novelId !== null) {
      button.dataset.contestNovelId = String(novelId);
    }
    button.disabled = Boolean(disabled);
    return button;
  }

  async function loadContext(client) {
    const { data, error } = await client.rpc(RPC_CONTEXT, {
      p_contest_key: CONTEST_KEY
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.reason || 'contest_unavailable');
    return data;
  }

  async function submitAction(client, action, novelId) {
    const { data, error } = await client.rpc(RPC_ACTION, {
      p_action: action,
      p_novel_id: action === 'enter' ? Number(novelId) : null,
      p_contest_key: CONTEST_KEY
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(reasonMessage(data?.reason, data));
    return data;
  }

  function buildActions(work, context) {
    const panel = document.createElement('span');
    panel.className = 'nl-contest-entry-actions';
    panel.style.display = 'inline-flex';
    panel.style.gap = '6px';
    panel.style.flexWrap = 'wrap';

    const current = context.entry?.status === 'entered';
    const isCurrent = current &&
      String(context.entry.novel_id) === String(work.id);

    if (isCurrent) {
      const marker = document.createElement('span');
      marker.className = 'badge';
      marker.textContent = 'コンテスト参加中';
      panel.append(marker);
      if (context.accepting_entries) {
        panel.append(createButton('エントリー取消', 'withdraw', work.id));
      }
      return panel;
    }

    const disabled = !context.accepting_entries || !work.eligible;
    let label;
    if (!context.accepting_entries) {
      label = context.contest_status === 'draft'
        ? 'エントリー受付準備中'
        : 'エントリー受付終了';
    } else if (!work.eligible) {
      label = work.status !== 'published'
        ? '公開作品のみ応募可'
        : '公開10話以上で応募可（現在' +
          String(work.published_episodes) + '話）';
    } else {
      label = current ? '応募作品を変更' : 'コンテストにエントリー';
    }
    const button = createButton(label, 'enter', work.id, disabled);
    panel.append(button);
    return panel;
  }

  function confirmAction(action, isReplacement) {
    if (action === 'withdraw') {
      return window.confirm('この作品のコンテスト応募を取り消しますか？');
    }
    if (isReplacement) {
      return window.confirm(
        'エントリー作品を変更しますか？応募できるのは1作者1作品です。'
      );
    }
    return window.confirm(
      'この作品で11月コンテストにエントリーしますか？'
    );
  }

  function bindActions(client, root, draw, context) {
    let busy = false;
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-contest-action]');
      if (!button || !root.contains(button) || busy || button.disabled) return;

      const action = button.dataset.contestAction;
      const novelId = button.dataset.contestNovelId;
      if (action !== 'enter' && action !== 'withdraw') return;
      if (!confirmAction(action, action === 'enter' &&
        context.entry?.status === 'entered')) return;

      busy = true;
      button.disabled = true;
      try {
        await submitAction(client, action, novelId);
        const latest = await loadContext(client);
        Object.assign(context, latest);
        draw(latest);
      } catch (error) {
        window.alert(error?.message || 'エントリー処理に失敗しました。');
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
  }

  async function mountMyNovels({ client, list, session }) {
    if (!client || !list || !session?.user?.id) return;
    let context;
    try {
      context = await loadContext(client);
    } catch (error) {
      // Before phase 02/03 migration, normal work management must still work.
      console.warn('Contest enrollment is not available', error?.code || '');
      return;
    }

    function draw(current) {
      for (const card of list.querySelectorAll('[data-contest-novel-id]')) {
        const novelId = card.dataset.contestNovelId;
        const target = card.querySelector('.work-primary-actions');
        if (!target) continue;
        target.querySelector('.nl-contest-entry-actions')?.remove();
        const work = current.works?.find(
          (row) => String(row.id) === String(novelId)
        );
        if (work) target.append(buildActions(work, current));
      }
    }
    draw(context);
    bindActions(client, list, draw, context);
  }

  // Reusable entry selector: phase 04 can call this from the contest page.
  async function mountContestPage({ client, root, session }) {
    if (!client || !root || !session?.user?.id) return;
    let context;
    try {
      context = await loadContext(client);
    } catch (error) {
      root.textContent = 'エントリー受付の準備中です。';
      return;
    }

    function draw(current) {
      root.replaceChildren();
      for (const work of current.works || []) {
        const row = document.createElement('div');
        row.className = 'nl-contest-entry-work';
        const title = document.createElement('strong');
        title.textContent = work.title;
        const detail = document.createElement('span');
        detail.textContent = '公開' +
          String(work.published_episodes) + '話';
        row.append(title, detail, buildActions(work, current));
        root.append(row);
      }
      if (!current.works?.length) {
        root.textContent = '応募可能な作品がありません。';
      }
    }
    draw(context);
    bindActions(client, root, draw, context);
  }

  window.NovelightContestEntry = {
    mountMyNovels,
    mountContestPage,
    loadContext,
    submitAction
  };
})();
