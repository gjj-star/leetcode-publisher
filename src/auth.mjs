// Credential resolution. The session token is NEVER written to the repo and NEVER logged.
//
// Resolution order (first hit wins):
//   1. --session <token>            one-shot, nothing persisted  (best for agents)
//   2. LEETCODE_SESSION env var     good for CI / shells
//   3. session file                 ~/.leetcode-session, created by `lc auth login`
import { readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

export const DEFAULT_SESSION_FILE = path.join(homedir(), '.leetcode-session');

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

  const file = sessionFile || DEFAULT_SESSION_FILE;
  try {
    const raw = (await readFile(file, 'utf8')).trim();
    // tolerate "LEETCODE_SESSION=xxx" or a bare token
    const token = raw.includes('=') ? raw.split('=').slice(1).join('=').trim() : raw;
    if (token) return { session: token, source: file };
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
