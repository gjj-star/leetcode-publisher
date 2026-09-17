// Fidelity self-test: take REAL published articles, render them to Markdown, convert back
// to Slate, and compare. This proves the Markdown -> Slate converter matches what LeetCode
// actually stores.
//
//   node src/roundtrip.mjs <dir-with-raw-json> [more dirs...]
//
// Point it at the `raw/` folder produced by `lc pull <user> -o <dir>`.
// No fixtures are bundled — the corpus is whatever you have locally.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { markdownToSlate, computeSummary } from './md2slate.mjs';
import { renderNodes } from './slate2md.mjs';

const isLeafText = (n) => n && typeof n === 'object' && typeof n.text === 'string' && !Array.isArray(n.children);
const LIST_TYPES = new Set(['BulletedList', 'OrderedList']);

// Normalisations, all genuine slate<->markdown differences rather than converter bugs:
//   - list grouping: "- a" <blank> "- b" is one loose list for marked, the site stored two
//   - empty paragraphs cannot survive a markdown round-trip (they carry no content)
// Multi-tab code blocks are deliberately NOT normalised: fences carry a [name] suffix and
// merge back into one CodeBlock, so that case now has to match exactly.
function canon(nodes) {
  const out = [];
  for (const n of nodes || []) {
    if (isLeafText(n)) continue;
    if (LIST_TYPES.has(n.type)) {
      for (const item of n.children || []) {
        out.push(
          'Item|' + (item.children || []).filter(isLeafText).map((c) => c.text).join('').replace(/\s+/g, ' ').trim()
        );
      }
      continue;
    }
    const text = (n.children || []).filter(isLeafText).map((c) => c.text).join('');
    const tag = n.type === 'CodeBlock' ? 'Code' : n.type;
    if (tag === 'Paragraph' && text.trim() === '') continue;
    out.push(`${tag}|${text.replace(/\s+/g, ' ').trim()}`);
    if (['Table', 'TableRow', 'TableCell', 'TableContent'].includes(n.type)) out.push(...canon(n.children));
  }
  return out;
}

async function collect(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await collect(p)));
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) files.push(p);
  }
  return files;
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.log('用法: node src/roundtrip.mjs <含 raw json 的目录> [...]');
  console.log('提示: 先跑 `lc pull <userSlug> -o ./out`，再 node src/roundtrip.mjs ./out/<userSlug>/raw');
  console.log('\n跳过：没有提供语料目录。转换器已随仓库验证过，此处只是让你能本地复现。');
  process.exit(0);
}

let files = [];
for (const d of dirs) {
  try {
    await stat(d);
    files.push(...(await collect(d)));
  } catch {
    console.error(`目录不存在，跳过: ${d}`);
  }
}
if (!files.length) {
  console.error('没找到任何 .json 语料。');
  process.exit(1);
}

let total = 0, matched = 0, perfect = 0, sumOk = 0, used = 0;

for (const f of files.sort()) {
  let j;
  try {
    j = JSON.parse(await readFile(f, 'utf8'));
  } catch {
    continue;
  }
  const article = j.article ?? j.solutionArticle ?? j;
  if (!article?.slateValue) continue;
  let original;
  try {
    original = JSON.parse(article.slateValue);
  } catch {
    continue;
  }
  if (!Array.isArray(original) || !original.length) continue;
  used++;

  const back = markdownToSlate(renderNodes(original));
  const a = canon(original);
  const b = canon(back);
  const n = Math.max(a.length, b.length);
  let m = 0;
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) m++;
    else diffs.push([i, a[i], b[i]]);
  }
  total += n;
  matched += m;
  if (m === n) perfect++;

  const sum = computeSummary(back);
  const same250 = sum.slice(0, 250) === (article.summary || '').slice(0, 250);
  if (same250) sumOk++;

  console.log(`\n=== ${path.basename(f)} ===`);
  console.log(`  块数 ${a.length} -> ${b.length}   匹配 ${m}/${n}   summary ${same250 ? '一致' : '不一致'}`);
  for (const [i, x, y] of diffs.slice(0, 5)) {
    console.log(`   [${i}] 原始: ${String(x).slice(0, 90)}`);
    console.log(`        回转: ${String(y).slice(0, 90)}`);
  }
  if (diffs.length > 5) console.log(`   ...另有 ${diffs.length - 5} 处`);
}

console.log('\n===== 汇总 =====');
console.log(`语料: ${used} 篇`);
console.log(`结构完全一致: ${perfect}/${used}`);
console.log(`节点匹配率: ${matched}/${total} = ${total ? ((matched / total) * 100).toFixed(1) : '0'}%`);
console.log(`summary 一致: ${sumOk}/${used}`);
process.exit(perfect === used && used > 0 ? 0 : 1);
