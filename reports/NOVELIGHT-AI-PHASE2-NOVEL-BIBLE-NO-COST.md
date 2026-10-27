# NOVELIGHT AI Phase 2 — Novel Bible no-cost index (development only)

## Purpose

Follow Chapter 47's Phase 2 sequence: extend the already-merged shared AI
foundation before introducing any public AI feature, provider expenses or
additional schema changes. This is an offline, author-only data projection
building block, not a new competing author notes screen.

## Added

- `api/_lib/ai/novel-bible.js` exports two deterministic functions.
- `planNovelBibleEpisodeChanges` compares title/body SHA-256 against
  `novelight_ai_episode_analysis.source_hash`, returning a bounded,
  stable worklist for only new or revised chapters. The returned plan contains
  **no manuscript content**. It does not schedule or execute analysis.
- `groupNovelBibleFacts` builds an author-only read model from existing
  `novelight_ai_bible_facts`, retaining separately the **author_confirmed**
  facts and the **ai_inferred** suggestions. Conflicting canonical facts are
  kept for author review, not silently overwritten.
- Both require trusted, server-verified ownership. Candidate records from
  another novel, duplicate episode or fact IDs, invalid hashes/payloads and
  oversized data are rejected.
- Tests explicitly cover no text in the change plan, changed-only revisions,
  batching, ownership isolation, provenance priority and collisions.

## Deliberately unchanged

- **AI remains globally disabled**; per-user and global budgets remain
  **0 micro-JPY** in Production and Staging.
- No provider credential, paid AI call, provider route, public API endpoint,
  UI, autonomous analysis, database mutation, migration or payment change.
- Existing Chapter 43 character and private world/plot notes remain the
  primary author interface. Phase 2 must eventually integrate with them,
  rather than create an unrelated second notebook.
- No automatic import of unpublished chapters or public reader data.
- Prior PR #2548's deployed migration `20261027120000` is reused as-is.

## Next separate steps

Server-side integration must fetch ownership and per-episode hashes from
authoritative database queries, under verified authenticated sessions.
Design the author-visible editor integrated with existing character and story
notes, durable safe caching, provenance corrections and controlled inference
only after explicit release gates. **Do not activate AI or increase budgets
as an incidental part of this step.**

**Release boundary:** this branch/PR and CI are development only. No automatic
Staging or Production execution. Protected-main merge would require the
proper approval if it deploys code.
