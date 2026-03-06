import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  fileCoerce,
  normalizeChain,
  resolveNetwork,
  formatUnits,
  parseUnits,
  getRpcUrl,
  getExplorerUrl
} from '../src/lib/utils.ts';
import { makeTempHome, withPatchedEnv } from './helpers.mjs';

test('fileCoerce reads @file values and trims whitespace', () => {
  const dir = makeTempHome('utils-file');
  const file = path.join(dir, 'value.txt');
  fs.writeFileSync(file, '  hello world  \n');

  assert.equal(fileCoerce(`@${file}`), 'hello world');
  assert.equal(fileCoerce('literal'), 'literal');
});

test('normalizeChain keeps polygon as default and maps matic', () => {
  assert.equal(normalizeChain(undefined), 'polygon');
  assert.equal(normalizeChain('matic'), 'polygon');
  assert.equal(normalizeChain('Amoy'), 'amoy');
});

test('resolveNetwork supports both chain names and numeric ids', () => {
  assert.equal(resolveNetwork('polygon').chainId, 137);
  assert.equal(resolveNetwork(137).name.toLowerCase(), 'polygon');
  assert.throws(() => resolveNetwork('unknown-chain'), /Unknown chain/);
});

test('formatUnits and parseUnits round-trip common decimal values', () => {
  assert.equal(formatUnits(1500000n, 6), '1.5');
  assert.equal(formatUnits('1000000000000000000', 18), '1');
  assert.equal(parseUnits('1.5', 6), 1500000n);
  assert.equal(parseUnits('0.000001', 6), 1n);
});

test('getRpcUrl and getExplorerUrl derive network-specific URLs', async () => {
  const polygon = resolveNetwork('polygon');

  await withPatchedEnv({ SEQUENCE_PROJECT_ACCESS_KEY: 'pk_test_123' }, async () => {
    assert.equal(getRpcUrl(polygon), 'https://nodes.sequence.app/polygon/pk_test_123');
  });

  assert.match(getExplorerUrl(polygon, '0xabc'), /^https:\/\/polygonscan\.com\/tx\/0xabc$/);
});
