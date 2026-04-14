import * as esbuild from 'esbuild';

// Bundle the CLI with agent-shared inlined. All other node_modules packages
// remain as external runtime dependencies — they are listed in package.json
// dependencies and installed by npm/pnpm when the CLI is installed globally.
//
// agent-shared is private and not on npm, so it must be inlined. esbuild
// follows the workspace symlink, reads the TypeScript source directly, and
// includes the compiled output in dist/index.js.
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2023',
  format: 'esm',
  outfile: 'dist/index.js',
  plugins: [
    {
      name: 'external-node-modules',
      setup(build) {
        // Mark every bare import (node_modules package) as external,
        // EXCEPT @polygonlabs/agent-shared which we inline.
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@polygonlabs/agent-shared')) return null;
          return { external: true };
        });
      }
    }
  ]
});

console.log('Build complete: dist/index.js');
