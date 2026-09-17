// Command line interface. Every command prints a machine-readable summary line at the end
// (prefixed with `RESULT:`) so an agent can parse the outcome without scraping prose.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createClient, LeetCodeError } from './gql.mjs';
import { resolveSession, promptAndSave, logout, redact, DEFAULT_SESSION_FILE } from './auth.mjs';
import { markdownToSlate, computeSummary, computeThumbnail } from './md2slate.mjs';
import { renderNodes } from './slate2md.mjs';
import {
  whoami, listSolutions, getArticle, getQuestion,
  createDraft, publishDraft, publishPayload,
} from './leetcode.mjs';
import {
  collectSources, profileStyle, styleGuide, styleCheck, writeStylePack,
  resolveStylePath, listStylePresets, STYLES_DIR,
} from './style.mjs';

// ---------------------------------------------------------------- arg parsing

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const multi = {};
  const takesValue = new Set([
    'session', 'session-file', 'out', 'o', 'question', 'title', 'tags', 'retry', 'delay',
    'draft', 'user', 'official', 'path', 'style', 'pack', 'max', 'meta', 'against', 'preset',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (takesValue.has(key)) {
        const val = argv[++i];
        if (key === 'path' || key === 'official' || key === 'user') (multi[key] ||= []).push(val);
        else flags[key] = val;
      } else {
        flags[key] = true;
      }
    } else positional.push(a);
  }
  flags._ = positional;
  flags._multi = multi;
  return flags;
}

const say = (...a) => console.log(...a);
const rule = (t) => say(`\n===== ${t} =====`);

function makeClient(flags) {
  return createClient({
    session: flags._resolved.session,
    csrf: process.env.LEETCODE_CSRF,
    retry: Number(flags.retry || 1),
    delaySec: Number(flags.delay || 60),
    onRetry: (attempt, sec) => say(`  触发限流，${sec}s 后重试（第 ${attempt} 次）...`),
  });
}

/**
 * Most commands only read public data and must work without a token.
 * Only writing to LeetCode requires one.
 */
async function withClient(flags, fn, { requireSession = true } = {}) {
  flags._resolved = await resolveSession({ inline: flags.session, sessionFile: flags['session-file'] });
  if (requireSession && !flags._resolved.session) {
    const e = new Error('没有可用的 LEETCODE_SESSION。');
    e.hint =
      '按优先级提供其一：--session <token>（一次性，推荐 agent 用）/ 环境变量 LEETCODE_SESSION / ' +
      `运行 \`lc auth login\` 存到 ${DEFAULT_SESSION_FILE}。` +
      'token 在浏览器 DevTools → Application → Cookies → https://leetcode.cn 里找 LEETCODE_SESSION。';
    throw e;
  }
  return fn(makeClient(flags));
}

// ---------------------------------------------------------------- commands

async function cmdAuth(flags) {
  const sub = flags._[1] || 'check';
  if (sub === 'login') {
    await promptAndSave(flags['session-file'] || DEFAULT_SESSION_FILE);
    say('RESULT: auth.login ok');
    return 0;
  }
  if (sub === 'logout') {
    const f = await logout(flags['session-file'] || DEFAULT_SESSION_FILE);
    say(`已删除 ${f}`);
    say('RESULT: auth.logout ok');
    return 0;
  }
  const flags2 = { ...flags };
  flags2._resolved = await resolveSession({ inline: flags.session, sessionFile: flags['session-file'] });
  if (!flags2._resolved.session) {
    say('未找到 LEETCODE_SESSION。');
    say('  → 浏览器登录 leetcode.cn → F12 → Application → Cookies → 复制 LEETCODE_SESSION 的值，');
    say('    然后用 --session "<TOKEN>" 传入，或运行 `lc auth login` 保存。');
    say('  注意：读操作（pull / style / 干跑 / verify）都不需要 token。');
    say('RESULT: auth.check missing');
    return 1;
  }
  return withClient(flags2, async (client) => {
    const u = await whoami(client);
    say(`token 来源: ${flags2._resolved.source}`);
    say(`登录状态: ${u.isSignedIn ? '有效' : '无效'}`);
    say(`用户    : ${u.realName} (${u.userSlug})${u.isPremium ? ' [Plus]' : ''}`);
    say(`RESULT: auth.check ${u.isSignedIn ? 'ok' : 'invalid'} user=${u.userSlug ?? ''}`);
    return u.isSignedIn ? 0 : 1;
  });
}

