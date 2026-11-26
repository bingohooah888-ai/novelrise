(function (root) {
  'use strict';

  const categories = [
    ['plot', 'プロット・構成'],
    ['character', '人物設定'],
    ['world', '世界観']
  ];

  function buildPackage({ title, notes, selected } = {}) {
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      !Array.isArray(notes) ||
      !Array.isArray(selected) ||
      !selected.length ||
      selected.some((value) => !categories.some(([key]) => key === value))
    ) return null;
    const sections = ['非公開・作者用作品資料', '作品：' + title];
    let count = 0;
    let length = sections.join('\n').length;
    for (const [key, label] of categories) {
      if (!selected.includes(key)) continue;
      const entries = notes.filter((note) => note?.note_type === key);
      sections.push('\n【' + label + '】');
      for (const note of entries) {
        if (
          typeof note.title !== 'string' ||
          typeof note.body !== 'string' ||
          (note.character_name != null &&
            typeof note.character_name !== 'string')
        ) return null;
        const character = key === 'character'
          ? '人物：' + (note.character_name || '登録解除済み') + '\n'
          : '';
        const text = '■ ' + note.title + '\n' + character + note.body;
        length += text.length;
        if (length > 4000000) return null;
        sections.push(text);
        count += 1;
      }
      if (!entries.length) sections.push('（保存済みノートなし）');
    }
    if (!count) return null;
    return Object.freeze({ count, text: sections.join('\n\n') + '\n' });
  }

  function sameOwner(initial, current) {
    return Boolean(
      initial?.user?.id &&
      initial.access_token &&
      current?.user?.id === initial.user.id &&
      current.access_token === initial.access_token
    );
  }

  root.NovelightPrivateStoryPackage = Object.freeze({
    buildPackage,
    sameOwner
  });
})(typeof window === 'object' ? window : globalThis);
