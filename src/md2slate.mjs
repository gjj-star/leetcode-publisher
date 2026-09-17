// Markdown -> LeetCode Slate JSON, mirroring the site's own converter (which also uses marked).
// Verified against node shapes observed in the user's real published articles.
import { marked } from 'marked';
import { randomBytes } from 'node:crypto';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export function slateId(len = 21) {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ID_ALPHABET[b[i] % 64];
  return s;
}

// --- LeetCode's custom markdown extensions (copied semantics from their bundle) ---
const inlineLatex = {
  name: 'inline_latex',
  level: 'inline',
  start(src) {
    const m = src.match(/\${1,2}(.*?)\${1,2}/);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    const m = src.match(/^\${1,2}(.*?)\${1,2}/);
    if (m) return { type: 'inline_latex', raw: m[0], text: m[1].trim() };
  },
};

const blockLatex = {
  name: 'block_latex',
  level: 'block',
  start(src) {
    return src.indexOf('\n$');
  },
  tokenizer(src) {
    const m = src.match(/^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/);
    if (m) return { type: 'block_latex', raw: m[0], text: m[2].trim() };
  },
};

let configured = false;
function configure() {
  if (configured) return;
  marked.use({ extensions: [inlineLatex, blockLatex], gfm: true, breaks: false });
  configured = true;
}

// --- inline tokens -> Slate leaves ---
function marks(token) {
  const m = {};
  if (token.bold) m.bold = true;
  if (token.italic) m.italic = true;
  if (token.strikethrough) m.strikethrough = true;
  return m;
}

function inline(tokens, inherited = {}) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text': {
        // marked may nest inline tokens inside a text token
        if (t.tokens && t.tokens.length) {
          out.push(...inline(t.tokens, { ...inherited, ...marks(t) }));
        } else if (t.text !== '') {
          out.push({ text: t.text, ...inherited, ...marks(t) });
        }
        break;
      }
      case 'escape':
        out.push({ text: t.text, ...inherited });
        break;
      case 'strong':
      case 'em':
      case 'del': {
        const extra = t.type === 'strong' ? { bold: true } : t.type === 'em' ? { italic: true } : { strikethrough: true };
        out.push(...inline(t.tokens, { ...inherited, ...extra }));
        break;
      }
      case 'codespan':
        out.push({ text: t.text, code: true, ...inherited });
        break;
      case 'br':
        out.push({ text: '\n', ...inherited });
        break;
      case 'link': {
        out.push({ type: 'Link', href: t.href, title: t.text || t.title || '', children: [{ text: '' }], slateId: slateId() });
        break;
      }
      case 'inline_latex':
        out.push({ type: 'Latex', tex: t.text, children: [{ text: '' }], slateId: slateId() });
        break;
      case 'html':
        if (t.text) out.push({ text: t.text, ...inherited });
        break;
      default:
        if (t.tokens) out.push(...inline(t.tokens, inherited));
        else if (typeof t.text === 'string' && t.text) out.push({ text: t.text, ...inherited });
    }
  }
  return out.length ? out : [{ text: '' }];
}

// split a code fence info string: "python3 [暴力]" -> {language, name, isTab}
//
// The bracketed suffix is the opt-in marker meaning "this fence is a TAB of a multi-tab
// CodeBlock". `[]` is a tab with no label — LeetCode allows unnamed tabs (e.g. a python3
// and a typescript tab side by side), and they still need to stay one CodeBlock.
function fenceInfo(info) {
  const raw = (info || '').trim();
  const nameMatch = raw.match(/\[(.*?)\]/);
  const lang = raw.split(' ')[0].toLowerCase();
  const language = !lang || lang === 'text' || lang === 'plaintext' ? 'plainText' : lang;
  return { language, name: nameMatch ? nameMatch[1].trim() : '', isTab: !!nameMatch };
}

// Only fences explicitly marked as tabs are ever merged.
const isTabFence = (token) => fenceInfo(token.lang).isTab;

function codeBlock(token) {
  const { language, name } = fenceInfo(token.lang);
  const text = (token.text ?? '').replace(/\n+$/, '');
  return {
    type: 'CodeBlock',
    activeTabIndex: 0,
    children: [{ type: 'CodeTab', language, name, children: [{ text }], slateId: slateId() }],
    slateId: slateId(),
  };
}

/**
 * One CodeBlock holding several CodeTabs — this is what makes LeetCode render a tab bar.
 * A single-tab CodeBlock shows the language instead and the tab name is invisible, so
 * adjacent tab fences must be merged rather than emitted as separate blocks.
 */
function multiTabCodeBlock(tokens) {
  return {
    type: 'CodeBlock',
    activeTabIndex: 0,
    children: tokens.map((t) => {
      const { language, name } = fenceInfo(t.lang);
      return {
        type: 'CodeTab',
        language,
        name,
        children: [{ text: (t.text ?? '').replace(/\n+$/, '') }],
        slateId: slateId(),
      };
    }),
    slateId: slateId(),
  };
}