async function cmdPull(flags) {
  const user = flags._[1];
  if (!user) throw new Error('用法: lc pull <userSlug> [-o 输出目录]');
  return withClient(flags, async (client) => {
    // default under ./out/ so pulled content never lands in the repo root by accident
    const outDir = path.resolve(flags.out || flags.o || path.join('out', user));
    await mkdir(path.join(outDir, 'raw'), { recursive: true });
    const list = await listSolutions(client, user);
    rule(`拉取 ${user} 的题解：共 ${list.length} 篇`);
    const index = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const a = await getArticle(client, item.slug);
      const no = String(i + 1).padStart(2, '0');
      const safe = `${no}-${(item.question?.questionFrontendId || '')}. ${(item.question?.translatedTitle || item.title).replace(/[\\/:*?"<>|]/g, '_')}`.slice(0, 80);
      const md = a.slateValue ? renderNodes(JSON.parse(a.slateValue)) : a.content || '';
      await writeFile(path.join(outDir, `${safe}.md`), `# ${a.title}\n\n${md}\n`, 'utf8');
      await writeFile(
        path.join(outDir, 'raw', `${no}-${item.slug}.json`),
        JSON.stringify({ listItem: item, article: a }, null, 2),
        'utf8'
      );
      index.push({ no: i + 1, title: a.title, slug: item.slug, question: item.question });
      say(`  [${i + 1}/${list.length}] ${a.title}`);
      await new Promise((r) => setTimeout(r, 600));
    }
    await writeFile(
      path.join(outDir, '_index.json'),
      JSON.stringify({ userSlug: user, count: index.length, items: index }, null, 2),
      'utf8'
    );
    say(`\n输出目录: ${outDir}`);
    say(`RESULT: pull ok user=${user} count=${index.length} dir=${outDir}`);
    return 0;
  }, { requireSession: false });
}

