(() => {
  'use strict';

  const MISSING_CODES = new Set(['42883', 'PGRST202', 'PGRST204']);

  function runtimeMissing(error) {
    const message = String(error?.message || '');
    return MISSING_CODES.has(String(error?.code || ''))
      || message.includes('Could not find the function')
      || message.includes('does not exist');
  }

  function ensureStyles() {
    if (document.getElementById('novelightWorkNavigationStyles')) return;
    const style = document.createElement('style');
    style.id = 'novelightWorkNavigationStyles';
    style.textContent = `
      body.novelight-page-episode main#main-content{max-width:1180px}
      .nl-worknav-episode-layout{display:grid;grid-template-columns:minmax(0,820px) 294px;align-items:start;justify-content:center;gap:20px}
      .nl-worknav-episode-main{min-width:0}.nl-worknav-support{position:sticky;top:136px;display:grid;gap:12px}
      .nl-worknav-panel{border:1px solid #e4dccf;border-radius:14px;background:#fffdf8;overflow:hidden;box-shadow:0 10px 28px rgba(55,42,29,.05)}
      .nl-worknav-panel-head{padding:13px 14px;border-bottom:1px solid #ece5d9;color:#4b3928;font-size:13px;font-weight:900}
      .nl-worknav-episode-list{max-height:42vh;overflow:auto;padding:7px}.nl-worknav-episode-link{display:block;padding:9px 10px;border-radius:8px;color:#665a4d;font-size:12px;line-height:1.45;text-decoration:none!important}
      .nl-worknav-episode-link:hover{background:#f5efe4}.nl-worknav-episode-link.current{background:#efe7d8;color:#382b1e;font-weight:900}.nl-worknav-episode-link small{display:block;margin-bottom:2px;color:#958878;font-size:10px}
      .nl-worknav-character-list{display:grid;gap:7px;padding:9px}.nl-worknav-character{display:grid;grid-template-columns:42px minmax(0,1fr);gap:9px;align-items:start;padding:8px;border-radius:9px;background:#fff}
      .nl-worknav-character.no-image{grid-template-columns:1fr}.nl-worknav-character img{width:42px;height:42px;object-fit:cover;border-radius:50%;border:1px solid #e1d7c8;background:#f5f0e8}
      .nl-worknav-character strong{display:block;color:#382f27;font-size:12px}.nl-worknav-character p{margin:3px 0 0;color:#756b5f;font-size:10px;line-height:1.55}.nl-worknav-character-state{display:block;margin-top:3px;color:#9a7544;font-size:9px;font-weight:800}
      .nl-worknav-empty{padding:12px 14px;color:#85796a;font-size:11px;line-height:1.6}.nl-worknav-mobile{display:none;margin:0 0 14px}.nl-worknav-mobile details{border:1px solid #ded5c8;border-radius:10px;background:#fffdf9}.nl-worknav-mobile details+details{margin-top:8px}
      .nl-worknav-mobile summary{padding:11px 13px;cursor:pointer;color:#493c30;font-size:13px;font-weight:900;list-style:none}.nl-worknav-mobile summary::-webkit-details-marker{display:none}.nl-worknav-mobile summary::after{content:'＋';float:right;color:#8d7448}.nl-worknav-mobile details[open] summary::after{content:'－'}.nl-worknav-mobile-body{border-top:1px solid #eee6db}
      .nl-worknav-novel-panel{margin:0 0 18px;padding:22px;border:1px solid #e1d8ca;border-radius:16px;background:#fffdf8}.nl-worknav-novel-actions{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}
      .nl-worknav-primary{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:11px 18px;border-radius:9px;background:#3b2a1d;color:#fff!important;font-size:14px;font-weight:900;text-decoration:none!important}.nl-worknav-primary:hover{opacity:.92}
      .nl-worknav-characters-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:18px 0 9px}.nl-worknav-characters-head h2{font-size:18px}.nl-worknav-novel-characters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .nl-worknav-novel-character{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:10px;border:1px solid #ebe3d7;border-radius:11px;background:#fff}.nl-worknav-novel-character.no-image{grid-template-columns:1fr}.nl-worknav-novel-character img{width:52px;height:52px;object-fit:cover;border-radius:10px;background:#f4eee5}
      .nl-worknav-novel-character strong{font-size:13px}.nl-worknav-novel-character p{margin:4px 0 0;color:#70675e;font-size:11px;line-height:1.55}.nl-worknav-more{margin-top:10px;border:0;background:transparent;color:#6f542d;font-weight:900;cursor:pointer}.nl-worknav-novel-character.is-extra{display:none}.nl-worknav-novel-characters.is-expanded .nl-worknav-novel-character.is-extra{display:grid}
      @media(max-width:960px){.nl-worknav-episode-layout{display:block}.nl-worknav-support{display:none}.nl-worknav-mobile{display:block}}
      @media(max-width:640px){.nl-worknav-novel-panel{padding:17px 15px}.nl-worknav-novel-characters{grid-template-columns:1fr}.nl-worknav-primary{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function episodeHref(id) {
    return `episode.html?id=${encodeURIComponent(id)}`;
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  async function publicEpisodes(client, novelId) {
    const result = await client.rpc('novelight_reader_episode_index', {
      p_novel_ids: [String(novelId)]
    });
    if (result.error) throw result.error;
    return (result.data || [])
      .filter((row) => String(row.novel_id) === String(novelId))
      .map((row) => ({
        id: row.episode_id,
        number: Number(row.episode_number) || 0,
        title: String(row.episode_title || '')
      }))
      .sort((a, b) => a.number - b.number || Number(a.id) - Number(b.id));
  }

  function makeEpisodeList(rows, currentEpisodeId = null) {
    const list = document.createElement('div');
    list.className = 'nl-worknav-episode-list';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'nl-worknav-empty';
      empty.textContent = '公開中の話はまだありません。';
      list.appendChild(empty);
      return list;
    }
    for (const row of rows) {
      const link = document.createElement('a');
      link.className = `nl-worknav-episode-link${String(row.id) === String(currentEpisodeId) ? ' current' : ''}`;
      link.href = episodeHref(row.id);
      if (String(row.id) === String(currentEpisodeId)) link.setAttribute('aria-current', 'page');
      const number = document.createElement('small');
      number.textContent = `第${row.number}話`;
      const title = document.createElement('span');
      title.textContent = row.title || `第${row.number}話`;
      link.append(number, title);
      list.appendChild(link);
    }
    return list;
  }

  function characterCard(row, { episode = false } = {}) {
    const card = document.createElement('article');
    const imageUrl = safeImageUrl(row.image_url);
    card.className = `${episode ? 'nl-worknav-character' : 'nl-worknav-novel-character'}${imageUrl ? '' : ' no-image'}`;
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      card.appendChild(image);
    }
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = row.name || '登場人物';
    copy.appendChild(name);
    if (row.description) {
      const description = document.createElement('p');
      description.textContent = row.description;
      copy.appendChild(description);
    }
    if (episode) {
      const state = document.createElement('span');
      state.className = 'nl-worknav-character-state';
      state.textContent = row.appears_current_episode
        ? 'この話に登場'
        : row.latest_episode_number ? `この話まで：第${Number(row.latest_episode_number)}話` : 'この話までに登場';
      copy.appendChild(state);
    } else if (row.first_appearance_episode_number) {
      const first = document.createElement('p');
      first.textContent = `初登場：第${Number(row.first_appearance_episode_number)}話`;
      copy.appendChild(first);
    }
    card.appendChild(copy);
    return card;
  }

  function makeCharacterList(rows, { episode = false } = {}) {
    const list = document.createElement('div');
    list.className = episode ? 'nl-worknav-character-list' : 'nl-worknav-novel-characters';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'nl-worknav-empty';
      empty.textContent = '作者が公開設定した登場人物はまだありません。';
      list.appendChild(empty);
      return list;
    }
    rows.forEach((row, index) => {
      const card = characterCard(row, { episode });
      if (!episode && index >= 4) card.classList.add('is-extra');
      list.appendChild(card);
    });
    return list;
  }

  function panel(title, body) {
    const section = document.createElement('section');
    section.className = 'nl-worknav-panel';
    const head = document.createElement('div');
    head.className = 'nl-worknav-panel-head';
    head.textContent = title;
    section.append(head, body);
    return section;
  }

  function mobileDetails(title, body) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = title;
    const content = document.createElement('div');
    content.className = 'nl-worknav-mobile-body';
    content.appendChild(body);
    details.append(summary, content);
    return details;
  }

  async function mountEpisode({ client, episode, novel }) {
    if (!client || !episode?.id || !novel?.id || document.getElementById('nlEpisodeSupport')) return false;
    ensureStyles();
    try {
      const [rows, characterResult] = await Promise.all([
        publicEpisodes(client, novel.id),
        client.rpc('novelight_character_feed', { p_episode_id: String(episode.id) })
      ]);
      if (characterResult.error) {
        if (runtimeMissing(characterResult.error)) return false;
        throw characterResult.error;
      }
      const characters = Array.isArray(characterResult.data) ? characterResult.data : [];
      const card = document.getElementById('card');
      if (!card) return false;

      const layout = document.createElement('div');
      layout.id = 'nlEpisodeSupport';
      layout.className = 'nl-worknav-episode-layout';
      const main = document.createElement('div');
      main.className = 'nl-worknav-episode-main';
      const mobile = document.createElement('div');
      mobile.className = 'nl-worknav-mobile';
      mobile.append(
        mobileDetails('話数', makeEpisodeList(rows, episode.id)),
        mobileDetails('登場人物', makeCharacterList(characters, { episode: true }))
      );
      const aside = document.createElement('aside');
      aside.className = 'nl-worknav-support';
      aside.setAttribute('aria-label', '作品内ナビゲーション');
      aside.append(
        panel('話数一覧', makeEpisodeList(rows, episode.id)),
        panel('登場人物', makeCharacterList(characters, { episode: true }))
      );

      card.before(layout);
      main.append(mobile, card);
      layout.append(main, aside);
      return true;
    } catch (error) {
      console.error('work navigation episode mount failed', error);
      return false;
    }
  }

  function continueTarget(rows, novelId) {
    const first = rows[0];
    if (!first) return null;
    const stored = window.NovelightReadingContinuity?.readProgress?.(novelId);
    if (!stored) return { row: first, label: first.number === 1 ? '第1話から読む' : `第${first.number}話から読む` };
    const currentIndex = rows.findIndex((row) => String(row.id) === String(stored.episodeId));
    if (currentIndex < 0) return { row: first, label: first.number === 1 ? '第1話から読む' : `第${first.number}話から読む` };
    const completed = Number(stored.progressRatio || 0) >= 0.85;
    const row = completed && rows[currentIndex + 1] ? rows[currentIndex + 1] : rows[currentIndex];
    return { row, label: '続きを読む' };
  }

  async function mountNovel({ client, novelId }) {
    if (!client || !novelId || document.getElementById('nlNovelWorkNav')) return false;
    ensureStyles();
    try {
      const [rows, characterResult] = await Promise.all([
        publicEpisodes(client, novelId),
        client.rpc('novelight_novel_character_feed', { p_novel_id: String(novelId) })
      ]);
      if (characterResult.error) {
        if (runtimeMissing(characterResult.error)) return false;
        throw characterResult.error;
      }
      const header = document.getElementById('novelHeader');
      if (!header || header.style.display === 'none') return false;
      const characters = Array.isArray(characterResult.data) ? characterResult.data : [];
      const target = continueTarget(rows, novelId);
      const section = document.createElement('section');
      section.id = 'nlNovelWorkNav';
      section.className = 'nl-worknav-novel-panel';

      const actions = document.createElement('div');
      actions.className = 'nl-worknav-novel-actions';
      if (target) {
        const cta = document.createElement('a');
        cta.className = 'nl-worknav-primary';
        cta.href = episodeHref(target.row.id);
        cta.textContent = target.label;
        actions.appendChild(cta);
      }
      const toc = document.createElement('a');
      toc.href = '#episodesPanel';
      toc.textContent = '話数一覧を見る ↓';
      toc.style.cssText = 'color:#6f542d;font-size:12px;font-weight:900';
      actions.appendChild(toc);
      section.appendChild(actions);

      if (characters.length) {
        const head = document.createElement('div');
        head.className = 'nl-worknav-characters-head';
        const heading = document.createElement('h2');
        heading.textContent = '登場人物';
        head.appendChild(heading);
        const list = makeCharacterList(characters);
        section.append(head, list);
        if (characters.length > 4) {
          const more = document.createElement('button');
          more.className = 'nl-worknav-more';
          more.type = 'button';
          more.textContent = 'もっと見る';
          more.setAttribute('aria-expanded', 'false');
          more.addEventListener('click', () => {
            const expanded = list.classList.toggle('is-expanded');
            more.textContent = expanded ? '閉じる' : 'もっと見る';
            more.setAttribute('aria-expanded', String(expanded));
          });
          section.appendChild(more);
        }
      }
      header.insertAdjacentElement('afterend', section);
      return true;
    } catch (error) {
      console.error('work navigation novel mount failed', error);
      return false;
    }
  }

  window.NovelightWorkNavigation = Object.freeze({ mountEpisode, mountNovel, publicEpisodes });
})();
