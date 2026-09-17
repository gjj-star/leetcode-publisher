// Slate JSON -> Markdown (same rules the scraper used to author the .md files).
const isLeafText = (n) => n && typeof n === 'object' && typeof n.text === 'string' && !Array.isArray(n.children);
const INLINE_TYPES = new Set(['Link', 'Latex', 'Code', 'Mention', 'InlineCode']);
const isInline = (n) => isLeafText(n) || INLINE_TYPES.has(n?.type);

function leaf(n) {
  let s = n.text ?? '';
  if (!s) return '';
  if (n.code) s = '`' + s + '`';
  else s = s.replace(/([*_`])/g, '\\$1');
  if (n.bold) s = '**' + s + '**';
  if (n.italic) s = '*' + s + '*';
  if (n.strikethrough) s = '~~' + s + '~~';
  return s;
}

export function inline(nodes = []) {
  let out = '';
  for (const n of nodes || []) {
    if (isLeafText(n)) { out += leaf(n); continue; }
    if (!n || typeof n !== 'object') continue;
    switch (n.type) {
      case 'Link': {
        const label = inline(n.children) || n.title || n.href || '';
        out += n.href ? `[${label}](${n.href})` : label;
        break;
      }
      case 'Latex': out += '$' + String(n.tex ?? '').trim() + '$'; break;
      case 'Code':
      case 'InlineCode': out += '`' + inline(n.children) + '`'; break;
      default: out += inline(n.children);
    }
  }
  return out;
}

function codeBlock(node) {
  const tabs = (node.children || []).filter((c) => Array.isArray(c.children));
  const multi = tabs.length > 1;
  return tabs
    .map((tab) => {
      const code = (tab.children || []).map((c) => c.text ?? '').join('').replace(/\n+$/, '');
      const lang = tab.language && tab.language !== 'plainText' ? tab.language : '';
      // The bracketed suffix marks a fence as a TAB of a multi-tab CodeBlock; `[]` keeps an
      // unnamed tab (python3 + typescript side by side) inside the same block on re-parse.
      return '```' + lang + (multi ? ` [${tab.name || ''}]` : '') + '\n' + code + '\n```';
    })
    .join('\n\n');
}

function renderBlock(n, depth) {
  switch (n.type) {
    case 'Heading1': return '# ' + inline(n.children);
    case 'Heading2': return '## ' + inline(n.children);
    case 'Heading3': return '### ' + inline(n.children);
    case 'Heading4': return '#### ' + inline(n.children);
    case 'Paragraph': return inline(n.children);
    case 'BlockQuote':
      return renderNodes(n.children, depth).split('\n').map((l) => ('> ' + l).trimEnd()).join('\n');
    case 'BulletedList':
    case 'OrderedList': {
      const ordered = n.type === 'OrderedList';
      let i = 1;
      const lines = [];
      for (const item of n.children || []) {
        const marker = ordered ? `${i++}. ` : '- ';
        const indent = '  '.repeat(depth);
        const body = renderNodes(item.children, depth + 1);
        const bodyLines = body.split('\n');
        lines.push(indent + marker + (bodyLines[0] ?? ''));
        for (const l of bodyLines.slice(1)) lines.push(l ? indent + '  ' + l : '');
      }
      return lines.join('\n');
    }
    case 'CodeBlock': return codeBlock(n);
    case 'Latex': return '$' + String(n.tex ?? '').trim() + '$';
    case 'LatexBlock': return '$$\n' + String(n.tex ?? '').trim() + '\n$$';
    case 'HorizontalRule': return '---';
    case 'Image': return n.src ? `![${n.alt || ''}](${n.src})` : '';
    default: return renderNodes(n.children, depth) || inline(n.children);
  }
}

export function renderNodes(nodes, depth = 0) {
  const out = [];
  let buf = [];
  const flush = () => { const t = inline(buf); if (t.trim()) out.push(t); buf = []; };
  for (const n of nodes || []) {
    if (isInline(n)) { buf.push(n); continue; }
    flush();
    const b = renderBlock(n, depth);
    if (b && b.trim()) out.push(b);
  }
  flush();
  return out.join('\n\n');
}

// structural signature for comparison
export function signature(nodes) {
  const sig = [];
  const walk = (ns) => {
    for (const n of ns || []) {
      if (isLeafText(n)) continue;
      const text = (n.children || []).filter(isLeafText).map((c) => c.text).join('');
      sig.push(`${n.type}|${text.replace(/\s+/g, ' ').trim()}`);
      if (['BulletedList', 'OrderedList', 'Table', 'TableRow', 'TableCell', 'TableContent'].includes(n.type)) walk(n.children);
    }
  };
  walk(nodes);
  return sig;
}
