import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import sealedbox from 'tweetnacl-sealedbox-js';

import { makeTempHome, parseJsonOutput, runCli } from './helpers.mjs';

function b64urlDecode(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

test('top-level help exposes the main CLI command groups', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /\bsetup\b/);
  assert.match(result.stdout, /\bwallet\b/);
  assert.match(result.stdout, /\bbalances\b/);
  assert.match(result.stdout, /\bpolymarket\b/);
  assert.match(result.stdout, /\bagent\b/);
});

test('wallet create/import/list/address/remove works through the real CLI with local session data', async () => {
  const home = makeTempHome('cli-wallet');
  const create = await runCli(
    [
      'wallet',
      'create',
      '--no-wait=true',
      '--name',
      'main',
      '--chain',
      'polygon',
      '--native-limit',
      '1.5',
      '--token-limit',
      'WETH:0.1',
      '--access-key',
      'pk_wallet_test'
    ],
    {
      env: {
        HOME: home,
        SEQUENCE_ECOSYSTEM_CONNECTOR_URL: 'https://agentconnect.polygon.technology'
      }
    }
  );

  assert.equal(create.code, 0, create.stderr);
  const createJson = parseJsonOutput(create.stdout);
  assert.equal(createJson.ok, true);
  assert.equal(createJson.walletName, 'main');

  const requestPath = path.join(home, '.polygon-agent', 'requests', `${createJson.rid}.json`);
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));

  const payload = {
    walletAddress: '0x' + '11'.repeat(20),
    chainId: 137,
    explicitSession: {
      pk: '0x' + '22'.repeat(32),
      sessionAddress: '0x' + '33'.repeat(20),
      config: { deadline: Math.floor(Date.now() / 1000) + 3600 }
    },
    implicit: {
      pk: '0x' + '44'.repeat(32),
      attestation: { ok: true },
      identitySignature: { sig: '0x1234' },
      guard: '0x' + '55'.repeat(20),
      loginMethod: 'email',
      userEmail: 'agent@example.com'
    }
  };

  const ciphertext = b64urlEncode(
    sealedbox.seal(
      Buffer.from(JSON.stringify(payload), 'utf8'),
      new Uint8Array(b64urlDecode(request.publicKeyB64u))
    )
  );

  const imported = await runCli(
    ['wallet', 'import', '--name', 'main', '--rid', createJson.rid, '--ciphertext', ciphertext],
    { env: { HOME: home } }
  );
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(parseJsonOutput(imported.stdout).walletAddress, payload.walletAddress);

  const listed = await runCli(['wallet', 'list'], { env: { HOME: home } });
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(parseJsonOutput(listed.stdout).wallets, [
    {
      name: 'main',
      address: payload.walletAddress,
      chain: 'polygon',
      chainId: 137
    }
  ]);

  const address = await runCli(['wallet', 'address', '--name', 'main'], { env: { HOME: home } });
  assert.equal(address.code, 0, address.stderr);
  assert.equal(parseJsonOutput(address.stdout).walletAddress, payload.walletAddress);

  const removed = await runCli(['wallet', 'remove', '--name', 'main'], { env: { HOME: home } });
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(parseJsonOutput(removed.stdout).ok, true);
});