async function cmdStyle(flags) {
  const sub = flags._[1];

  if (sub === 'list') {
    const presets = await listStylePresets();
    rule(`可用文风预设（${STYLES_DIR}）`);
    if (!presets.length) {
      say('  （暂无。用 `lc style profile --user <slug> --preset <名字>` 生成一个。）');
    }
    for (const p of presets) {
      say(`  ${p.name}`);
      say(`     ${p.samples} 篇样本，${p.sampleFiles} 个范文文件`);
      if (p.skeleton) say(`     骨架: ${p.skeleton}`);
      if (p.generatedFrom) say(`     来源: ${p.generatedFrom}`);
    }
    say(`\n用法: lc style check <draft.md> --style <预设名>`);
    say(`RESULT: style.list count=${presets.length}`);
    return 0;
  }

  if (sub === 'check') {
    const draftPath = flags._[2];
    if (!draftPath || !flags.style) {
      throw new Error('用法: lc style check <draft.md> --style <预设名 或 style.json 路径>');
    }
    const stylePath = await resolveStylePath(flags.style);
    const draft = await readFile(draftPath, 'utf8');
    const profile = JSON.parse(await readFile(stylePath, 'utf8'));
    const issues = styleCheck(draft, profile);
    rule(`文风检查（风格: ${flags.style}）`);
    if (!issues.length) say('  未发现问题。');
    const order = { error: 0, warn: 1, info: 2 };
    for (const i of [...issues].sort((a, b) => order[a.level] - order[b.level])) say(`  [${i.level}] ${i.msg}`);
    const bad = issues.filter((i) => i.level === 'error').length;
    say(`RESULT: style.check ${bad ? 'error' : issues.length ? 'warn' : 'ok'} issues=${issues.length} errors=${bad}`);
    return bad ? 2 : 0;
  }

  const sources = {
    user: flags._multi.user?.[0],
    official: flags._multi.official?.[0],
    paths: flags._multi.path || [],
  };
  if (!sources.user && !sources.official && !sources.paths.length) {
    throw new Error(
      '用法: lc style profile [--user <slug>] [--official <questionSlug>] [--path <文件或目录>]...\n' +
        '       [-o STYLE.md] [--pack <目录> | --preset <预设名>]\n' +
        '     lc style list            列出已有预设\n' +
        '     lc style check <draft.md> --style <预设名>'
    );
  }

  return withClient(flags, async (client) => {
    rule('收集样文');
    const articles = await collectSources(client, sources);
    if (!articles.length) throw new Error('没有收集到任何样文，检查 --user / --official / --path');
    for (const a of articles) say(`  [${a.source}] ${a.title} (${a.markdown.length} 字)`);

    const from = [
      sources.user && `leetcode 用户 ${sources.user}`,
      sources.official && `官方题解 ${sources.official}`,
      sources.paths.length && `本地 ${sources.paths.join(', ')}`,
    ].filter(Boolean).join(' + ');
    const profile = profileStyle(articles, { generatedFrom: from });

    rule(`文风归纳（${profile.samples} 篇）`);
    say(`  章节骨架 : ${profile.skeleton.map((s) => s.heading).join(' → ')}`);
    say(`  分步写法 : ${profile.stepHeading.articles}/${profile.samples} 篇用「第N步」`);
    say(`  篇幅     : 中位数 ${profile.length.medianChars} 字`);
    say(`  代码语言 : ${profile.codeLangs.map((c) => c.lang).join(', ') || '—'}`);

    // --preset is sugar for --pack styles/<name>
    const packDir = flags.preset ? path.join(STYLES_DIR, flags.preset) : flags.pack ? path.resolve(flags.pack) : null;
    const outPath = flags.out || flags.o;

    if (packDir) {
      await writeStylePack(packDir, articles, profile);
      say(`\n文风预设: ${packDir}`);
      say(`  含 STYLE.md / style.json / samples（${articles.length} 篇）`);
      say(`  用法: lc style check <draft.md> --style ${flags.preset || path.basename(packDir)}`);
    }
    if (outPath) {
      await writeFile(outPath, styleGuide(profile), 'utf8');
      say(`\n文风档案: ${outPath}`);
    }
    if (!packDir && !outPath) say('\n' + styleGuide(profile));

    say(`RESULT: style.profile ok samples=${profile.samples} outlines=${profile.skeleton.length}${flags.preset ? ` preset=${flags.preset}` : ''}`);
    return 0;
  }, { requireSession: false });
}

