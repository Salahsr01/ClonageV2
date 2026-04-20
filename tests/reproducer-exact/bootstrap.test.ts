import { test } from 'node:test';
import assert from 'node:assert';
import { reproduceExact } from '../../src/reproducer-exact/index.js';

test('reproduceExact throws "Not implemented yet" before Task 5', async () => {
  await assert.rejects(
    reproduceExact({ clonePath: '/tmp/nope', outputDir: '/tmp/out' }),
    /Not implemented yet/
  );
});
