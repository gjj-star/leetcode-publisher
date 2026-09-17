// Style engine.
//
// Division of labour: extracting *structure* from a corpus is deterministic, so the tool
// does it. Producing prose is a language-model job, so the tool does NOT do it — it hands
// the agent a reference pack plus a machine-readable profile, and can later lint a draft
// against that profile.
//
// A "preset" is just a directory laid out like:
//   styles/<name>/STYLE.md      human/agent-readable guide
//   styles/<name>/style.json    machine-readable profile (fed to style check)
//   styles/<name>/samples/*.md  the reference corpus it was derived from
// `lc style profile --user <slug> --preset <name>` regenerates one in place.
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSolutions, getArticle, getOfficialSolution } from './leetcode.mjs';
import { renderNodes } from './slate2md.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STYLES_DIR = path.join(REPO_ROOT, 'styles');

// ---------------------------------------------------------------- presets

/**
 * Turn a style argument into a path to style.json.
 * Accepts either an explicit path, or a preset name resolvable under styles/.
 */
export async function resolveStylePath(nameOrPath) {
  if (!nameOrPath) throw new Error('缺少 --style');
  const asPath = path.resolve(nameOrPath);
  try {
    const st = await stat(asPath);
    if (st.isDirectory()) return path.join(asPath, 'style.json');
    return asPath;
  } catch {
    /* not a path — try as a preset name */
  }
  const preset = path.join(STYLES_DIR, nameOrPath, 'style.json');
  try {
    await stat(preset);
    return preset;
  } catch {
    const names = (await listStylePresets()).map((p) => p.name);
    throw new Error(
      `找不到风格 "${nameOrPath}"。既不是已存在的路径，也不是预设。` +
        (names.length ? `可用预设: ${names.join(', ')}` : '（styles/ 下暂无预设）')
    );
  }
}

export async function listStylePresets() {
  const entries = await readdir(STYLES_DIR, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(STYLES_DIR, e.name);
    const info = { name: e.name, dir, samples: 0, skeleton: '', generatedFrom: '' };
    try {
      const p = JSON.parse(await readFile(path.join(dir, 'style.json'), 'utf8'));
      info.samples = p.samples ?? 0;
      info.skeleton = (p.skeleton || []).map((s) => s.heading).join(' → ');
      info.generatedFrom = p.generatedFrom || '';
    } catch {
      continue; // not a valid preset
    }
    try {
      info.sampleFiles = (await readdir(path.join(dir, 'samples'))).filter((f) => f.endsWith('.md')).length;
    } catch {
      info.sampleFiles = 0;
    }
    out.push(info);
  }
  return out;
}

// ---------------------------------------------------------------- sources

/** Strip YAML front-matter (Obsidian notes carry it) and normalise newlines. */
export function stripFrontMatter(md) {
  const m = md.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? md.slice(m[0].length) : md).replace(/\r\n/g, '\n').trim();
}

async function* walkMarkdown(target) {
  const st = await stat(target);
  if (st.isFile()) {
    if (/\.md$/i.test(target)) yield target;
    return;
  }
  const entries = await readdir(target, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(target, e.name);
    if (e.isDirectory()) yield* walkMarkdown(p);
    else if (/\.md$/i.test(e.name)) yield p;
  }
}

/**
 * Gather style-reference articles from any mix of sources.
 *   { user: 'yeechin' } | { official: 'two-sum' } | { paths: ['D:/notes/算法'] }
 */
