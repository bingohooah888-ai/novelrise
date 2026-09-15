(function () {
  'use strict';

  const STORAGE_PREFIX = 'novelight:reading:v1:';
  const CANDIDATE_LIMIT = 10;
  const STYLE_ID = 'novelight-home-resume-style';

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function readRecentProgress(storage = window.localStorage, limit = CANDIDATE_LIMIT) {
    const rows = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        let value;
        try {
          value = JSON.parse(storage.getItem(key) || 'null');
        } catch {
          continue;
        }
        if (!value?.novelId || !value?.episodeId) continue;
        const expectedNovelId = key.slice(STORAGE_PREFIX.length);
        if (String(value.novelId) !== expectedNovelId) continue;
        const timestamp = new Date(value.lastReadAt || 0).getTime();
        if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
        rows.push({
          novelId: String(value.novelId),
          episodeId: String(value.episodeId),
          episodeNumber: Number(value.episodeNumber) || 0,
          progressRatio: clamp(value.progressRatio),
          lastReadAt: new Date(timestamp).toISOString(),
          timestamp
        });
      }
    } catch {
      return [];
    }

    return rows
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Math.max(1, Math.min(Number(limit) || 1, CANDIDATE_LIMIT)));
  }

  function continueTarget(episodes, stored) {
    if (!episodes.length) return null;
    const index = episodes.findIndex((row) => String(row.id) === String(stored.episodeId));
    if (index < 0) return episodes[0];
    const completedCurrent = clamp(stored.progressRatio) >= 0.85;
    return completedCurrent && episodes[index + 1] ? episodes[index + 1] : episodes[index];
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-home-resume{padding:20px 0;background:linear-gradient(180deg,#071321,#09182a);border-top:1px solid rgba(214,164,71,.16);border-bottom:1px solid rgba(214,164,71,.22)}
      .nl-home-resume-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:20px 22px;border:1px solid rgba(214,164,71,.32);border-radius:16px;background:linear-gradient(135deg,rgba(18,32,49,.96),rgba(9,22,36,.96));box-shadow:0 16px 42px rgba(0,0,0,.16)}
      .nl-home-resume-kicker{display:block;margin-bottom:6px;color:#d6a447;font-size:10px;font-weight:900;letter-spacing:.18em}
      .nl-home-resume-title{display:block;color:#fff2c9;font-size:20px;font-weight:900;line-height:1.45;text-decoration:none!important}
      .nl-home-resume-episode{margin-top:6px;color:#c5ced9;font-size:12px;line-height:1.6}
      .nl-home-resume-note{margin-top:6px;color:#7f8da0;font-size:10px}
      .nl-home-resume-action{display:inline-flex;align-items:center;justify-content:center;min-width:178px;min-height:46px;padding:10px 16px;border:1px solid #d6a447;border-radius:10px;background:#d6a447;color:#101b28!important;font-size:12px;font-weight:950;text-decoration:none!important}
      .nl-home-resume-action:hover{filter:brightness(1.06);transform:translateY(-1px)}
      @media(max-width:680px){.nl-home-resume{padding:14px 0}.nl-home-resume-card{grid-template-columns:1fr;gap:15px;padding:18px}.nl-home-resume-title{font-size:18px}.nl-home-resume-action{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function episodeLabel(row, stored) {
    const number = Number(row.episode_number) || 0;
    if (String(row.id) === String(stored.episodeId) && clamp(stored.progressRatio) < 0.85) {
      return `第${number}話の続きから読む`;
    }
    return `第${number}話から続きを読む`;
  }

  function renderResume(novel, target, stored) {
    if (document.getElementById('homeResumeSection')) return false;
    const hero = document.querySelector('main > .hero');
    if (!hero) return false;

    installStyles();
    const section = document.createElement('section');
    section.id = 'homeResumeSection';
    section.className = 'nl-home-resume';
    section.setAttribute('aria-labelledby', 'homeResumeTitle');

    const container = document.createElement('div');
    container.className = 'container';
    const card = document.createElement('div');
    card.className = 'nl-home-resume-card';
    const copy = document.createElement('div');
    const kicker = document.createElement('span');
    kicker.className = 'nl-home-resume-kicker';
    kicker.textContent = 'CONTINUE READING';
    const title = document.createElement('a');
    title.id = 'homeResumeTitle';
    title.className = 'nl-home-resume-title';
    title.href = `novel.html?id=${encodeURIComponent(novel.id)}`;
    title.textContent = novel.title || 'タイトル未設定';
    const episode = document.createElement('p');
    episode.className = 'nl-home-resume-episode';
    episode.textContent = episodeLabel(target, stored);
    if (target.title) episode.textContent += `「${target.title}」`;
    const note = document.createElement('p');
    note.className = 'nl-home-resume-note';
    note.textContent = 'この端末の読書履歴から表示しています。';
    copy.append(kicker, title, episode, note);

    const action = document.createElement('a');
    action.className = 'nl-home-resume-action';
    action.href = `episode.html?id=${encodeURIComponent(target.id)}`;
    action.textContent = '前回の続きへ →';
    card.append(copy, action);
    container.appendChild(card);
    section.appendChild(container);
    hero.insertAdjacentElement('afterend', section);
    return true;
  }

  async function resolveCandidate(clientInstance, stored) {
    const novelResult = await clientInstance
      .from('novels')
      .select('id,title,status')
      .eq('id', stored.novelId)
      .eq('status', 'published')
      .maybeSingle();
    if (novelResult.error || !novelResult.data) return null;

    const episodeResult = await clientInstance
      .from('episodes')
      .select('id,novel_id,title,episode_number,status')
      .eq('novel_id', stored.novelId)
      .eq('status', 'published')
      .order('episode_number', { ascending: true });
    if (episodeResult.error || !episodeResult.data?.length) return null;
    const target = continueTarget(episodeResult.data, stored);
    return target ? { novel: novelResult.data, target, stored } : null;
  }

  async function installHomeResume(clientInstance) {
    if (!clientInstance || document.getElementById('homeResumeSection')) return false;
    const recent = readRecentProgress();
    for (const stored of recent) {
      try {
        const resolved = await resolveCandidate(clientInstance, stored);
        if (resolved) return renderResume(resolved.novel, resolved.target, resolved.stored);
      } catch (error) {
        console.error('home resume candidate lookup failed', error);
      }
    }
    return false;
  }

  window.NovelightHomeResume = Object.freeze({
    readRecentProgress,
    continueTarget,
    installHomeResume
  });

  if ((window.location.pathname.split('/').pop() || 'index.html') === 'index.html') {
    if (typeof client !== 'undefined' && client) {
      void installHomeResume(client);
    }
  }
})();
