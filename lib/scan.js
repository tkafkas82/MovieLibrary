// Recursive disk walk that collects video files matching the configured
// extensions. Skips system/junk folders and symlinks (avoids permission
// spam and directory-junction loops), and swallows EACCES/EPERM quietly.

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'windows', 'winsxs',
  'node_modules', '$sysreset', 'recovery', 'msocache', '$windows.~ws',
  '$windows.~bt', 'programdata', 'perflogs', 'appdata',
]);

export async function scanRoots(roots, exts, onProgress) {
  const extSet = new Set(exts.map((e) => e.toLowerCase()));
  const results = [];
  for (const root of roots) {
    if (!root) continue;
    await walk(root, extSet, results, onProgress);
  }
  return results;
}

async function walk(dir, extSet, results, onProgress) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable / access denied — skip silently
  }

  onProgress?.(dir, results.length);

  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue; // don't follow junctions/symlinks
    const full = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
      if (ent.name.startsWith('$')) continue;
      await walk(full, extSet, results, onProgress);
    } else if (ent.isFile()) {
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

// Best-effort list of existing drive roots on Windows (C:\ .. Z:\) for the
// settings UI to suggest. Harmless no-op shape on other platforms.
export function listDrives() {
  const drives = [];
  for (let c = 67; c <= 90; c++) { // C..Z
    const root = String.fromCharCode(c) + ':\\';
    try {
      if (fs.existsSync(root)) drives.push(root);
    } catch { /* ignore */ }
  }
  return drives;
}
