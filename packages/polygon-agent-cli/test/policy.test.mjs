import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { importFresh, makeTempHome, withPatchedEnv } from './helpers.mjs';

async function loadPolicyModule(home) {
  return withPatchedEnv({ HOME: home }, () =>
    importFresh('../src/lib/policy.ts', `policy-${Math.random()}`)
  );
}

test('loadPolicy supports JSON and applies defaults', async () => {
  const home = makeTempHome('policy-json');
  const policy = await loadPolicyModule(home);
  const fp = path.join(home, 'policy.json');
  fs.writeFileSync(
    fp,
    JSON.stringify({
      version: 1,
      name: 'json-policy',
      wallet: 'ops',
      signalRules: { minConfidenceScore: 0.8 }
    })
  );

  const loaded = policy.loadPolicy(fp);
  assert.equal(loaded.name, 'json-policy');
  assert.equal(loaded.wallet, 'ops');
  assert.equal(loaded.signalRules.minConfidenceScore, 0.8);
  assert.equal(loaded.risk.maxOpenOrders, 10);
});

test('loadPolicy supports basic YAML policy files', async () => {
  const home = makeTempHome('policy-yaml');
  const policy = await loadPolicyModule(home);
  const fp = path.join(home, 'policy.yaml');
  fs.writeFileSync(
    fp,
    [
      'version: 1',
      'name: yaml-policy',
      'wallet: main',
      'marketUniverse:',
      '  minVolume24hrUsd: 100000',
      'signalRules:',
      '  minConfidenceScore: 0.7',
      'automation:',
      '  jobs:',
      '    - name: morning-status',
      '      type: treasury-status',
      '      intervalSeconds: 1800'
    ].join('\n')
  );

  const loaded = policy.loadPolicy(fp);
  assert.equal(loaded.name, 'yaml-policy');
  assert.equal(loaded.marketUniverse.minVolume24hrUsd, 100000);
  assert.equal(loaded.signalRules.minConfidenceScore, 0.7);
  assert.equal(loaded.automation.jobs[0].name, 'morning-status');
});
