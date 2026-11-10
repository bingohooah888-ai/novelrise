// Move an OWNER-REVIEWED AI candidate into the existing Story Notes editor.
// This module never writes to Supabase, changes author canon or calls a model.
// Only the author's separate existing Save action persists the editable draft.
(function (root) {
  'use strict';

  const KINDS = new Set([
    'character',
    'relationship',
    'location',
    'world',
    'timeline',
    'event',
    'foreshadowing',
    'other'
  ]);

  function validText(value, limit) {
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= limit
    );
  }

  function validId(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function buildDraft(candidate) {
    if (
      !candidate ||
      !KINDS.has(candidate.kind) ||
      !validText(candidate.key, 120) ||
      !validText(candidate.summary, 320) ||
      !validText(candidate.evidence, 160) ||
      !validId(candidate.episodeId)
    ) {
      return null;
    }
    const noteType =
      candidate.kind === 'character'
        ? 'character'
        : candidate.kind === 'world' || candidate.kind === 'location'
          ? 'world'
          : 'plot';
    const title = candidate.key.trim();
    const body =
      '【作品カルテから転記した確認済みAI候補】\n' +
      '内容：' +
      candidate.summary.trim() +
      '\n本文根拠：' +
      candidate.evidence.trim() +
      '\n参照エピソードID：' +
      candidate.episodeId +
      '\n\n必要に応じて修正してから保存してください。';
    return Object.freeze({ noteType, title, body });
  }

  function prepare({ candidate, doc = root.document, allowReplace } = {}) {
    const draft = buildDraft(candidate);
    if (!draft || typeof doc?.getElementById !== 'function') return false;

    const names = [
      'noteForm',
      'noteId',
      'noteType',
      'character',
      'characterField',
      'title',
      'body',
      'formTitle',
      'save',
      'cancel',
      'titleCount',
      'bodyCount'
    ];
    const elements = Object.fromEntries(
      names.map((name) => [name, doc.getElementById(name)])
    );
    if (
      names.some((name) => !elements[name]) ||
      typeof elements.noteType.value !== 'string' ||
      typeof elements.title.value !== 'string' ||
      typeof elements.body.value !== 'string'
    ) {
      return false;
    }
    if (
      (elements.noteId.value ||
        elements.title.value.trim() ||
        elements.body.value.trim()) &&
      (typeof allowReplace !== 'function' || allowReplace() !== true)
    ) {
      return false;
    }

    // Never silently attach an AI-detected name to an existing character ID.
    // The author must select an actual character in the existing editor.
    elements.noteId.value = '';
    elements.noteType.value = draft.noteType;
    elements.character.value = '';
    elements.title.value = draft.title;
    elements.body.value = draft.body;
    elements.formTitle.textContent =
      '作品カルテの候補から創作ノートを作成（未保存）';
    elements.save.textContent = '内容を確認して保存';
    elements.cancel.hidden = false;
    elements.characterField.hidden = draft.noteType !== 'character';
    elements.titleCount.textContent = draft.title.length + ' / 120';
    elements.bodyCount.textContent = draft.body.length + ' / 20000';
    return true;
  }

  root.NovelightAiBibleNoteTransfer = Object.freeze({ buildDraft, prepare });
})(globalThis);
