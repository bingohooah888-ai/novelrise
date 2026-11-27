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

  // Author's own saved world notes, not inferred terms or a public glossary.
  function glossaryEntries(notes) {
    if (!Array.isArray(notes)) return [];
    return notes.filter((note) => note?.note_type === 'world' &&
      typeof note.title === 'string' && note.title.trim() &&
      typeof note.body === 'string').map((note) => ({
      title: note.title, body: note.body
    })).sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  }

  function packageCounts(notes) {
    if (!Array.isArray(notes)) return [];
    return categories.map(([key, label]) => ({
      key, label, count: notes.filter((note) => note?.note_type === key).length
    }));
  }

  // Bounded, exact local comparison of two texts explicitly supplied by the
  // author. Shared windows are not a plagiarism, originality or quality score.
  function comparePassages(reference, candidate) {
    const limit = 12000;
    const windowSize = 20;
    if ([reference, candidate].some((value) =>
      typeof value !== 'string' || value.length > limit)) return null;
    const windows = (value) => {
      const chars = Array.from(value.replace(/\s+/gu, ''));
      const result = new Set();
      for (let i = 0; i + windowSize <= chars.length; i += 1) {
        result.add(chars.slice(i, i + windowSize).join(''));
      }
      return result;
    };
    const ref = windows(reference);
    const target = windows(candidate);
    if (!ref.size || !target.size) return null;
    let shared = 0;
    for (const part of target) if (ref.has(part)) shared += 1;
    // Report at most five candidate line locations for review, not text.
    const lines = candidate.split(/\r?\n/u);
    const lineCandidates = [];
    for (let i = 0; i < lines.length && lineCandidates.length < 5; i += 1) {
      const parts = windows(lines[i]);
      if ([...parts].some((part) => ref.has(part))) lineCandidates.push(i + 1);
    }
    return Object.freeze({
      windowSize, referenceWindows: ref.size, candidateWindows: target.size, shared,
      lineCandidates: Object.freeze(lineCandidates)
    });
  }

  // User-entered source/target pairs, separated by a literal tab. No automatic
  // translation or inference. A missing spelling is only a review cue.
  function checkTranslationTerms(source, target, mapping) {
    if ([source, target].some((value) =>
      typeof value !== 'string' || !value.trim() || value.length > 12000) ||
      typeof mapping !== 'string' || mapping.length > 6000) return null;
    const lines = mapping.split(/\r?\n/u).filter((line) => line.trim());
    if (!lines.length || lines.length > 50) return null;
    const seen = new Set();
    const result = [];
    const count = (text, term) => {
      let total = 0;
      let offset = 0;
      while ((offset = text.indexOf(term, offset)) !== -1) {
        total += 1;
        offset += term.length;
      }
      return total;
    };
    for (const line of lines) {
      const pair = line.split('\t').map((value) => value.trim());
      if (pair.length !== 2 || pair.some((value) => !value || value.length > 100) ||
          seen.has(pair[0])) return null;
      seen.add(pair[0]);
      const sourceCount = count(source, pair[0]);
      const targetCount = count(target, pair[1]);
      result.push(Object.freeze({
        sourceTerm: pair[0], targetTerm: pair[1], sourceCount, targetCount,
        review: sourceCount > 0 && targetCount !== sourceCount
      }));
    }
    return Object.freeze(result);
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
    glossaryEntries,
    packageCounts,
    comparePassages,
    checkTranslationTerms,
    sameOwner
  });
})(typeof window === 'object' ? window : globalThis);
