import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { importFresh, makeTempHome, withPatchedEnv } from './helpers.mjs';

async function loadStorageModule(home) {
  return withPatchedEnv({ HOME: home }, () =>
    importFresh('../src/lib/storage.ts', `storage-${Math.random()}`)
  );
}

test('builder config is persisted and private key is encrypted at rest', async () => {
  const home = makeTempHome('storage-builder');
  const storage = await loadStorageModule(home);

  await storage.saveBuilderConfig({
    privateKey: '0x' + '11'.repeat(32),
    eoaAddress: '0x' + '22'.repeat(20),
    accessKey: 'pk_test',
    projectId: 123
  });

  const stored = JSON.parse(
    fs.readFileSync(path.join(home, '.polygon-agent', 'builder.json'), 'utf8')
  );
  assert.equal(typeof stored.privateKey.iv, 'string');
  assert.notEqual(stored.privateKey.encrypted, '0x' + '11'.repeat(32));

  const loaded = await storage.loadBuilderConfig();
  assert.deepEqual(loaded, {
    privateKey: '0x' + '11'.repeat(32),
    eoaAddress: '0x' + '22'.repeat(20),
    accessKey: 'pk_test',
    projectId: 123
  });
});

test('wallet sessions and requests can be listed and deleted', async () => {
  const home = makeTempHome('storage-wallet');
  const storage = await loadStorageModule(home);

  await storage.saveWalletSession('main', {
    walletAddress: '0x' + '33'.repeat(20),
    chainId: 137,
    chain: 'polygon',
    projectAccessKey: 'pk_wallet',
    explicitSession: '{"pk":"0xabc"}',
    sessionPk: '0xabc',
    implicitPk: '0xdef',
    implicitMeta: '{}',
    implicitAttestation: '{}',
    implicitIdentitySig: '{}',
    createdAt: '2026-03-06T00:00:00.000Z'
  });

  await storage.saveWalletRequest('rid-1', {
    rid: 'rid-1',
    walletName: 'main',
    chain: 'polygon',
    createdAt: '2026-03-06T00:00:00.000Z',
    expiresAt: '2026-03-06T02:00:00.000Z',
    publicKeyB64u: 'pub',
    privateKeyB64u: 'priv',
    projectAccessKey: 'pk_wallet'
  });

  assert.equal((await storage.loadWalletSession('main')).walletAddress, '0x' + '33'.repeat(20));
  assert.equal((await storage.loadWalletRequest('rid-1')).walletName, 'main');
  assert.deepEqual(await storage.listWallets(), ['main']);
  assert.equal(await storage.deleteWallet('main'), true);
  assert.equal(await storage.deleteWallet('missing'), false);
  assert.equal(await storage.loadWalletSession('main'), null);
});

test('polymarket key helpers use the dedicated key when present and fall back to builder key', async () => {
  const home = makeTempHome('storage-polymarket');
  const storage = await loadStorageModule(home);

  await storage.saveBuilderConfig({
    privateKey: '0x' + '44'.repeat(32),
    eoaAddress: '0x' + '55'.repeat(20),
    accessKey: 'pk_test',
    projectId: 456
  });

  assert.equal(await storage.loadPolymarketKey(), '0x' + '44'.repeat(32));

  await storage.savePolymarketKey('0x' + '66'.repeat(32));
  assert.equal(await storage.loadPolymarketKey(), '0x' + '66'.repeat(32));
});
