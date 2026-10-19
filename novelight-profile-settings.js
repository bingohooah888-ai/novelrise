(() => {
  'use strict';
  const client = supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co','sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
  const $ = (id) => document.getElementById(id);
  let session = null;
  let avatarPath = null;
  let ready = false;
  let busy = false;
  let earned = [];

  function status(id, message, isError = false) {
    $(id).textContent = message;
    $(id).classList.toggle('error', isError);
  }

  function showAvatar(name) {
    const view = $('avatarPreview');
    view.replaceChildren();
    const fallback = String(name || '読者').slice(0, 1);
    if (!avatarPath) { view.textContent = fallback; return; }
    const url = client.storage.from('author-avatars').getPublicUrl(avatarPath).data?.publicUrl;
    if (!url) { view.textContent = fallback; return; }
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'プロフィールアイコン';
    image.onerror = () => { view.replaceChildren(); view.textContent = fallback; };
    view.appendChild(image);
  }

  async function saveProfile() {
    const displayName = $('displayName').value.trim();
    const bio = $('bio').value.trim();
    if (!displayName || displayName.length > 40 || bio.length > 500) {
      throw new Error('input_invalid');
    }
    const { error } = await client.rpc('novelight_update_my_public_profile', {
      p_display_name: displayName,
      p_bio: bio,
      p_avatar_path: avatarPath || null
    });
    if (error) throw error;
    return displayName;
  }

  $('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    busy = true;
    $('saveProfile').disabled = true;
    status('profileStatus', '保存中...');
    try {
      const name = await saveProfile();
      showAvatar(name);
      status('profileStatus', 'プロフィールを保存しました。');
    } catch (error) {
      console.error('reader profile save failed', error);
      status('profileStatus', '保存できませんでした。入力内容を確認して再度お試しください。', true);
    } finally {
      busy = false;
      $('saveProfile').disabled = false;
    }
  });

  $('avatarInput').addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !ready || busy) return;
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    if (!ext || file.size > 2097152) {
      status('profileStatus', 'アイコンはJPEG・PNG・WebP形式、2MB以下を指定してください。', true);
      input.value = '';
      return;
    }
    busy = true;
    input.disabled = true;
    $('saveProfile').disabled = true;
    status('profileStatus', 'アイコンをアップロードしています...');
    const nextPath = session.user.id + '/' + crypto.randomUUID() + '.' + ext;
    try {
      const upload = await client.storage.from('author-avatars').upload(nextPath, file, {
        cacheControl: '3600', upsert: false, contentType: file.type
      });
      if (upload.error) throw upload.error;
      const previous = avatarPath;
      avatarPath = nextPath;
      try {
        await saveProfile();
      } catch (error) {
        avatarPath = previous;
        await client.storage.from('author-avatars').remove([nextPath]).catch(() => {});
        throw error;
      }
      showAvatar($('displayName').value.trim());
      if (previous && previous !== nextPath) {
        void client.storage.from('author-avatars').remove([previous]).then(({ error }) => {
          if (error) console.warn('old avatar cleanup failed', error);
        });
      }
      status('profileStatus', 'アイコンを更新しました。');
    } catch (error) {
      console.error('reader avatar upload failed', error);
      status('profileStatus', 'アイコンを更新できませんでした。', true);
    } finally {
      busy = false;
      input.disabled = false;
      $('saveProfile').disabled = false;
      input.value = '';
    }
  });

  function updateBadgeCondition() {
    const row = earned.find(item => item.badge_id === $('equippedBadge').value);
    $('badgeCondition').textContent = row?.description ||
      '装備する称号を選ぶと獲得条件を確認できます。';
  }

  async function loadBadges() {
    const select = $('equippedBadge');
    try {
      const { data, error } = await client.rpc('novelight_scout_badges');
      if (error) throw error;
      earned = Array.isArray(data) ? data.filter(row => row.status === 'earned') : [];
      select.replaceChildren(new Option('装備しない', ''));
      earned.forEach(row => {
        const label = row.badge_id === 'limited_founding_author' &&
          Number.isInteger(Number(row.metadata?.founding_number))
          ? 'Founding Author #' + String(row.metadata.founding_number).padStart(3, '0')
          : (row.display_name || row.badge_id);
        select.add(new Option(label, row.badge_id));
      });
      const current = earned.find(row => row.is_public === true);
      select.value = current?.badge_id || '';
      select.dataset.saved = select.value;
      select.disabled = earned.length === 0;
      updateBadgeCondition();
      status('badgeStatus', earned.length
        ? '変更は選択後すぐに反映されます。' : '獲得済み称号がありません。');
    } catch (error) {
      console.error('reader profile badge load failed', error);
      status('badgeStatus', '称号を読み込めませんでした。', true);
    }
  }

  $('equippedBadge').addEventListener('change', async () => {
    const select = $('equippedBadge');
    const previous = select.dataset.saved || '';
    const next = select.value;
    updateBadgeCondition();
    if (next === previous) return;
    select.disabled = true;
    status('badgeStatus', '称号を更新しています...');
    try {
      const { data, error } = await client.rpc('novelight_set_scout_badge_visibility', {
        p_badge_id: next || previous,
        p_is_public: Boolean(next)
      });
      if (error || data !== true) throw error || new Error('badge_update_not_confirmed');
      select.dataset.saved = next;
      status('badgeStatus', next ? '称号を装備しました。' : '称号を外しました。');
    } catch (error) {
      console.error('reader profile badge update failed', error);
      select.value = previous;
      updateBadgeCondition();
      status('badgeStatus', '称号の更新に失敗しました。', true);
    } finally {
      select.disabled = earned.length === 0;
    }
  });

  async function init() {
    try {
      const auth = await client.auth.getSession();
      if (auth.error) throw auth.error;
      session = auth.data?.session || null;
      if (!session) {
        window.location.replace('login.html?redirect=profile-settings.html');
        return;
      }
      const result = await client.from('profiles').select('display_name,bio,avatar_path')
        .eq('id', session.user.id).maybeSingle();
      if (result.error) throw result.error;
      let profile = result.data;
      if (!profile) {
        const ensured = await client.rpc('novelight_ensure_my_profile');
        if (ensured.error) throw ensured.error;
        profile = Array.isArray(ensured.data) ? ensured.data[0] : ensured.data;
      }
      if (!profile) throw new Error('profile_unavailable');
      $('displayName').value = profile.display_name ||
        session.user.user_metadata?.display_name || '';
      $('bio').value = profile.bio || '';
      avatarPath = profile.avatar_path || null;
      showAvatar($('displayName').value);
      $('publicProfileLink').href = 'author.html?id=' + encodeURIComponent(session.user.id);
      $('publicProfileLink').hidden = false;
      ready = true;
      $('avatarInput').disabled = false;
      $('saveProfile').disabled = false;
      status('profileStatus', '');
      void NovelightProfileFavoriteGenres.mountEditor(client);
      void loadBadges();
    } catch (error) {
      console.error('reader profile load failed', error);
      status('profileStatus', 'プロフィールを読み込めませんでした。再読み込みしてください。', true);
    }
  }
  void init();
})();
