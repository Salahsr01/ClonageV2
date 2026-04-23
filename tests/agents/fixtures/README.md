# tests/agents/fixtures

Symbolic links to 2 known clones used by agent tests in S2–S6. Linking instead
of copying keeps the test fixtures cheap (each clone is ~40 MB).

## Included

- `mersi` → `output/www.mersi-architecture.com_2026-04-17/` (reference site used by
  Grounding acceptance criterion in `REFACTOR_BRIEF.md` §6 S2).
- `raviklaassens` → `output/www.raviklaassens.com_2026-04-15/` (moody editorial
  site used for Planning candidate diversity).

## Refresh

If the symlink target moves, recreate with:

```bash
ln -sfn ../../../output/www.mersi-architecture.com_2026-04-17 tests/agents/fixtures/mersi
ln -sfn ../../../output/www.raviklaassens.com_2026-04-15      tests/agents/fixtures/raviklaassens
```
