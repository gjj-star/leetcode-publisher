#!/usr/bin/env node
// MCP server: exposes the same capability as the CLI to MCP-speaking clients.
// The token is supplied per-call (or via env), never stored.
//
//   node mcp/server.mjs
//
// Client config:
//   { "mcpServers": { "leetcode-publisher": {
//       "command": "node", "args": ["<repo>/mcp/server.mjs"],
//       "env": { "LEETCODE_SESSION": "<optional>" } } } }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from '../src/gql.mjs';
import { resolveSession } from '../src/auth.mjs';
import { markdownToSlate, computeSummary, computeThumbnail } from '../src/md2slate.mjs';
import { renderNodes } from '../src/slate2md.mjs';
import {
  whoami, listSolutions, getArticle, getQuestion, getOfficialSolution,
  createDraft, publishDraft, publishPayload,
} from '../src/leetcode.mjs';
import {
  collectSources, profileStyle, styleGuide, styleCheck,
  resolveStylePath, listStylePresets,
} from '../src/style.mjs';

const server = new McpServer({ name: 'leetcode-publisher', version: '0.1.0' });

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: s }] });
const errText = (e) => `${e.message}${e.hint ? '\n→ ' + e.hint : ''}`;

const tokenField = {
  session: z.string().optional().describe('LEETCODE_SESSION 的值。只在需要登录的操作里传；不要写进文件。'),
};

async function clientFor(session, opts = {}) {
  const resolved = await resolveSession({ inline: session });
  if (!resolved.session && opts.require) {
    throw new Error(
      '缺少 LEETCODE_SESSION。请向用户索取：浏览器登录 leetcode.cn → F12 → Application → Cookies → 复制 LEETCODE_SESSION 的值。'
    );
  }
  return createClient({ session: resolved.session, csrf: process.env.LEETCODE_CSRF, ...opts });
}

// ---------------------------------------------------------------- tools

server.tool('lc_auth_check', '检查 LEETCODE_SESSION 是否有效。', tokenField, async ({ session }) => {
  try {
    const client = await clientFor(session);
    const u = await whoami(client);
    return text(`isSignedIn=${u.isSignedIn} user=${u.userSlug ?? '(未登录)'}`);
  } catch (e) {
    return fail(errText(e));
  }
});

server.tool(
  'lc_get_question',
  '查题目信息与标签。questionSlug 取自 URL leetcode.cn/problems/<questionSlug>/。',
  { questionSlug: z.string() },
  async ({ questionSlug }) => {
    try {
      const client = await clientFor();
      const q = await getQuestion(client, questionSlug);
      if (!q) return fail(`题目不存在: ${questionSlug}`);
      return text({
        id: q.questionFrontendId,
        title: q.translatedTitle,
        difficulty: q.difficulty,
        tags: q.topicTags.map((t) => t.slug),
        hasOfficialSolution: !!q.solution?.content,
      });
    } catch (e) {
      return fail(errText(e));
    }
  }
);

server.tool('lc_style_list', '列出仓库里已有的文风预设。', {}, async () => {
  try {
    const presets = await listStylePresets();
    if (!presets.length) return text('（暂无预设）');
    return text(
      presets.map((p) => `${p.name}: ${p.samples} 篇样本 → ${p.skeleton}`).join('\n') +
        '\n\n用 lc_style_check 时把预设名传给 style 参数。'
    );
  } catch (e) {
    return fail(errText(e));
  }
});

server.tool(
  'lc_style_profile',
  '归纳题解文风，返回机械统计出来的风格档案（章节骨架、分步写法、篇幅、口吻词频）。用于「按某某的风格写一篇」。来源可混用。',
  {
    user: z.string().optional().describe('参照某用户的题解，如 yeechin'),
    official: z.string().optional().describe('参照某题的官方题解，如 two-sum'),
    paths: z.array(z.string()).optional().describe('本地 markdown 文件或目录'),
  },
  async ({ user, official, paths }) => {
    try {
      const client = await clientFor();
      const articles = await collectSources(client, { user, official, paths: paths || [] });
      if (!articles.length) return fail('没有收集到样文');
      const profile = profileStyle(articles);
      return text(
        styleGuide(profile) +
          '\n\n---\n\n## style.json（传给 lc_style_check）\n\n```json\n' +
          JSON.stringify({ ...profile, perArticle: undefined }, null, 2) +
          '\n```'
      );
    } catch (e) {
      return fail(errText(e));
    }
  }
);

