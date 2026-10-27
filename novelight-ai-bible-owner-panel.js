// Standalone author-studio prototype; NOT loaded by any page until reviewed.
// No script tag, menu link, API keys, automatic model calls or publication.
(function (root) {
  'use strict';

  function workId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const string = String(value);
    if (!/^[1-9]\d*$/.test(string)) return null;
    const id = Number(string);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function element(doc, tag, text, className) {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function section(doc, title, records, renderItem) {
    const area = element(doc, 'section', undefined, 'ai-bible-section');
    area.appendChild(element(doc, 'h3', title));
    if (!records.length) {
      area.appendChild(element(doc, 'p', '登録された情報はまだありません。'));
      return area;
    }
    const list = element(doc, 'ul');
    for (const item of records) {
      const li = element(doc, 'li');
      li.appendChild(renderItem(item));
      list.appendChild(li);
    }
    area.appendChild(list);
    return area;
  }

  function render({ target, doc, payload }) {
    if (
      !payload ||
      !Array.isArray(payload.characters) ||
      payload.characters.length > 100 ||
      !Array.isArray(payload.notes) ||
      payload.notes.length > 200 ||
      !Array.isArray(payload.facts) ||
      payload.facts.length > 200
    ) {
      return false;
    }
    const fragment = doc.createDocumentFragment();
    fragment.appendChild(element(doc, 'h2', '作品カルテ（管理人限定）'));
    fragment.appendChild(
      element(doc, 'p', '既存の登場人物と創作ノートを読み取り専用で表示します。AIによる文章生成・書き換えは行いません。')
    );
    fragment.appendChild(
      section(doc, '登場人物', payload.characters, (character) =>
        element(doc, 'span', character.name || '名称なし')
      )
    );
    fragment.appendChild(
      section(doc, '創作ノート（非公開）', payload.notes, (note) => {
        const block = element(doc, 'div');
        block.appendChild(element(doc, 'strong', note.title || '無題'));
        block.appendChild(element(doc, 'p', note.body || ''));
        return block;
      })
    );
    fragment.appendChild(
      section(doc, '作品カルテの確認候補', payload.facts, (fact) =>
        element(doc, 'span', (fact.kind || '設定') + '：' + (fact.key || ''))
      )
    );
    target.replaceChildren(fragment);
    target.hidden = false;
    return true;
  }

  // An owning author session must already be present. A denied endpoint keeps
  // the panel absent; neither a reader nor another author sees a placeholder.
  async function mount({
    target,
    client,
    novelId,
    fetcher = root.fetch,
    doc = root.document
  }) {
    if (!target) return false;
    target.hidden = true;
    const id = workId(novelId);
    if (!id || !client?.auth?.getSession || !doc || !fetcher) return false;
    try {
      const { data, error } = await client.auth.getSession();
      const token = !error && data?.session?.access_token;
      if (typeof token !== 'string' || !token) return false;
      const response = await fetcher(
        '/api/ai-owner-novel-bible?novel_id=' + encodeURIComponent(id),
        {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );
      if (!response.ok) return false;
      return render({ target, doc, payload: await response.json() });
    } catch {
      return false;
    }
  }

  root.NovelightAiBibleOwnerPanel = Object.freeze({ mount, render });
})(globalThis);
