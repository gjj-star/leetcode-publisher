// Credential resolution. The session token is NEVER written to the repo and NEVER logged.
//
// Resolution order (first hit wins):
//   1. --session <token>            one-shot, nothing persisted  (best for agents)
//   2. LEETCODE_SESSION env var     good for CI / shells
//   3. session file                 ~/.leetcode-session, created by `lc auth login`
//      --session-file may also point at an MCP/JSON config; the token is found by walking
//      the tree for a LEETCODE_SESSION key. That keeps the secret inside this process
//      instead of having a caller paste it through a shell or a chat log.
import { readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

export const DEFAULT_SESSION_FILE = path.join(homedir(), '.leetcode-session');

/** Keys that may hold the session token, most specific first. */
const SESSION_KEYS = [/^LEETCODE_SESSION$/i, /leetcode[_-]?session/i, /^session$/i, /^cookie$/i];

/** Depth-first search for the first value whose key looks like a session token. */
function findSessionInJson(node, trail = '$') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const hit = findSessionInJson(node[i], `${trail}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    // prefer exact matches at this level before descending
    for (const re of SESSION_KEYS) {
      for (const [k, v] of Object.entries(node)) {
        if (re.test(k) && typeof v === 'string' && v.trim()) return { token: v.trim(), where: `${trail}.${k}` };
      }
    }
    for (const [k, v] of Object.entries(node)) {
      const hit = findSessionInJson(v, `${trail}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Read a token from a file. Accepts either:
 *   - a raw token / `LEETCODE_SESSION=...` line  (what `lc auth login` writes)
 *   - a JSON config (e.g. an MCP settings file), searched for a LEETCODE_SESSION key
 */
export async function readSessionFile(file) {
  const raw = (await readFile(file, 'utf8')).trim();
  if (!raw) return null;

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const hit = findSessionInJson(JSON.parse(raw));
      if (hit) return hit;
      return null;
    } catch {
      /* fall through to the plain-text path */
    }
  }
  const token = raw.includes('=') ? raw.split('=').slice(1).join('=').trim() : raw;
  return token ? { token, where: file } : null;
}

/** Never let a token reach stdout, logs or an error message. */
export function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<LEETCODE_SESSION·redacted>')
    .replace(/LEETCODE_SESSION=[^;,\s"']+/g, 'LEETCODE_SESSION=<redacted>');
}

export async function resolveSession({ inline, sessionFile } = {}) {
  if (inline) return { session: inline.trim(), source: '--session' };

  const env = process.env.LEETCODE_SESSION?.trim();
  if (env) return { session: env, source: 'LEETCODE_SESSION env' };

  const file = sessionFile || process.env.LEETCODE_SESSION_FILE || DEFAULT_SESSION_FILE;
  try {
    const hit = await readSessionFile(file);
    // report where it came from by key path, never the value
    if (hit) return { session: hit.token, source: hit.where === file ? file : `${file} → ${hit.where}` };
  } catch {
    /* not present */
  }
  return { session: '', source: null };
}

/** Interactive login. Only ever called by `lc auth login`, never implicitly. */
export async function promptAndSave(sessionFile = DEFAULT_SESSION_FILE) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('从浏览器 DevTools → Application → Cookies → https://leetcode.cn 复制 LEETCODE_SESSION 的值。');
    console.log('（它是 httpOnly，document.cookie 读不到，要在 Application 面板里找。）\n');
    const token = (await rl.question('LEETCODE_SESSION: ')).trim();
    if (!token) throw new Error('未输入内容');
    await writeFile(sessionFile, token + '\n', { encoding: 'utf8', mode: 0o600 });
    try {
      await chmod(sessionFile, 0o600);
    } catch {
      /* Windows: ACLs instead of mode bits */
    }
    console.log(`\n已保存到 ${sessionFile}（已加入 .gitignore，请勿提交）。`);
    return sessionFile;
  } finally {
    rl.close();
  }
}

export async function logout(sessionFile = DEFAULT_SESSION_FILE) {
  await rm(sessionFile, { force: true });
  return sessionFile;
}