async function cmdPublish(flags) {
  // --meta avoids shell quoting hell for titles containing quotes/brackets.
  let meta = {};
  if (flags.meta) {
    try {
      meta = JSON.parse(await readFile(flags.meta, 'utf8'));
    } catch (e) {
      throw new Error(`读取 --meta 失败: ${e.message}`);
    }
  }
  const mdPath = flags._[1] || meta.markdown;
  const questionSlug = flags.question || meta.questionSlug;
  const title = flags.title || meta.title;
  if (!mdPath || !questionSlug || !title) {
    throw new Error(
      '用法: lc publish <article.md> --question <questionSlug> --title "标题" [--tags a,b] [--publish]\n' +
        '   或: lc publish --meta meta.json [--publish]   （meta 含 markdown/questionSlug/title/tags）'
    );
  }
  const explicitTags = flags.tags
    ? flags.tags.split(',').map((s) => s.trim()).filter(Boolean)
    : meta.tags?.length
      ? meta.tags
      : null;
  const doPublish = !!flags.publish;

  return withClient(flags, async (client) => {
    const q = await getQuestion(client, questionSlug);
    const md = await readFile(mdPath, 'utf8');
    const doc = markdownToSlate(md);
    const slateValue = JSON.stringify(doc);
    const summary = computeSummary(doc);
    const thumbnail = computeThumbnail(doc);

    // default tags: the problem's own topic tags + the language used in the code fences
    const langs = [...new Set((slateValue.match(/"language":"([^"]+)"/g) || []).map((s) => s.slice(12, -1)))].filter(
      (l) => l !== 'plainText'
    );
    const tags = explicitTags || [...(q.topicTags || []).map((t) => t.slug), ...langs];

    const count = (t) => doc.filter((n) => n.type === t).length;
    rule('载荷');
    say(`  题目   : ${q.questionFrontendId}. ${q.translatedTitle} [${q.difficulty}]`);
    say(`  标题   : ${title}`);
    say(`  标签   : ${tags.join(', ')}`);
    say(`  块数   : ${doc.length}  (H1=${count('Heading1')} H2=${count('Heading2')} 段落=${count('Paragraph')} 引用=${count('BlockQuote')} 代码=${count('CodeBlock')})`);
    say(`  公式   : 行内 ${(slateValue.match(/"type":"Latex"/g) || []).length} / 块级 ${(slateValue.match(/"type":"LatexBlock"/g) || []).length}`);
    say(`  summary: ${summary.length} 字`);

    const problems = [];
    if (!/^>\s*Problem:/.test(md.trim())) problems.push('正文第一行不是 `> Problem: ...`（力扣题解模板的开头）');
    if (!summary) problems.push('summary 为空');
    if (slateValue.includes('"children":[]')) problems.push('存在 children 为空的节点');
    if (problems.length) {
      say('\n  !! 校验问题:');
      for (const p of problems) say('     - ' + p);
    } else say('  校验: 通过');

    const sidecar = path.join(path.dirname(mdPath), path.basename(mdPath, '.md') + '.slate.json');
    await writeFile(sidecar, JSON.stringify(doc, null, 2), 'utf8');
    say(`  Slate JSON: ${sidecar}`);

    if (!doPublish) {
      say('\n[干跑] 未发送任何请求。加 --publish 正式发布。');
      say(`RESULT: publish dryrun ok blocks=${doc.length} chars=${md.length}`);
      return problems.length ? 2 : 0;
    }

    rule('第 1 步：建草稿');
    let slug = flags.draft;
    if (slug) {
      say(`  复用草稿 ${slug}`);
    } else {
      const draft = await createDraft(client, { questionSlug, title, tags, slateValue });
      slug = draft.slug;
      say(`  草稿 slug = ${slug}  status=${draft.status}`);
    }

    rule('第 2 步：发布');
    const art = await publishDraft(
      client,
      publishPayload({ questionSlug, title, summary, tags, thumbnail, slateValue, slug })
    );
    const url = `https://leetcode.cn/problems/${questionSlug}/solutions/${art.slug}/`;
    say(`  状态: ${art.status}`);
    say(`  链接: ${url}`);
    if (art.status === 'CHECKING') {
      say('  注意: 审核期间力扣会隐藏 title/slateValue，此时回读不到正文，属正常现象。');
    }
    say(`RESULT: publish ok slug=${art.slug} status=${art.status} url=${url}`);
    return 0;
  }, { requireSession: doPublish });
}

async function cmdVerify(flags) {
  const slug = flags._[1];
  const questionSlug = flags.question;
  if (!slug) throw new Error('用法: lc verify <articleSlug> [--question <questionSlug>] [--against <draft.md>]');
  return withClient(flags, async (client) => {
    const a = await getArticle(client, slug);
    if (!a) throw new Error(`取不到文章: ${slug}`);
    rule('线上文章');
    say(`  标题: ${a.title || '(审核中不可见)'}`);
    say(`  状态: ${a.status}`);
    say(`  作者: ${a.author?.profile?.realName} (${a.author?.profile?.userSlug})`);
    if (questionSlug) say(`  链接: https://leetcode.cn/problems/${questionSlug}/solutions/${a.slug}/`);
    if (!a.slateValue) {
      say('\n  该文章尚未通过审核（或不是 slateValue 正文），无法回读内容。');
      say(`RESULT: verify pending status=${a.status}`);
      return 0;
    }
    const online = JSON.parse(a.slateValue);
    const count = (t) => online.filter((n) => n.type === t).length;
    say(`  块数: ${online.length}  H1=${count('Heading1')} H2=${count('Heading2')} 代码=${count('CodeBlock')}`);
    say(`  公式: 行内 ${(a.slateValue.match(/"type":"Latex"/g) || []).length} / 块级 ${(a.slateValue.match(/"type":"LatexBlock"/g) || []).length}`);
    say(`  summary: ${(a.summary || '').length} 字`);

    if (flags.against) {
      const mine = markdownToSlate(await readFile(flags.against, 'utf8'));
      const sig = (doc) =>
        doc.flatMap((n) => {
          if (n.type === 'BulletedList' || n.type === 'OrderedList') {
            return [
              n.type + '|',
              ...(n.children || []).map((it) => 'Item|' + (it.children || []).map((c) => c.text || '').join('')),
            ];
          }
          if (n.type === 'CodeBlock') {
            return (n.children || []).map((t) => `Code|${t.language}|${(t.children || []).map((c) => c.text).join('').length}`);
          }
          const t = (n.children || [])
            .map((c) => (typeof c.text === 'string' ? c.text : c.title || c.tex || ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (n.type === 'Paragraph' && !t) return [];
          return [`${n.type}|${t}`];
        });
      const A = sig(mine);
      const B = sig(online);
      const diffs = [];
      let same = 0;
      for (let i = 0; i < Math.max(A.length, B.length); i++) {
        if (A[i] === B[i]) same++;
        else diffs.push([i, A[i], B[i]]);
      }
      say(`\n  与 ${flags.against} 比对: ${same}/${Math.max(A.length, B.length)} 一致`);
      for (const [i, x, y] of diffs.slice(0, 10)) say(`   [${i}]\n     源  : ${x}\n     线上: ${y}`);
      if (!diffs.length) say('  完全一致 ✓');
      say(`RESULT: verify ${diffs.length ? 'diff' : 'ok'} matched=${same} total=${Math.max(A.length, B.length)}`);
      return diffs.length ? 2 : 0;
    }
    say(`RESULT: verify ok blocks=${online.length}`);
    return 0;
  }, { requireSession: false });
}

const HELP = `lc — 把 Markdown 发成力扣题解（仅支持 leetcode.cn）

  lc auth check                     检查 token 是否有效
  lc auth login                     交互式保存 token 到 ~/.leetcode-session
  lc auth logout                    删除本地 token

  lc pull <userSlug> [-o 目录]       拉取某用户全部题解为 markdown

  lc style list                     列出已有文风预设
  lc style profile [来源...] [--preset 名字 | --pack 目录 | --out STYLE.md]
                                     归纳文风。来源可混用：
                                       --user <slug>          参照某用户的题解
                                       --official <题slug>    参照官方题解
                                       --path <文件或目录>     参照本地 markdown
  lc style check <draft.md> --style <预设名 或 style.json 路径>
                                     检查草稿是否符合文风档案

  lc publish <article.md> --question <questionSlug> --title "标题"
             [--tags a,b] [--publish] [--retry N] [--delay 秒] [--draft <草稿slug>]
    lc publish --meta meta.json [--publish]
                                     默认干跑，加 --publish 才真正发布

  lc verify <articleSlug> [--question <questionSlug>] [--against <draft.md>]
                                     回读线上正文，可逐块比对

全局：--session <token>  --session-file <路径>

token 不会被写入仓库、不会被打印。建议用 --session 一次性传入。
读操作（pull / style / 干跑 / verify）不需要 token。

退出码: 0 成功 / 1 出错 / 2 校验未通过
`;

export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const cmd = flags._[0];
  if (!cmd || flags.help || cmd === 'help') {
    say(HELP);
    return 0;
  }
  try {
    switch (cmd) {
      case 'auth': return await cmdAuth(flags);
      case 'pull': return await cmdPull(flags);
      case 'style': return await cmdStyle(flags);
      case 'publish': return await cmdPublish(flags);
      case 'verify': return await cmdVerify(flags);
      default:
        say(`未知命令 "${cmd}"\n`);
        say(HELP);
        return 1;
    }
  } catch (e) {
    const msg = redact(e.message);
    say(`\n错误: ${msg}`);
    if (e.hint) say(`  → ${e.hint}`);
    else if (e instanceof LeetCodeError && e.hint) say(`  → ${e.hint}`);
    say(`RESULT: error ${msg.split('\n')[0]}`);
    return 1;
  }
}
