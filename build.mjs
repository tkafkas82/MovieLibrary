// Build standalone, cross-platform helper binaries — no Node needed on the
// target machine.
//
//   1. esbuild bundles the ESM helper (server.js + lib/*) + express into a
//      single CommonJS file. This keeps the source clean ESM while giving pkg
//      the CJS single-file input it packages most reliably.
//   2. @yao-pkg/pkg wraps that bundle in a Node runtime for each target OS.
//   3. The static UI (public/) is copied next to the binaries so they can also
//      serve the local app; ship just the binary if you only need the API
//      helper for a hosted (Vercel) UI.
//
// Run: npm run build   (first run downloads each target's base binary)

import { build } from 'esbuild';
import { exec } from '@yao-pkg/pkg';
import fs from 'node:fs';
import path from 'node:path';

const BUNDLE = 'build/helper.cjs';
const OUT = 'dist';

// pkg target → output filename. node22 has prebuilt base binaries for every
// target (node18 does not in current pkg, and would try to compile from
// source). Covers Intel + Apple-Silicon Macs.
const TARGETS = [
  { target: 'node22-win-x64',     out: 'movielibrary-helper-win-x64.exe' },
  { target: 'node22-macos-x64',   out: 'movielibrary-helper-macos-x64' },
  { target: 'node22-macos-arm64', out: 'movielibrary-helper-macos-arm64' },
  { target: 'node22-linux-x64',   out: 'movielibrary-helper-linux-x64' },
];

console.log('▸ Bundling ESM → CommonJS with esbuild…');
await build({
  entryPoints: ['server.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: BUNDLE,
  logLevel: 'error', // ignore express's optional dynamic-require warnings
});
console.log(`  ✓ ${BUNDLE}`);

fs.mkdirSync(OUT, { recursive: true });

for (const { target, out } of TARGETS) {
  const outPath = path.join(OUT, out);
  console.log(`▸ Packaging ${target} → ${outPath}`);
  // --no-bytecode + --public: embed plain JS instead of V8 bytecode. Bytecode
  // generation spawns the *target* Node binary, which is impossible when
  // cross-compiling (and flaky on Windows). Our bundle is already one file, so
  // there's nothing to hide anyway.
  await exec([BUNDLE, '--target', target, '--output', outPath, '--no-bytecode', '--public']);
}

console.log('▸ Copying UI (public/) next to the binaries…');
fs.cpSync('public', path.join(OUT, 'public'), { recursive: true });

console.log(`\n✅ Done. Binaries + public/ are in ./${OUT}/`);
console.log('   • Ship a binary alone  → API-only helper for your hosted UI.');
console.log('   • Ship a binary + public/ folder → also serves the local app.\n');
