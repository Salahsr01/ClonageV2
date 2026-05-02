## Cursor Cloud specific instructions

### Overview

**Clonage** is a TypeScript CLI tool for cloning, analysing, and regenerating award-winning websites.
The deterministic rebrand pipeline is fully functional (no API keys needed); the AI-powered compose pipeline requires `ANTHROPIC_API_KEY`.

### Build & Run

Standard commands are in `package.json`:

- `npm run build` — compiles `src/` → `dist/` (TypeScript)
- `npm test` — compiles tests to `dist-test/` then runs them with Node's built-in test runner
- `node dist/cli.js <command>` — run any CLI command (see `--help`)

### Running tests

The `npm test` script uses a glob pattern that requires Node ≥ 21 for native glob expansion.
On Node 20, use `find` to enumerate test files:

```
tsc -p tsconfig.test.json && find dist-test/tests -name "*.test.js" | xargs node --test
```

### Preview server

The preview server (`src/server.ts`) is started internally by commands like `replay` and `clone-and-rebrand`.
To start it manually for a directory:

```
node -e "const {startServer} = require('./dist/server.js'); startServer('/absolute/path/to/dir')"
```

It listens on `localhost:4700`. The `rootDir` argument **must be an absolute path** for the path-security check to pass (relative paths cause 403 errors).

### Environment variables

- `ANTHROPIC_API_KEY` — required for AI features (compose, brief-gen, grounding, planning, generation, validator)
- `OPENAI_API_KEY` — optional; enables real embeddings in the atlas (falls back to hash-based)
- `HF_TOKEN` — optional last-resort LLM fallback via HuggingFace Inference

### Key gotchas

- Playwright Chromium must be installed separately (`npx playwright install chromium`); without it, clone/record/replay/reproduce-exact/validator commands fail.
- The deterministic rebrand pipeline (rebrand command + all 58+ rebrand tests) works with **zero API keys**.
- There is no `serve` CLI command; use the manual server start shown above.
- Output directories (`output/`, `generated/`, `.clonage-kb/`) are gitignored and created on demand.
