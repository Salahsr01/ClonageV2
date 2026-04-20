import { test } from 'node:test';
import assert from 'node:assert';
import { reproduceExact } from '../../src/reproducer-exact/index.js';

test('reproduceExact throws "Not implemented yet" until Task 6 orchestrator lands', async () => {
  await assert.rejects(
    reproduceExact({ clonePath: '/tmp/nope', outputDir: '/tmp/out' }),
    /Not implemented yet/
  );
});
