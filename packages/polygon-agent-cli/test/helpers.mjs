import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function makeTempHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export async function importFresh(modulePath, tag = Date.now().toString()) {
  return import(`${modulePath}?t=${encodeURIComponent(tag)}`);
}

export async function withPatchedEnv(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function runCli(args, options = {}) {
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const cliEntry = path.join(repoRoot, 'packages/polygon-agent-cli/src/index.ts');

  try {
    const result = await execFileAsync('node', [cliEntry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      timeout: options.timeout ?? 15000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024
    });

    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      error
    };
  }
}

export function parseJsonOutput(stdout) {
  return JSON.parse(String(stdout).trim());
}