server.tool(
  'lc_style_check',
  '按文风档案检查题解草稿，返回偏差列表。会捕获力扣专有的 markdown 陷阱（单行 $$ 等），' +
    '以及「不是…而是…」这类容易暴露机器写作的句式。',
  {
    markdown: z.string().describe('草稿的 markdown 全文'),
    style: z.string().describe('预设名（如 yeechin）或 style.json 的内容'),
    ignore: z
      .array(z.string())
      .optional()
      .describe('要忽略的规则 id，例如 ["not-x-but-y"]。仅在确认该句式此处非用不可时使用。'),
  },
  async ({ markdown, style, ignore }) => {
    try {
      let profile;
      if (style.trim().startsWith('{')) {
        profile = JSON.parse(style);
      } else {
        const p = await resolveStylePath(style);
        const { readFile } = await import('node:fs/promises');
        profile = JSON.parse(await readFile(p, 'utf8'));
      }
      const issues = styleCheck(markdown, profile, { ignore: ignore || [] });
      if (!issues.length) return text('未发现问题。');
      return text(issues.map((i) => `[${i.level}] ${i.msg}`).join('\n'));
    } catch (e) {
      return fail(errText(e));
    }
  }
);

server.tool(
  'lc_publish',
  '把 markdown 发布成力扣题解。默认只做干跑（不写任何东西）；确需发布时由用户确认后传 publish=true。',
  {
    markdown: z.string().describe('题解 markdown 全文'),
    questionSlug: z.string(),
    title: z.string(),
    tags: z.array(z.string()).optional().describe('不传则用题目自带标签 + 代码块语言'),
    publish: z.boolean().optional().describe('false/省略 = 只干跑校验'),
    ...tokenField,
  },
  async ({ markdown, questionSlug, title, tags, publish, session }) => {
    try {
      const client = await clientFor(session, { retry: 3, delaySec: 90 });
      const q = await getQuestion(client, questionSlug);
      if (!q) return fail(`题目不存在: ${questionSlug}`);

      const doc = markdownToSlate(markdown);
      const slateValue = JSON.stringify(doc);
      const summary = computeSummary(doc);
      const thumbnail = computeThumbnail(doc);
      const langs = [...new Set((slateValue.match(/"language":"([^"]+)"/g) || []).map((s) => s.slice(12, -1)))].filter(
        (l) => l !== 'plainText'
      );
      const useTags = tags?.length ? tags : [...q.topicTags.map((t) => t.slug), ...langs];

      const count = (t) => doc.filter((n) => n.type === t).length;
      const report = [
        `题目: ${q.questionFrontendId}. ${q.translatedTitle}`,
        `标题: ${title}`,
        `标签: ${useTags.join(', ')}`,
        `块数: ${doc.length}  H1=${count('Heading1')} H2=${count('Heading2')} 代码=${count('CodeBlock')}`,
        `公式: 行内 ${(slateValue.match(/"type":"Latex"/g) || []).length} / 块级 ${(slateValue.match(/"type":"LatexBlock"/g) || []).length}`,
        `summary: ${summary.length} 字`,
      ];

      const problems = [];
      if (!/^>\s*Problem:/.test(markdown.trim())) problems.push('正文第一行不是 `> Problem: ...`');
      if (!summary) problems.push('summary 为空');
      if (problems.length) report.push('校验问题: ' + problems.join('; '));

      if (!publish) {
        return text(report.join('\n') + '\n\n[干跑] 未发送任何写请求。确认后传 publish=true。');
      }

      const draft = await createDraft(client, { questionSlug, title, tags: useTags, slateValue });
      const art = await publishDraft(
        client,
        publishPayload({ questionSlug, title, summary, tags: useTags, thumbnail, slateValue, slug: draft.slug })
      );
      const url = `https://leetcode.cn/problems/${questionSlug}/solutions/${art.slug}/`;
      report.push('', `已发布: ${url}`, `状态: ${art.status}`);
      if (art.status === 'CHECKING') {
        report.push('审核期间力扣会隐藏正文，此时回读不到内容，属正常现象。');
      }
      return text(report.join('\n'));
    } catch (e) {
      return fail(errText(e));
    }
  }
);

server.tool(
  'lc_verify',
  '回读线上题解正文；给了 markdown 就逐块比对。注意 status=CHECKING 时读不到正文。',
  { slug: z.string(), markdown: z.string().optional() },
  async ({ slug, markdown }) => {
    try {
      const client = await clientFor();
      const a = await getArticle(client, slug);
      if (!a) return fail(`取不到文章: ${slug}`);
      const head = [`标题: ${a.title || '(审核中不可见)'}`, `状态: ${a.status}`];
      if (!a.slateValue) return text(head.concat('正文在审核期间不可见，稍后再试。').join('\n'));

      const online = JSON.parse(a.slateValue);
      head.push(`块数: ${online.length}  summary: ${(a.summary || '').length} 字`);
      if (!markdown) return text(head.join('\n'));

      const mine = markdownToSlate(markdown);
      const sig = (d) =>
        d.flatMap((n) => {
          if (n.type === 'BulletedList' || n.type === 'OrderedList') {
            return (n.children || []).map((it) => 'Item|' + (it.children || []).map((c) => c.text || '').join(''));
          }
          if (n.type === 'CodeBlock') return (n.children || []).map((t) => `Code|${t.language}`);
          const t = (n.children || [])
            .map((c) => (typeof c.text === 'string' ? c.text : c.title || c.tex || ''))
            .join('')
            .trim();
          if (n.type === 'Paragraph' && !t) return [];
          return [`${n.type}|${t.replace(/\s+/g, ' ')}`];
        });
      const A = sig(mine);
      const B = sig(online);
      const diffs = [];
      for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) diffs.push(`[${i}] 源=${A[i]} 线上=${B[i]}`);
      head.push(`比对: ${Math.max(A.length, B.length) - diffs.length}/${Math.max(A.length, B.length)} 一致`);
      if (diffs.length) head.push(...diffs.slice(0, 10));
      return text(head.join('\n'));
    } catch (e) {
      return fail(errText(e));
    }
  }
);

