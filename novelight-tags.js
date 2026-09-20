(function attachNovelightTags(global) {
  'use strict';

  const OFFICIAL_TAG_LIMIT = 10;
  const CUSTOM_TAG_LIMIT = 5;
  const CUSTOM_TAG_MAX_LENGTH = 30;
  let catalogPromise = null;

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLowerCase();
  }

  function isMissingRpc(error, name) {
    const text = [error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return (
      error?.code === 'PGRST202' ||
      (text.includes(String(name).toLowerCase()) &&
        (text.includes('schema cache') || text.includes('could not find')))
    );
  }

  async function loadCatalog(client, { force = false } = {}) {
    if (!catalogPromise || force) {
      catalogPromise = client.rpc('novelight_official_tag_catalog').then((result) => {
        if (result.error) throw result.error;
        return (result.data || []).map((row) => ({
          id: String(row.id),
          displayName: String(row.display_name || ''),
          categoryId: String(row.category_id || ''),
          categoryName: String(row.category_name || ''),
          categorySort: Number(row.category_sort || 0),
          tagSort: Number(row.tag_sort || 0),
          aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : []
        }));
      });
    }
    return catalogPromise;
  }

  async function fetchNovelTags(client, novelIds) {
    const ids = [...new Set((novelIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 100);
    const map = new Map(ids.map((id) => [String(id), { official: [], custom: [] }]));
    if (!ids.length) return map;
    const result = await client.rpc('novelight_novel_tag_labels', { p_novel_ids: ids });
    if (result.error) throw result.error;
    for (const row of result.data || []) {
      const key = String(row.novel_id);
      if (!map.has(key)) map.set(key, { official: [], custom: [] });
      const target = map.get(key);
      if (row.tag_type === 'official') {
        target.official.push({
          id: String(row.tag_id),
          displayName: String(row.display_name || ''),
          categoryId: String(row.category_id || ''),
          position: Number(row.tag_position ?? row.position ?? 0)
        });
      } else if (row.tag_type === 'custom') {
        target.custom.push({
          displayName: String(row.display_name || ''),
          position: Number(row.tag_position ?? row.position ?? 0)
        });
      }
    }
    for (const entry of map.values()) {
      entry.official.sort((a, b) => a.position - b.position);
      entry.custom.sort((a, b) => a.position - b.position);
    }
    return map;
  }

  async function setNovelTags(client, novelId, officialTagIds, customTags) {
    const result = await client.rpc('novelight_set_novel_tags', {
      p_novel_id: Number(novelId),
      p_official_tag_ids: officialTagIds || [],
      p_custom_tags: customTags || []
    });
    if (result.error) throw result.error;
    return result.data;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function mount(options) {
    const {
      client,
      root,
      initialOfficialIds = [],
      initialCustomTags = [],
      showCustom = true,
      onChange = null,
      officialLimit = OFFICIAL_TAG_LIMIT,
      customLimit = CUSTOM_TAG_LIMIT
    } = options || {};

    if (!client || !root) throw new Error('NovelightTags.mount requires client and root');

    let catalog;
    try {
      catalog = await loadCatalog(client);
    } catch (error) {
      root.replaceChildren(
        el('div', 'novelight-tags-unavailable', '作品タグはデータベース反映待ちです。現在はタグなしで保存できます。')
      );
      return { ready: false, controller: null, error, missingRpc: isMissingRpc(error, 'novelight_official_tag_catalog') };
    }

    const byId = new Map(catalog.map((tag) => [tag.id, tag]));
    const aliasMap = new Map();
    for (const tag of catalog) {
      aliasMap.set(normalize(tag.displayName), tag);
      for (const alias of tag.aliases) aliasMap.set(normalize(alias), tag);
    }

    let selected = [...new Set(initialOfficialIds.map(String).filter((id) => byId.has(id)))].slice(0, officialLimit);
    let custom = [];
    for (const value of initialCustomTags) {
      const display = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
      const key = normalize(display);
      if (!display || custom.some((item) => item.key === key)) continue;
      custom.push({ key, display });
      if (custom.length >= customLimit) break;
    }

    root.replaceChildren();
    root.classList.add('novelight-tags-root');

    const selectedWrap = el('div', 'novelight-tags-selected');
    const tools = el('div', 'novelight-tags-tools');
    const search = document.createElement('input');
    search.type = 'search';
    search.maxLength = 50;
    search.placeholder = 'タグ名で検索';
    search.setAttribute('aria-label', '公式タグを検索');

    const category = document.createElement('select');
    category.setAttribute('aria-label', '公式タグカテゴリ');
    category.appendChild(new Option('すべてのカテゴリ', ''));
    const categories = new Map();
    for (const tag of catalog) {
      if (!categories.has(tag.categoryId)) {
        categories.set(tag.categoryId, {
          name: tag.categoryName,
          sort: tag.categorySort
        });
      }
    }
    [...categories.entries()]
      .sort((a, b) => a[1].sort - b[1].sort)
      .forEach(([id, meta]) => category.appendChild(new Option(meta.name, id)));

    tools.append(search, category);
    const counter = el('div', 'novelight-tags-counter');
    const list = el('div', 'novelight-tags-list');
    const message = el('div', 'novelight-tags-message');
    message.setAttribute('aria-live', 'polite');

    root.append(selectedWrap, tools, counter, list);

    let customSection = null;
    let customInput = null;
    let customList = null;
    if (showCustom) {
      customSection = el('div', 'novelight-custom-tags');
      const customTitle = el('div', 'novelight-custom-tags-title', `自由タグ（最大${customLimit}個）`);
      const customHelp = el(
        'div',
        'novelight-custom-tags-help',
        '公式タグにないニッチな特徴だけを入力してください。公式タグの別名を入力した場合は公式タグへ案内します。'
      );
      const row = el('div', 'novelight-custom-tags-input-row');
      customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.maxLength = CUSTOM_TAG_MAX_LENGTH;
      customInput.placeholder = '例：飯テロ';
      customInput.setAttribute('aria-label', '自由タグを追加');
      const addButton = el('button', 'novelight-custom-tags-add', '追加');
      addButton.type = 'button';
      row.append(customInput, addButton);
      customList = el('div', 'novelight-custom-tags-list');
      customSection.append(customTitle, customHelp, row, customList);
      root.append(customSection);

      const addCustom = () => {
        const display = String(customInput.value || '')
          .normalize('NFKC')
          .trim()
          .replace(/\s+/gu, ' ');
        const key = normalize(display);
        message.textContent = '';
        if (!display) return;
        const official = aliasMap.get(key);
        if (official) {
          if (!selected.includes(official.id)) {
            if (selected.length >= officialLimit) {
              message.textContent = `公式タグは最大${officialLimit}個です。「${official.displayName}」を追加するには別の公式タグを外してください。`;
              return;
            }
            selected.push(official.id);
          }
          customInput.value = '';
          message.textContent = `「${display}」は公式タグ「${official.displayName}」として追加しました。`;
          renderAll();
          notify();
          return;
        }
        if (display.length > CUSTOM_TAG_MAX_LENGTH || /[<>\r\n\t]/u.test(display)) {
          message.textContent = `自由タグは1〜${CUSTOM_TAG_MAX_LENGTH}文字で、< > や改行を含められません。`;
          return;
        }
        if (custom.some((item) => item.key === key)) {
          message.textContent = '同じ自由タグは重複して追加できません。';
          return;
        }
        if (custom.length >= customLimit) {
          message.textContent = `自由タグは最大${customLimit}個です。`;
          return;
        }
        custom.push({ key, display });
        customInput.value = '';
        renderAll();
        notify();
      };
      addButton.addEventListener('click', addCustom);
      customInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addCustom();
        }
      });
    }

    root.append(message);

    function notify() {
      if (typeof onChange === 'function') {
        onChange({
          officialTagIds: [...selected],
          customTags: custom.map((item) => item.display)
        });
      }
    }

    function renderSelected() {
      selectedWrap.replaceChildren();
      if (!selected.length) {
        selectedWrap.appendChild(el('span', 'novelight-tags-empty-selection', '公式タグは未選択です'));
        return;
      }
      for (const id of selected) {
        const tag = byId.get(id);
        if (!tag) continue;
        const chip = el('button', 'novelight-tag-chip', tag.displayName + ' ×');
        chip.type = 'button';
        chip.setAttribute('aria-label', `${tag.displayName}を外す`);
        chip.addEventListener('click', () => {
          selected = selected.filter((value) => value !== id);
          renderAll();
          notify();
        });
        selectedWrap.appendChild(chip);
      }
    }

    function matches(tag) {
      if (category.value && tag.categoryId !== category.value) return false;
      const needle = normalize(search.value);
      if (!needle) return true;
      return [tag.displayName, ...tag.aliases].some((value) => normalize(value).includes(needle));
    }

    function renderList() {
      list.replaceChildren();
      const visible = catalog.filter(matches);
      if (!visible.length) {
        list.appendChild(el('div', 'novelight-tags-no-match', '一致する公式タグがありません。'));
        return;
      }
      for (const tag of visible) {
        const button = el('button', 'novelight-tag-option', tag.displayName);
        button.type = 'button';
        const isSelected = selected.includes(tag.id);
        button.setAttribute('aria-pressed', String(isSelected));
        if (isSelected) button.classList.add('is-selected');
        button.addEventListener('click', () => {
          if (selected.includes(tag.id)) {
            selected = selected.filter((value) => value !== tag.id);
          } else {
            if (selected.length >= officialLimit) {
              message.textContent = `公式タグは最大${officialLimit}個です。`;
              return;
            }
            selected.push(tag.id);
            message.textContent = '';
          }
          renderAll();
          notify();
        });
        list.appendChild(button);
      }
    }

    function renderCustom() {
      if (!customList) return;
      customList.replaceChildren();
      for (const item of custom) {
        const chip = el('button', 'novelight-tag-chip novelight-tag-chip-custom', item.display + ' ×');
        chip.type = 'button';
        chip.setAttribute('aria-label', `${item.display}を外す`);
        chip.addEventListener('click', () => {
          custom = custom.filter((value) => value.key !== item.key);
          renderAll();
          notify();
        });
        customList.appendChild(chip);
      }
    }

    function renderAll() {
      counter.textContent = `公式タグ ${selected.length}/${officialLimit}`;
      renderSelected();
      renderList();
      renderCustom();
    }

    search.addEventListener('input', renderList);
    category.addEventListener('change', renderList);
    renderAll();

    return {
      ready: true,
      controller: Object.freeze({
        getOfficialTagIds: () => [...selected],
        getCustomTags: () => custom.map((item) => item.display),
        getCatalog: () => catalog.map((tag) => ({ ...tag }))
      })
    };
  }

  global.NovelightTags = Object.freeze({
    OFFICIAL_TAG_LIMIT,
    CUSTOM_TAG_LIMIT,
    CUSTOM_TAG_MAX_LENGTH,
    normalize,
    isMissingRpc,
    loadCatalog,
    fetchNovelTags,
    setNovelTags,
    mount
  });
})(globalThis);
