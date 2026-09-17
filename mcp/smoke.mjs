// Smoke-test the MCP server over stdio with a real JSON-RPC handshake.
//   node mcp/smoke.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [path.join(root, 'mcp', 'server.mjs')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
  });
}
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
check('initialize', init.result?.serverInfo?.name === 'leetcode-publisher', JSON.stringify(init.result?.serverInfo));
notify('notifications/initialized', {});

const tools = await rpc('tools/list', {});
const names = (tools.result?.tools || []).map((t) => t.name);
const EXPECTED = [
  'lc_auth_check', 'lc_get_question', 'lc_get_official_solution',
  'lc_style_list', 'lc_style_profile', 'lc_style_check',
  'lc_publish', 'lc_verify', 'lc_pull_user',
];
const missing = EXPECTED.filter((n) => !names.includes(n));
check('tools/list', missing.length === 0, `${names.length} 个${missing.length ? '，缺: ' + missing.join(', ') : ''}`);

const r1 = await rpc('tools/call', { name: 'lc_get_question', arguments: { questionSlug: 'two-sum' } });
check('lc_get_question', /"id":\s*"1"/.test(r1.result?.content?.[0]?.text || ''));

const r2 = await rpc('tools/call', { name: 'lc_style_list', arguments: {} });
check('lc_style_list', !r2.result?.isError);

const r3 = await rpc('tools/call', {
  name: 'lc_publish',
  arguments: {
    markdown: '> Problem: [1. 两数之和](https://leetcode.cn/problems/two-sum/description/)\n\n# 思路\n\n> 哈希表\n',
    questionSlug: 'two-sum',
    title: '测试',
  },
});
const t3 = r3.result?.content?.[0]?.text || '';
check('lc_publish 干跑不写入', /干跑/.test(t3) && /哈希表|hash-table/.test(t3));

child.kill();
console.log(`\n${failures ? failures + ' 项失败' : 'MCP smoke test 全部通过'}`);
process.exit(failures ? 1 : 0);