server.tool(
  'lc_pull_user',
  '拉取某用户全部已发布题解，返回 markdown 列表。',
  { userSlug: z.string(), limit: z.number().optional() },
  async ({ userSlug, limit }) => {
    try {
      const client = await clientFor();
      const list = await listSolutions(client, userSlug);
      const items = [];
      for (const item of list.slice(0, limit || list.length)) {
        const a = await getArticle(client, item.slug);
        items.push({
          title: a.title,
          slug: item.slug,
          question: `${item.question?.questionFrontendId}. ${item.question?.translatedTitle}`,
          markdown: a.slateValue ? renderNodes(JSON.parse(a.slateValue)) : '',
        });
        await new Promise((r) => setTimeout(r, 500));
      }
      return text({ count: items.length, items });
    } catch (e) {
      return fail(errText(e));
    }
  }
);

server.tool(
  'lc_get_official_solution',
  '取某题官方题解的 markdown，可用作文风参照。',
  { questionSlug: z.string() },
  async ({ questionSlug }) => {
    try {
      const client = await clientFor();
      const a = await getOfficialSolution(client, questionSlug);
      if (!a) return fail(`该题没有官方题解: ${questionSlug}`);
      return text(`# ${a.title}\n\n${a.markdown}`);
    } catch (e) {
      return fail(errText(e));
    }
  }
);

await server.connect(new StdioServerTransport());
