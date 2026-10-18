/* Shared profile favorite-genre controls: owner-only settings and opt-in public display. */
(function () {
  'use strict';

  const GENRES = Object.freeze([
    '異世界ファンタジー',
    '現代ファンタジー',
    '恋愛',
    'ラブコメ',
    'SF',
    'ミステリー',
    'ホラー',
    '歴史',
    '現代ドラマ',
    'その他'
  ]);
  const MAX = 3;

  async function mountEditor(client) {
    const host = document.getElementById('favoriteGenreChoices');
    if (!host || host.dataset.bound === 'true') return;
    host.dataset.bound = 'true';
    const button = document.getElementById('saveFavoriteGenres');
    const status = document.getElementById('favoriteGenreStatus');
    const count = document.getElementById('favoriteGenreCount');
    const visibility = document.getElementById('favoriteGenresPublic');
    const inputs = GENRES.map((genre) => {
      const label = document.createElement('label');
      label.className = 'favorite-genre-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'profileFavoriteGenre';
      input.value = genre;
      input.disabled = true;
      label.append(input, document.createTextNode(genre));
      host.appendChild(label);
      return input;
    });

    function updateChoices() {
      const selected = inputs.filter((input) => input.checked).length;
      inputs.forEach((input) => {
        input.disabled = !button.dataset.ready || (!input.checked && selected >= MAX);
      });
      count.textContent = `${selected} / ${MAX}ジャンル選択中`;
      if (!selected) visibility.checked = false;
      visibility.disabled = !button.dataset.ready || selected === 0;
    }
    inputs.forEach((input) => input.addEventListener('change', updateChoices));
    try {
      const { data, error } = await client.rpc('novelight_my_favorite_genres');
      if (error) throw error;
      const entry = Array.isArray(data) ? data[0] : data;
      const selected = Array.isArray(entry?.genres) ? entry.genres : [];
      inputs.forEach((input) => {
        input.checked = selected.includes(input.value);
      });
      visibility.checked = Boolean(entry?.is_public) && selected.length > 0;
      button.dataset.ready = 'true';
      button.disabled = false;
      updateChoices();
      status.classList.remove('error');
      status.textContent = '公開はオフが初期設定です。表示する場合だけチェックしてください。';
    } catch (error) {
      console.error('favorite genre settings unavailable', error);
      status.classList.add('error');
      status.textContent = 'ジャンル設定を読み込めませんでした。再読み込みしてください。';
      count.textContent = '取得できませんでした。';
      return;
    }

    button.addEventListener('click', async () => {
      const selected = inputs.filter((input) => input.checked).map((input) => input.value);
      if (selected.length > MAX) return;
      button.disabled = true;
      status.classList.remove('error');
      status.textContent = '保存中...';
      try {
        const { data, error } = await client.rpc('novelight_set_my_favorite_genres', {
          p_genres: selected,
          p_is_public: visibility.checked && selected.length > 0
        });
        if (error || data !== true) throw error || new Error('Favorite genres were not saved');
        status.textContent = 'ジャンル設定を保存しました。';
      } catch (error) {
        console.error('favorite genres save failed', error);
        status.classList.add('error');
        status.textContent = '保存できませんでした。時間をおいて再度お試しください。';
      } finally {
        button.disabled = false;
        updateChoices();
      }
    });
  }

  async function mountPublic({ client, targetUserId, container }) {
    if (!client || !targetUserId || !container) return;
    try {
      const { data, error } = await client.rpc('novelight_public_favorite_genres', {
        p_user_id: targetUserId
      });
      if (error) throw error;
      const genres = Array.isArray(data) ? data.filter((genre) => GENRES.includes(genre)) : [];
      if (!genres.length) return;
      const section = document.createElement('section');
      section.className = 'public-favorite-genres';
      section.setAttribute('aria-label', '好きなジャンル');
      const title = document.createElement('strong');
      title.className = 'public-favorite-genres-heading';
      title.textContent = '好きなジャンル';
      const list = document.createElement('div');
      list.className = 'public-favorite-genre-list';
      genres.slice(0, MAX).forEach((genre) => {
        const chip = document.createElement('span');
        chip.className = 'public-favorite-genre-chip';
        chip.textContent = genre;
        list.appendChild(chip);
      });
      section.append(title, list);
      (container.querySelector('.bio') || container).insertAdjacentElement('afterend', section);
    } catch (error) {
      console.error('public favorite genres unavailable', error);
    }
  }

  window.NovelightProfileFavoriteGenres = Object.freeze({ mountEditor, mountPublic });
})();
