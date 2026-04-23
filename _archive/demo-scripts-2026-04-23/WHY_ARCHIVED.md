# Demo scripts used during the 2026-04-23 naughtyduk.com end-to-end run

Archived on 2026-04-23 once the logic they wrapped was promoted to proper
TypeScript modules in `src/`.

| Script                | Replaced by                                          |
|---|---|
| `capture-live.mjs`    | *(not promoted — one-off)*. A tiny Playwright helper that fetched a live URL, waited for hydration, scrolled, then dumped the hydrated DOM + inlined CSS as a static HTML clone. Not useful long-term because SPA sites must go through `record` + `replay` (HAR). Kept here as reference. |
| `ground-fake.mjs`     | Not promoted. Thin wrapper that ran the Grounding agent with a `FakeVisionLLM`. Replaced by a proper `--llm=fake` flag if needed, or by passing an API key. |
| `ground-all-kb.mjs`   | Not promoted. Batch-grounded every site in `.clonage-kb/sections/`. Use the atlas index command in a loop instead. |
| `compose-fake.mjs`    | Not promoted. Wrapper that ran `compose()` with a Fake text LLM. Mirror behavior is achieved by `clonage compose --plan-only` (still needs a real LLM for full runs). |
| **`rebrand-har.mjs`** | **Promoted to `src/rebrand-har/`** (module, zod schema, unit + e2e tests, CLI command `clonage rebrand-har`). |

See the 2026-04-23 conversation for the context in which these were written.
