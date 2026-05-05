import { defineConfig } from 'eslint/config';

import { recommended, typescript } from '@polygonlabs/apps-team-lint';

export default defineConfig([
  ...recommended({ globals: 'node' }),
  ...typescript({ tsconfigRootDir: import.meta.dirname }),
  // Flue requires agents to be default-exported — that's how the framework
  // discovers them. Override the team-wide rule for the agent files only.
  {
    files: ['.flue/agents/**/*.ts'],
    rules: { 'import-x/no-default-export': 'off' }
  },
  { ignores: ['dist/**'] }
]);