// --- block tokens -> Slate elements ---
function blocks(tokens, depth = 0) {
  const out = [];
  const list = tokens || [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    switch (t.type) {
      case 'space':
        break;
      case 'code': {
        // Run of adjacent tab fences -> one multi-tab CodeBlock. Unmarked fences are left
        // alone so ordinary code stays an ordinary code block.
        if (isTabFence(t)) {
          const run = [t];
          let j = i + 1;
          while (j < list.length) {
            if (list[j].type === 'space') {
              j++;
              continue;
            }
            if (list[j].type === 'code' && isTabFence(list[j])) {
              run.push(list[j]);
              j++;
              continue;
            }
            break;
          }
          if (run.length > 1) {
            out.push(multiTabCodeBlock(run));
            i = j - 1;
            break;
          }
        }
        out.push(codeBlock(t));
        break;
      }
      case 'heading': {
        const d = Math.min(Math.max(t.depth, 1), 6);
        out.push({ type: 'Heading' + d, children: inline(t.tokens), slateId: slateId() });
        break;
      }
      case 'paragraph':
        out.push({ type: 'Paragraph', children: inline(t.tokens), slateId: slateId() });
        break;
      case 'text':
        if (t.tokens) out.push({ type: 'Paragraph', children: inline(t.tokens), slateId: slateId() });
        else if (t.text) out.push({ type: 'Paragraph', children: [{ text: t.text }], slateId: slateId() });
        break;
      case 'blockquote': {
        // LeetCode flattens a quote's inline content straight into BlockQuote children
        const kids = [];
        for (const inner of t.tokens || []) {
          if (inner.type === 'paragraph') kids.push(...inline(inner.tokens));
          else if (inner.type === 'text') kids.push(...inline(inner.tokens || [{ type: 'text', text: inner.text }]));
          else {
            const nested = blocks([inner], depth + 1);
            if (nested.length) kids.push(nested[0]);
          }
        }
        out.push({ type: 'BlockQuote', children: kids.length ? kids : [{ text: '' }], slateId: slateId() });
        break;
      }
      case 'list': {
        const type = t.ordered ? 'OrderedList' : 'BulletedList';
        const items = [];
        for (const item of t.items || []) {
          const kids = [];
          for (const inner of item.tokens || []) {
            if (inner.type === 'text' && inner.tokens) kids.push(...inline(inner.tokens));
            else if (inner.type === 'paragraph') kids.push(...inline(inner.tokens));
            else if (inner.type === 'text') kids.push({ text: inner.text });
            else {
              const nested = blocks([inner], depth + 1);
              if (nested.length) kids.push(nested[0]);
            }
          }
          items.push({ type: 'ListItem', children: kids.length ? kids : [{ text: '' }], slateId: slateId() });
        }
        out.push({ type, children: items, slateId: slateId() });
        break;
      }
      case 'hr':
        out.push({ type: 'HorizontalRule', children: [{ text: '' }], slateId: slateId() });
        break;
      case 'block_latex':
        out.push({ type: 'LatexBlock', tex: t.text, children: [{ text: '' }], slateId: slateId() });
        break;
      case 'table': {
        const rows = [];
        const header = t.header || [];
        const body = t.rows || [];
        const mk = (cells, isHead) => ({
          type: 'TableRow',
          children: cells.map((c) => ({
            type: 'TableCell',
            align: 'left',
            children: [{ type: 'TableContent', children: isHead ? [{ text: c.text, bold: true }] : inline(c.tokens) }],
          })),
        });
        if (header.length) rows.push(mk(header, true));
        for (const r of body) rows.push(mk(r, false));
        out.push({ type: 'Table', children: rows, slateId: slateId() });
        break;
      }
      default:
        if (t.tokens) out.push(...blocks(t.tokens, depth));
        else if (t.text) out.push({ type: 'Paragraph', children: [{ text: t.text }], slateId: slateId() });
    }
  }
  return out;
}

export function markdownToSlate(md) {
  configure();
  let src = md.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  // LeetCode's block_latex needs the "$$" to start a line preceded by \n
  if (src.startsWith('$$')) src = '\n' + src;
  const tokens = marked.lexer(src);
  let doc = blocks(tokens);
  if (!doc.length) doc = [{ type: 'Paragraph', children: [{ text: '' }], slateId: slateId() }];
  return doc;
}

// --- summary / thumbnail, mirroring the editor's lP helper ---
export function computeSummary(doc) {
  const clean = (s) => String(s).replace(/[\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const nodeText = (n) => {
    if (typeof n.text === 'string' && !Array.isArray(n.children)) return clean(n.text);
    switch (n.type) {
      case 'Latex':
      case 'LatexBlock':
        return clean(n.tex || '');
      case 'Link':
        return clean(n.title || '');
      default:
        if ((n.children || []).every((c) => typeof c.text === 'string' && !Array.isArray(c.children))) {
          return clean((n.children || []).map((c) => c.text).join(''));
        }
        return clean((n.children || []).map(nodeText).filter(Boolean).join(' '));
    }
  };
  const flat = (doc || []).map(nodeText).filter(Boolean).join(' ');
  return clean(flat).slice(0, 250);
}

export function computeThumbnail(doc) {
  const m = JSON.stringify(doc).match(/\{"type":"Image","src":"(.*?)"/);
  return m ? m[1] : '';
}
