import assert from 'node:assert/strict';
import test from 'node:test';

import { ethers } from 'ethers';

import { generateEthAuthProof, generateEthAuthProofWithExpiration } from '../src/lib/ethauth.ts';

const ETH_AUTH_DOMAIN = {
  name: 'ETHAuth',
  version: '1'
};

function decodeProof(proof) {
  const [prefix, address, claimsB64, signature] = proof.split('.');
  const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
  return { prefix, address, claims, signature };
}

function buildTypedData(claims) {
  const fields = [];
  const message = {};

  for (const [name, type] of [
    ['app', 'string'],
    ['iat', 'int64'],
    ['exp', 'int64'],
    ['n', 'uint64'],
    ['typ', 'string'],
    ['ogn', 'string'],
    ['v', 'string']
  ]) {
    const value = claims[name];
    if (value == null || value === '' || value === 0) continue;
    fields.push({ name, type });
    message[name] = value;
  }

  return {
    domain: ETH_AUTH_DOMAIN,
    types: { Claims: fields },
    message
  };
}

test('generateEthAuthProof emits a verifiable proof with default claims', async () => {
  const wallet = ethers.Wallet.createRandom();
  const proof = await generateEthAuthProof(wallet.privateKey);
  const decoded = decodeProof(proof);
  const typed = buildTypedData(decoded.claims);

  assert.equal(decoded.prefix, 'eth');
  assert.equal(decoded.address, wallet.address.toLowerCase());
  assert.equal(decoded.claims.app, 'sequence-builder');
  assert.equal(decoded.claims.v, '1');

  const recovered = ethers.verifyTypedData(
    typed.domain,
    typed.types,
    typed.message,
    decoded.signature
  );

  assert.equal(recovered.toLowerCase(), wallet.address.toLowerCase());
});

test('generateEthAuthProof respects custom claims', async () => {
  const wallet = ethers.Wallet.createRandom();
  const proof = await generateEthAuthProof(wallet.privateKey, {
    app: 'custom-app',
    typ: 'auth',
    ogn: 'polygon-agent',
    n: 42
  });
  const decoded = decodeProof(proof);

  assert.equal(decoded.claims.app, 'custom-app');
  assert.equal(decoded.claims.typ, 'auth');
  assert.equal(decoded.claims.ogn, 'polygon-agent');
  assert.equal(decoded.claims.n, 42);
});

test('generateEthAuthProofWithExpiration sets a bounded expiry window', async () => {
  const wallet = ethers.Wallet.createRandom();
  const before = Math.floor(Date.now() / 1000);
  const proof = await generateEthAuthProofWithExpiration(wallet.privateKey, 120);
  const after = Math.floor(Date.now() / 1000);
  const { claims } = decodeProof(proof);

  assert.ok(claims.iat >= before && claims.iat <= after);
  assert.ok(claims.exp >= before + 120 && claims.exp <= after + 120);
});
