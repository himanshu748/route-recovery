import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';

const FORBIDDEN_NAMES = /^(?:\.env(?:\..*)?|\.git|\.git-credentials|\.ssh|\.aws|\.azure|\.kube|\.docker|\.npmrc|\.netrc|\.pypirc|gcloud|keys?|private[-_]?keys?|secrets?|credentials?|tokens?|api[-_]?keys?|id_(?:rsa|dsa|ecdsa|ed25519))(?:\..*)?$/i;
const FORBIDDEN_EXTENSIONS = /\.(?:key|pem|p12|pfx|keystore|jks)$/i;

export { readLimited, writeNew };

function fail(message) {
  throw new Error(message);
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) {
    fail('File paths must be nonempty relative paths without backslashes or control characters.');
  }
  if (path.isAbsolute(value) || /^[a-z]:/i.test(value)) fail('Absolute file paths are not allowed.');
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail('File paths must not contain empty, dot, or parent traversal segments.');
  }
  if (parts.some((part) => FORBIDDEN_NAMES.test(part) || FORBIDDEN_EXTENSIONS.test(part))) {
    fail('Credential, key, environment, and private configuration paths are excluded.');
  }
  return parts;
}

// Refuse symlinks even when they currently point inside the root. The explicit
// selection must name the actual file, and output directories must be ordinary.
async function inspectPath(root, selectedPath, { createParents = false } = {}) {
  const parts = relativePath(selectedPath);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const isParent = index < parts.length - 1;
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (isParent && createParents) {
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        }
        stat = await lstat(current);
      } else {
        return { absolutePath: path.join(root, ...parts), exists: false };
      }
    }
    if (stat.isSymbolicLink()) fail(`Symlinks are not allowed: ${selectedPath}`);
    if (isParent && !stat.isDirectory()) fail(`Path parent is not a directory: ${selectedPath}`);
    if (!isParent && !stat.isFile()) fail(`Selected path is not a regular file: ${selectedPath}`);
  }
  return { absolutePath: current, exists: true };
}

async function readLimited(root, selectedPath, limit, { allowMissing = false } = {}) {
  const checked = await inspectPath(root, selectedPath);
  if (!checked.exists) {
    if (allowMissing) return null;
    fail(`Selected file does not exist: ${selectedPath}`);
  }
  const handle = await open(checked.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail(`Selected path is not a regular file: ${selectedPath}`);
    if (stat.size > limit) fail(`File exceeds ${limit} bytes: ${selectedPath}`);
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, count);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    if (count > limit) fail(`File exceeds ${limit} bytes: ${selectedPath}`);
    return bytes.subarray(0, count);
  } finally {
    await handle.close();
  }
}

async function writeNew(root, selectedPath, content) {
  const checked = await inspectPath(root, selectedPath, { createParents: true });
  if (checked.exists) fail(`Refusing to overwrite existing file: ${selectedPath}`);
  const handle = await open(checked.absolutePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return checked.absolutePath;
}
