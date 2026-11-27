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

  // Search only the existing in-memory owner note snapshot. No new retrieval,
  // persistent search history, AI inference, or modification of the source list.
  function filterNotes({ notes, type = 'all', query = '', character = 'all' } = {}) {
    if (
      !Array.isArray(notes) ||
      !['all', 'plot', 'world', 'character'].includes(type) ||
      typeof query !== 'string' ||
      query.length > 120 ||
      typeof character !== 'string' ||
      !/^(?:all|unassigned|[1-9][0-9]{0,15})$/u.test(character)
    ) return [];
    const normalize = (value) =>
      typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : '';
    const needle = normalize(query).trim();
    return notes.filter((note) => {
      if (!note || typeof note !== 'object') return false;
      if (type !== 'all' && note.note_type !== type) return false;
      if (type === 'character' && character !== 'all') {
        if (character === 'unassigned') {
          if (note.character_id != null) return false;
        } else if (String(note.character_id) !== character) {
          return false;
        }
      }
      return !needle || [note.title, note.body, note.character_name]
        .some((value) => normalize(value).includes(needle));
    });
  }

  // Same category and, for character notes, same existing character ID.
  // Equal headings are only a review cue, not a contradiction or duplicate fact.
  function duplicateHeadingNotes(notes) {
    if (!Array.isArray(notes)) return [];
    const groups = new Map();
    for (const note of notes) {
      if (!note || typeof note.title !== 'string' ||
          !categories.some(([key]) => key === note.note_type)) continue;
      const title = note.title.normalize('NFKC').trim().toLowerCase();
      if (!title) continue;
      if (note.note_type === 'character' && note.character_id == null) continue;
      const key = JSON.stringify([note.note_type,
        note.note_type === 'character' ? String(note.character_id) : '', title]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note);
    }
    const duplicates = new Set([...groups.values()]
      .filter((group) => group.length > 1).flat());
    return notes.filter((note) => duplicates.has(note));
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
    filterNotes,
    duplicateHeadingNotes,
    sameOwner
  });
})(typeof window === 'object' ? window : globalThis);
