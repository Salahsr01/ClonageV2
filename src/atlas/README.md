# Atlas — RAG vectoriel local (S3)

Status: **stub — to implement in Week 3** (REFACTOR_BRIEF.md §4.3)

## Purpose

Semantic search over grounded sections. Powers Planning to pick candidates by role + mood + brief.

## Stack

- **Backend:** ChromaDB embedded (JS, no server) or Qdrant via Docker.
- **Embeddings:** `text-embedding-3-small` (OpenAI) by default, `@xenova/transformers` (`all-MiniLM-L6-v2`) as offline option.

## Content

- One vector per section (embedding of `signature + role + mood + layout`).
- Metadata = the full `.ground.json` from Grounding.
- Filters: role, mood, source site.

## Interface

```ts
atlas.query({
  brief: "studio d'architecture moody à Paris",
  roleFilter: 'hero',
  moodFilter: ['moody', 'editorial'],
  topK: 5
}) // → Array<GroundedSection>
```

## Files

- `embeddings.ts` — embedding fetcher (OpenAI or Xenova).
- `store.ts` — ChromaDB (or Qdrant) CRUD.
- `query.ts` — semantic search with filters.
- `index.ts` — public API.

## CLI hooks (to add in S3)

- `clonage atlas index <clone-dir>` — feed the atlas.
- `clonage atlas search --query "..." --role hero` — debug search.
