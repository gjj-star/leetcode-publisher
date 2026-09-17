// Self-contained tests for the prose lint rules. No framework, no fixtures on disk.
//   node test/lint.test.mjs
import { contrastCheck, maskCode, styleCheck, profileStyle } from '../src/style.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- catching

console.log('=== 应当命中 ===');
const prose = [
  '这题真正的关键不是「怎么反转整数」，而是判断回文只需要左半边等于右半边反转。',
  '这道题并非考察编码技巧，而是考察你对边界的敏感度。',
  '重点不在于写了多少行，而在于有没有想清楚状态转移。',
  '与其说这是一道数学题，不如说它是一道模拟题。',
];
for (const s of prose) {
  const hits = contrastCheck(s);
  check(`抓到: ${s.slice(0, 16)}…`, hits.length === 1 && hits[0].level === 'warn', `命中 ${hits.length}`);
}

const enumForm = '所以规则不是"最短优先"，也不是"起点最早优先"，而是：';
const enumHits = contrastCheck(enumForm);
check(
  '排除式降级为 info',
  enumHits.length === 1 && enumHits[0].level === 'info',
  `level=${enumHits[0]?.level}`
);

// ---------------------------------------------------------------- sparing

console.log('\n=== 应当放过 ===');
const clean = '先框住答案的范围，然后逐个对半切，直到左右指针相遇。';
check('普通叙述不命中', contrastCheck(clean).length === 0);

const fenced = ['```python3', 'note = "这不是 bug，而是 feature"', '```'].join('\n');
check('代码块内不命中', contrastCheck(fenced).length === 0);

const inlineCode = '写法是 `不是 A 而是 B`，注意它在反引号里。';
check('行内代码不命中', contrastCheck(inlineCode).length === 0);

const mixed = '正文里不是 A 而是 B，但 `不是 C 而是 D` 在反引号里。';
check('同一行只抓裸露的那处', contrastCheck(mixed).length === 1, `命中 ${contrastCheck(mixed).length}`);

// ---------------------------------------------------------------- masking

console.log('\n=== 屏蔽保留行号 ===');
const multi = ['# 标题', '', '第一段。', '', '```', 'code', '```', '', '第二段不是 A 而是 B。'].join('\n');
const masked = maskCode(multi);
check('行数不变', masked.split('\n').length === multi.split('\n').length);
check('代码内容被抹掉', !masked.includes('code'));
const hit = contrastCheck(multi)[0];
check('行号指向原文正确位置', hit?.line === 9, `line=${hit?.line}`);

// ---------------------------------------------------------------- ignore

console.log('\n=== ignore ===');
check('ignore 生效', contrastCheck(prose[0], { ignore: ['not-x-but-y'] }).length === 0);
check('ignore 其他 id 不影响', contrastCheck(prose[0], { ignore: ['something-else'] }).length === 1);

// ---------------------------------------------------------------- integration

console.log('\n=== styleCheck 集成 ===');
const profile = profileStyle([
  { title: 'a', markdown: '# 思路\n\n> 方法\n\n# 解题过程\n\n## 第一步：x\n\n# 复杂度\n\n- 时间复杂度: $O(n)$\n- 空间复杂度: $O(1)$\n\n# Code\n\n```python3\npass\n```\n' },
  { title: 'b', markdown: '# 思路\n\n> 方法\n\n# 解题过程\n\n## 第一步：y\n\n# 复杂度\n\n- 时间复杂度: $O(n)$\n- 空间复杂度: $O(1)$\n\n# Code\n\n```python3\npass\n```\n' },
]);
const draft = [
  '> Problem: [1. 两数之和](https://leetcode.cn/problems/two-sum/description/)',
  '',
  '# 思路',
  '',
  '> 哈希表',
  '',
  '# 解题过程',
  '',
  '## 第一步：建表',
  '',
  '这题不是考察哈希，而是考察你怎么处理重复元素。',
  '',
  '# 复杂度',
  '',
  '- 时间复杂度: $O(n)$',
  '- 空间复杂度: $O(n)$',
  '',
  '# Code',
  '',
  '```python3',
  'pass',
  '```',
].join('\n');
const found = styleCheck(draft, profile);
check('句式规则并入 styleCheck', found.some((i) => i.rule === 'not-x-but-y'));
check('全程无 error（不阻断发布）', found.every((i) => i.level !== 'error'));
check('忽略后不再出现', !styleCheck(draft, profile, { ignore: ['not-x-but-y'] }).some((i) => i.rule === 'not-x-but-y'));

console.log(`\n${failures ? failures + ' 项失败' : '全部通过'}`);
process.exit(failures ? 1 : 0);