export async function collectSources(client, { user, official, paths = [] } = {}) {
  const out = [];

  if (user) {
    const list = await listSolutions(client, user);
    for (const item of list) {
      const a = await getArticle(client, item.slug);
      if (!a?.slateValue) continue;
      let doc;
      try {
        doc = JSON.parse(a.slateValue);
      } catch {
        continue;
      }
      out.push({
        source: `leetcode:${user}`,
        slug: a.slug,
        title: a.title,
        tags: (a.tags || []).map((t) => t.slug),
        markdown: renderNodes(doc),
      });
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (official) {
    const a = await getOfficialSolution(client, official);
    if (a?.markdown) {
      out.push({ source: `official:${official}`, slug: a.slug, title: a.title, tags: [], markdown: a.markdown });
    } else {
      console.error(`  官方题解不存在或为空: ${official}`);
    }
  }

  for (const p of paths) {
    for await (const file of walkMarkdown(p)) {
      const raw = await readFile(file, 'utf8');
      out.push({
        source: `file:${file}`,
        slug: path.basename(file, '.md'),
        title: path.basename(file, '.md'),
        tags: [],
        markdown: stripFrontMatter(raw),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------- profiling

const count = (s, re) => (s.match(re) || []).length;

export function profileStyle(articles, { generatedFrom = '' } = {}) {
  const n = articles.length;
  if (!n) throw new Error('没有可分析的样文');

  const profiles = articles.map((a) => {
    const md = a.markdown;
    const h1 = [...md.matchAll(/^#\s+(.+)$/gm)].map((m) => m[1].trim());
    const h2 = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
    const h3 = [...md.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim());
    const fences = [...md.matchAll(/^```(\S*)/gm)].map((m) => m[1].toLowerCase()).filter(Boolean);
    const steps = h2.filter((t) => /^第[一二三四五六七八九十\d]+步/.test(t));
    const pitfalls = [...h2, ...h3].filter((t) => /坑|踩/.test(t));

    // the one-line "method" quote: first blockquote inside `# 思路`, ignoring the
    // `> Problem: ...` template header. A plain negative lookahead is unsafe here —
    // `\s*` backtracks and lets `(?!Problem)` succeed on the leading space.
    const ideaSection = md.match(/^#\s*思路\s*\n([\s\S]*?)(?=\n#\s|\s*$)/m);
    const ideaQuote = ideaSection ? (ideaSection[1].match(/^>[ \t]*(.+)$/m) || [])[1] : null;
    const quote = ideaQuote ?? (md.match(/^>[ \t]*(?!Problem:)(.+)$/m) || [])[1];

    return {
      title: a.title,
      chars: md.length,
      h1,
      h2,
      h3,
      steps,
      pitfalls,
      fences,
      hasProblemQuote: /^>\s*Problem:/m.test(md),
      firstQuote: quote ? String(quote).trim() : null,
      inlineLatex: count(md, /\$[^$\n]+\$/g),
      blockLatex: count(md, /^\$\$$/gm),
      bullets: count(md, /^[-*]\s+/gm),
      codeBlocks: count(md, /^```/gm) / 2,
      boldSpans: count(md, /\*\*[^*]+\*\*/g),
      tableRows: count(md, /^\|/gm),
    };
  });

  // section skeleton: H1s that appear in most samples
  const h1Freq = new Map();
  for (const p of profiles) for (const h of p.h1) h1Freq.set(h, (h1Freq.get(h) || 0) + 1);
  const skeleton = [...h1Freq.entries()]
    .filter(([, c]) => c >= Math.ceil(n / 2))
    .sort((a, b) => b[1] - a[1] || (profiles[0]?.h1.indexOf(a[0]) ?? 0) - (profiles[0]?.h1.indexOf(b[0]) ?? 0))
    .map(([h, c]) => ({ heading: h, inSamples: c }));

  const avg = (sel) => profiles.reduce((s, p) => s + sel(p), 0) / n;
  const median = (sel) => {
    const v = profiles.map(sel).sort((a, b) => a - b);
    return v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  };

  const langFreq = new Map();
  for (const p of profiles) for (const f of p.fences) langFreq.set(f, (langFreq.get(f) || 0) + 1);

  const stepSamples = profiles.flatMap((p) => p.steps);
  const pitfallSamples = profiles.flatMap((p) => p.pitfalls);
  const quoteSamples = profiles.map((p) => p.firstQuote).filter(Boolean);

  // voice markers common in Chinese technical write-ups
  const VOICE = [
    ['第一人称「我」', /我/g],
    ['“我一开始 / 最开始”', /我(?:一开始|最开始|最初|本来|第一反应)/g],
    ['“其实 / 说白了”', /(?:其实|说白了|讲道理)/g],
    ['“才发现 / 后来发现”', /(?:才发现|才明白|才知道|后来发现|写着写着)/g],
    ['口语词', /(?:啥|呗|嘛|挺|贼|巨|就完事|不难|直接)/g],
    ['自嘲', /(?:小脑|菜|蠢|笨|翻车|走死)/g],
  ];
  const voice = VOICE.map(([label, re]) => {
    const total = articles.reduce((s, a) => s + count(a.markdown, re), 0);
    return { label, perArticle: +(total / n).toFixed(1) };
  }).filter((v) => v.perArticle > 0);

  return {
    samples: n,
    generatedFrom,
    generatedAt: new Date().toISOString(),
    titles: profiles.map((p) => p.title),
    skeleton,
    sectionOrder: profiles[0]?.h1 || [],
    stepHeading: {
      present: stepSamples.length,
      articles: profiles.filter((p) => p.steps.length).length,
      samples: [...new Set(stepSamples)].slice(0, 6),
    },
    pitfalls: { present: pitfallSamples.length, samples: [...new Set(pitfallSamples)].slice(0, 4) },
    goalQuote: { present: quoteSamples.length, samples: quoteSamples.slice(0, 4) },
    hasProblemQuote: profiles.filter((p) => p.hasProblemQuote).length,
    length: {
      medianChars: median((p) => p.chars),
      minChars: Math.min(...profiles.map((p) => p.chars)),
      maxChars: Math.max(...profiles.map((p) => p.chars)),
    },
    codeLangs: [...langFreq.entries()].sort((a, b) => b[1] - a[1]).map(([lang, c]) => ({ lang, count: c })),
    density: {
      codeBlocks: +avg((p) => p.codeBlocks).toFixed(1),
      bullets: +avg((p) => p.bullets).toFixed(1),
      inlineLatex: +avg((p) => p.inlineLatex).toFixed(1),
      blockLatex: +avg((p) => p.blockLatex).toFixed(1),
      boldSpans: +avg((p) => p.boldSpans).toFixed(1),
      tables: +avg((p) => p.tables ?? p.tableRows).toFixed(1),
    },
    voice,
    perArticle: profiles,
  };
}

/** Human/agent-readable style guide derived from the profile. */
export function styleGuide(p, { sourceLabel = '样例' } = {}) {
  const L = [];
  L.push('# 题解文风档案', '');
  L.push(`基于 ${p.samples} 篇${sourceLabel}自动归纳。生成新题解时请严格对齐下面的骨架、节奏和口吻。`, '');
  if (p.generatedFrom) L.push(`来源：${p.generatedFrom}`, '');

  L.push('## 一、章节骨架', '');
  L.push('按此顺序，用一级标题：', '');
  for (const s of p.skeleton) L.push(`- \`# ${s.heading}\`　（${s.inSamples}/${p.samples} 篇都有）`);
  L.push('');
  if (p.hasProblemQuote) {
    L.push(`正文第一行固定是 \`> Problem: [题号. 题名](题目链接)\`（${p.hasProblemQuote}/${p.samples} 篇）。`, '');
  }

  L.push('## 二、开头怎么写', '');
  if (p.goalQuote.present) {
    L.push('`# 思路` 下面紧跟一句引用块，一句话点明方法，例如：', '');
    for (const q of p.goalQuote.samples) L.push(`> ${q}`);
    L.push('');
  }

  L.push('## 三、解题过程', '');
  if (p.stepHeading.articles) {
    L.push(`用 \`## 第N步：<小标题>\` 分步（${p.stepHeading.articles}/${p.samples} 篇采用）。实际标题样例：`, '');
    for (const s of p.stepHeading.samples) L.push(`- \`## ${s}\``);
    L.push('');
  }
  if (p.pitfalls.present) {
    L.push('踩过的坑单独成节，标题里带「坑」字，样例：', '');
    for (const s of p.pitfalls.samples) L.push(`- \`### ${s}\``);
    L.push('');
  }

  L.push('## 四、篇幅与密度', '');
  L.push(`- 正文字数：中位数 **${p.length.medianChars}**（区间 ${p.length.minChars}–${p.length.maxChars}）`);
  L.push(`- 代码块：平均 ${p.density.codeBlocks} 个/篇，语言以 ${p.codeLangs.map((c) => '`' + c.lang + '`').join('、') || '未标注'} 为主`);
  L.push(`- 行内公式 \`$...$\`：平均 ${p.density.inlineLatex} 处/篇`);
  L.push(`- 块级公式：平均 ${p.density.blockLatex} 处/篇${p.density.blockLatex === 0 ? '（该风格几乎不用块级公式，优先写成行内）' : ''}`);
  L.push(`- 无序列表：平均 ${p.density.bullets} 条/篇`);
  L.push(`- 加粗强调：平均 ${p.density.boldSpans} 处/篇`);
  L.push(`- 表格：平均 ${p.density.tables} 行/篇${p.density.tables === 0 ? '（该风格不用表格）' : ''}`);
  L.push('');

  L.push('## 五、口吻', '');
  L.push('以第一人称叙述推导过程，允许暴露自己走过的弯路。实测特征词频（每篇）：', '');
  for (const v of p.voice) L.push(`- ${v.label}：${v.perArticle} 次`);
  L.push('');
  L.push('要的是「一个人在自己讲怎么想通的」，不是「教科书在陈述定理」。', '');

  L.push('## 六、反面清单', '');
  L.push('- 不要把思路写成流水账，`# 思路` 只留一句话结论。');
  L.push('- 不要堆砌没有推导过程的代码。');
  L.push('- 不要用「我们」「读者」这类教科书人称。');
  L.push('- 不要用表格罗列复杂度，这个风格用无序列表。');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- lint

/** Compare a draft against a profile; returns a list of human/agent-readable findings. */
export function styleCheck(draft, p) {
  const md = stripFrontMatter(draft);
  const issues = [];
  const h1 = [...md.matchAll(/^#\s+(.+)$/gm)].map((m) => m[1].trim());
  const h2 = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());

  if (p.hasProblemQuote >= p.samples / 2 && !/^>\s*Problem:/m.test(md)) {
    issues.push({ level: 'warn', msg: '缺少开头的 `> Problem: [题号. 题名](链接)` 引用块' });
  }

  for (const s of p.skeleton) {
    if (!h1.includes(s.heading)) issues.push({ level: 'warn', msg: `缺少章节 \`# ${s.heading}\`` });
  }

  const steps = h2.filter((t) => /^第[一二三四五六七八九十\d]+步/.test(t)).length;
  if (p.stepHeading.articles >= p.samples / 2 && steps === 0) {
    issues.push({ level: 'warn', msg: '`# 解题过程` 未使用 `## 第N步：...` 分步标题' });
  }

  if (!/^#\s*复杂度/m.test(md)) {
    issues.push({ level: 'warn', msg: '缺少 `# 复杂度` 章节' });
  } else {
    if (!/时间复杂度/.test(md)) issues.push({ level: 'warn', msg: '`# 复杂度` 里没写时间复杂度' });
    if (!/空间复杂度/.test(md)) issues.push({ level: 'warn', msg: '`# 复杂度` 里没写空间复杂度' });
  }

  if (!/^```/m.test(md)) issues.push({ level: 'warn', msg: '没有任何代码块' });

  const langs = [...md.matchAll(/^```(\S+)/gm)].map((m) => m[1].toLowerCase());
  const allowed = new Set(p.codeLangs.map((c) => c.lang));
  for (const l of new Set(langs)) {
    if (allowed.size && !allowed.has(l)) {
      issues.push({ level: 'info', msg: `代码块语言 \`${l}\` 不在样例常用集合内（${[...allowed].join(', ')}）` });
    }
  }

  // LeetCode-specific markdown trap: silently renders as inline instead of display math
  const singleLineBlockLatex = [...md.matchAll(/^\$\$.+\$\$$/gm)];
  if (singleLineBlockLatex.length) {
    issues.push({
      level: 'error',
      msg:
        `发现 ${singleLineBlockLatex.length} 处单行 \`$$...$$\`。力扣转换器要求块级公式的 \`$$\` 独占一行，` +
        '否则会被当成行内公式：\n      $$\n      公式\n      $$',
    });
  }

  const chars = md.length;
  if (chars < p.length.minChars * 0.6) {
    issues.push({ level: 'info', msg: `篇幅 ${chars} 字，明显短于样例区间（${p.length.minChars}–${p.length.maxChars}）` });
  }
  if (chars > p.length.maxChars * 1.5) {
    issues.push({ level: 'info', msg: `篇幅 ${chars} 字，明显长于样例区间（${p.length.minChars}–${p.length.maxChars}），注意别写成笔记` });
  }

  return issues;
}

// ---------------------------------------------------------------- pack

/**
 * Write STYLE.md + style.json + samples/ into `dir`.
 * The layout doubles as a preset, so `--preset <name>` targets styles/<name>.
 */
export async function writeStylePack(dir, articles, profile) {
  await mkdir(path.join(dir, 'samples'), { recursive: true });
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const safe = `${String(i + 1).padStart(2, '0')}-${(a.slug || a.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`;
    await writeFile(path.join(dir, 'samples', safe), `# ${a.title}\n\n${a.markdown}\n`, 'utf8');
  }
  await writeFile(path.join(dir, 'STYLE.md'), styleGuide(profile), 'utf8');
  await writeFile(path.join(dir, 'style.json'), JSON.stringify(profile, null, 2), 'utf8');
  return dir;
}
