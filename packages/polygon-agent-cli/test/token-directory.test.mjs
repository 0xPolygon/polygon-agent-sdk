import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { importFresh, makeTempHome, withPatchedEnv } from './helpers.mjs';

async function loadTokenDirectory(home) {
  return withPatchedEnv({ HOME: home }, () =>
    importFresh('../src/lib/token-directory.ts', `token-directory-${Math.random()}`)
  );
}

test('resolveErc20BySymbol prefers verified matches and caches the fetched index/list', async () => {
  const home = makeTempHome('token-dir');
  const responses = new Map([
    [
      'https://raw.githubusercontent.com/0xsequence/token-directory/main/index/index.json',
      {
        index: {
          polygon: {
            chainId: 137,
            tokenLists: { 'erc20.json': 'sha256-abcdef1234567890' }
          }
        }
      }
    ],
    [
      'https://raw.githubusercontent.com/0xsequence/token-directory/main/index/polygon/erc20.json',
      {
        tokens: [
          {
            chainId: 137,
            address: '0xfirst',
            symbol: 'USDC',
            name: 'First USDC',
            decimals: 6
          },
          {
            chainId: 137,
            address: '0xverified',
            symbol: 'USDC',
            name: 'Verified USDC',
            decimals: 6,
            logoURI: 'https://example.com/logo.png',
            extensions: { verified: true }
          }
        ]
      }
    ]
  ]);

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    const body = responses.get(String(url));
    if (!body) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const tokenDirectory = await loadTokenDirectory(home);
    const { first, second } = await withPatchedEnv({ HOME: home }, async () => ({
      first: await tokenDirectory.resolveErc20BySymbol({ chainId: 137, symbol: 'usdc' }),
      second: await tokenDirectory.resolveErc20BySymbol({ chainId: 137, symbol: 'USDC' })
    }));

    assert.equal(first.address, '0xverified');
    assert.equal(second.address, '0xverified');
    assert.equal(fetchCount, 2);

    const cacheRoot = path.join(home, '.polygon-agent', 'token-directory');
    assert.ok(fs.existsSync(path.join(cacheRoot, 'index.main.json')));
    assert.ok(
      fs.readdirSync(cacheRoot).some((entry) => entry.startsWith('137.erc20.main.sha256-abcde'))
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadErc20ListForChain errors for unknown chains and resolveErc20BySymbol returns null for misses', async () => {
  const home = makeTempHome('token-dir-miss');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify({
        index: {
          polygon: {
            chainId: 137,
            tokenLists: { 'erc20.json': 'sha256-abcdef1234567890' }
          }
        }
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }
    );

  try {
    const tokenDirectory = await loadTokenDirectory(home);
    await withPatchedEnv({ HOME: home }, async () => {
      await assert.rejects(
        () => tokenDirectory.loadErc20ListForChain({ chainId: 999999 }),
        /unknown chainId=999999/
      );
    });

    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/index/index.json')) {
        return new Response(
          JSON.stringify({
            index: {
              polygon: {
                chainId: 137,
                tokenLists: { 'erc20.json': 'sha256-abcdef1234567890' }
              }
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }

      return new Response(JSON.stringify({ tokens: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const resolved = await withPatchedEnv({ HOME: home }, () =>
      tokenDirectory.resolveErc20BySymbol({ chainId: 137, symbol: 'WETH' })
    );
    assert.equal(resolved, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
