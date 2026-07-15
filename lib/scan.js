// Recursive disk walk that collects video files matching the configured
// extensions. Skips system/junk folders and symlinks (avoids permission
// spam and directory-junction loops), and swallows EACCES/EPERM quietly.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'windows', 'winsxs',
  'node_modules', '$sysreset', 'recovery', 'msocache', '$windows.~ws',
  '$windows.~bt', 'programdata', 'perflogs', 'appdata',
]);

export async function scanRoots(roots, exts, onProgress) {
  const extSet = new Set(exts.map((e) => e.toLowerCase()));
  const results = [];
  // Real paths already walked — lets us follow directory junctions/symlinks
  // (so every subpath under the entered folder is scanned) while guaranteeing
  // we never loop through a reparse point that points back into the tree.
  const visited = new Set();
  for (const root of roots) {
    if (!root) continue;
    await walk(root, extSet, results, onProgress, visited);
  }
  return results;
}

async function walk(dir, extSet, results, onProgress, visited) {
  let real;
  try { real = await fs.promises.realpath(dir); } catch { real = dir; }
  if (visited.has(real)) return; // already walked (or a junction loop) — skip
  visited.add(real);

  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable / access denied — skip silently
  }

  onProgress?.(dir, results.length);

  for (const ent of entries) {
    const full = path.join(dir, ent.name);

    // Resolve symlinks/junctions to whatever they actually point at, so linked
    // folders get scanned too (the `visited` set above prevents cycles).
    let isDir = ent.isDirectory();
    let isFile = ent.isFile();
    if (ent.isSymbolicLink()) {
      try {
        const st = await fs.promises.stat(full); // follows the link
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch { continue; } // dangling link — skip
    }

    if (isDir) {
      if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
      if (ent.name.startsWith('$')) continue;
      await walk(full, extSet, results, onProgress, visited);
    } else if (isFile) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!extSet.has(ext)) continue;
      let size = 0;
      let mtime = 0;
      try {
        const st = await fs.promises.stat(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch { /* ignore */ }
      results.push({ path: full, fileName: ent.name, size, mtime });
    }
  }
}

// Best-effort list of likely scan roots for the settings UI to suggest, per OS:
//   • Windows — existing drive letters C:\ .. Z:\
//   • macOS   — mounted volumes under /Volumes + the home folder
//   • Linux   — mounts under /media/<user>, /mnt + the home folder
// Purely suggestions; the user can type any absolute path.
export function listDrives() {
  const out = [];
  const add = (p) => { try { if (p && fs.existsSync(p) && !out.includes(p)) out.push(p); } catch { /* ignore */ } };
  const listChildren = (dir) => {
    try { return fs.readdirSync(dir).map((n) => path.join(dir, n)); } catch { return []; }
  };

  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) add(String.fromCharCode(c) + ':\\'); // C..Z
  } else if (process.platform === 'darwin') {
    listChildren('/Volumes').forEach(add);
    add(os.homedir());
  } else {
    listChildren(path.join('/media', os.userInfo().username || '')).forEach(add);
    listChildren('/media').forEach(add);
    listChildren('/mnt').forEach(add);
    add(os.homedir());
  }
  return out;
}
