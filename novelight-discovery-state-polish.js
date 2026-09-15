(() => {
  'use strict';

  const body = document.body;
  const list = document.getElementById('discoveryList');
  const moreButton = document.getElementById('discoveryMore');
  const mode = body?.dataset?.discoveryMode;
  const supportedModes = new Set(['recommended', 'new', 'seed']);
  const STYLE_ID = 'novelight-discovery-state-polish-style';

  if (
    !body?.classList.contains('novelight-page-discovery-list') ||
    !list ||
    !supportedModes.has(mode)
  ) {
    return;
  }

  const emptyStates = {
    recommended: {
      kicker: 'DISCOVERY',
      title: 'おすすめできる公開作品がまだありません',
      message:
        '公開作品が増えると、NOVELIGHTの発見設計に基づくおすすめがここに並びます。',
      actions: [
        { label: '作品を投稿する', href: 'post.html', primary: true },
        { label: 'NOVELIGHTの特徴を見る', href: 'index.html#features' }
      ]
    },
    new: {
      kicker: 'NEW STORIES',
      title: 'まだ公開された作品がありません',
      message:
        '公開された作品は、ここに新着順で並びます。最初の一作も、読者と出会える入口から届けます。',
      actions: [
        { label: '作品を投稿する', href: 'post.html', primary: true },
        { label: 'NOVELIGHTの特徴を見る', href: 'index.html#features' }
      ]
    },
    seed: {
      kicker: 'LIGHT SEED',
      title: 'LIGHT SEEDで発掘中の作品はまだありません',
      message:
        'LIGHT SEEDが贈られた公開作品が現れると、ここに並びます。まずは新着作品から次の一冊を探せます。',
      actions: [
        { label: '新着作品を見る', href: 'new-arrivals.html', primary: true },
        { label: 'LIGHT SEEDとは', href: 'index.html#features' }
      ]
    }
  };

  const errorState = {
    kicker: 'RETRY',
    title: '作品を読み込めませんでした',
    message: '通信状況を確認して、もう一度お試しください。'
  };

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .discovery-list-grid .state.nl-discovery-state-shell{padding:38px 28px;border-style:solid;background:linear-gradient(145deg,rgba(255,249,229,.56),rgba(238,219,181,.54));box-shadow:inset 0 0 0 1px rgba(255,250,236,.34)}
      .nl-discovery-state-inner{max-width:680px;margin:0 auto;text-align:center}
      .nl-discovery-state-kicker{display:block;margin-bottom:8px;color:#8b5b27;font-size:12px;font-weight:900;letter-spacing:.18em}
      .nl-discovery-state-title{margin:0;color:#382517;font-family:"Yu Mincho","Hiragino Mincho ProN","Noto Serif JP",serif;font-size:clamp(22px,3vw,30px);font-weight:700;line-height:1.45}
      .nl-discovery-state-message{max-width:580px;margin:12px auto 0;color:#6d563e;font-size:16px;line-height:1.8}
      .nl-discovery-state-actions{display:flex;justify-content:center;gap:10px;margin-top:22px;flex-wrap:wrap}
      .nl-discovery-state-action{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 17px;border:1px solid rgba(91,58,30,.42);border-radius:9px;background:rgba(255,250,236,.58);color:#51351f!important;font:inherit;font-size:14px;font-weight:900;text-decoration:none!important;cursor:pointer}
      .nl-discovery-state-action.primary{border-color:#6f452b;background:linear-gradient(135deg,#4b3021,#745034);color:#f4dfb8!important}
      .nl-discovery-state-action:hover,.nl-discovery-state-action:focus-visible{transform:translateY(-1px);outline:none;filter:brightness(1.04)}
      @media(max-width:600px){.discovery-list-grid .state.nl-discovery-state-shell{padding:30px 18px}.nl-discovery-state-message{font-size:15px}.nl-discovery-state-actions{display:grid;grid-template-columns:1fr}.nl-discovery-state-action{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function appendTextElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function appendActions(parent, actions) {
    if (!actions.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'nl-discovery-state-actions';
    for (const action of actions) {
      const link = document.createElement('a');
      link.className = `nl-discovery-state-action${action.primary ? ' primary' : ''}`;
      link.href = action.href;
      link.textContent = action.label;
      wrap.appendChild(link);
    }
    parent.appendChild(wrap);
  }

  function renderState(state, config, { retry = false } = {}) {
    if (!state || state.dataset.nlStatePolished === 'true') return;
    state.dataset.nlStatePolished = 'true';
    state.classList.add('nl-discovery-state-shell');
    state.textContent = '';

    const inner = document.createElement('div');
    inner.className = 'nl-discovery-state-inner';
    appendTextElement(inner, 'span', 'nl-discovery-state-kicker', config.kicker);
    appendTextElement(inner, 'h2', 'nl-discovery-state-title', config.title);
    appendTextElement(inner, 'p', 'nl-discovery-state-message', config.message);

    if (retry) {
      const actions = document.createElement('div');
      actions.className = 'nl-discovery-state-actions';
      const button = document.createElement('button');
      button.className = 'nl-discovery-state-action primary';
      button.type = 'button';
      button.textContent = 'もう一度読み込む';
      button.addEventListener('click', () => {
        if (!moreButton || moreButton.disabled) return;
        button.disabled = true;
        button.textContent = '再読み込み中...';
        moreButton.click();
      });
      const home = document.createElement('a');
      home.className = 'nl-discovery-state-action';
      home.href = 'index.html';
      home.textContent = 'ホームへ戻る';
      actions.append(button, home);
      inner.appendChild(actions);
    } else {
      appendActions(inner, config.actions || []);
    }

    state.appendChild(inner);
  }

  function enhanceState() {
    const state = list.querySelector(':scope > .state');
    if (!state || state.dataset.nlStatePolished === 'true') return;
    const text = state.textContent.trim();

    if (text.includes('作品を読み込めませんでした')) {
      renderState(state, errorState, { retry: true });
      return;
    }

    if (
      text === '現在表示できる作品はありません。' ||
      text === '現在表示できるLIGHT SEEDで発掘中の作品はありません。'
    ) {
      renderState(state, emptyStates[mode]);
    }
  }

  installStyles();
  const observer = new MutationObserver(enhanceState);
  observer.observe(list, { childList: true, subtree: true, characterData: true });
  enhanceState();
})();
