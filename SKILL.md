---
name: leetcode-publisher
description: 把 Markdown 发布成力扣（leetcode.cn）题解，或拉取/归纳题解文风。当用户要求「发题解到力扣」「把这篇笔记整理成题解发出去」「按我以前的题解风格写一篇」「拉取某人的题解」「检查这篇题解格式对不对」时使用。内含力扣 GraphQL 接口的完整知识，无需再逆向。
---

# 力扣题解发布

**不要重新逆向力扣的接口。** 这个工具已封装全部已知细节，直接调 CLI。
力扣禁用了 GraphQL 内省（`__schema` 返回空 message 的报错），字段名无法在运行时发现——自己试会反复撞墙。

## 前提：拿 token

**写操作**需要 `LEETCODE_SESSION`。**读操作全部不需要**（拉题解、文风归纳、干跑、校验）。

**必须向用户索取**，不要自己找、不要从浏览器配置里翻、不要写进任何文件或仓库。

让用户这样取：浏览器打开 leetcode.cn 并登录 → F12 → Application → Cookies → `https://leetcode.cn` → 复制 `LEETCODE_SESSION` 的值。
（它是 httpOnly，`document.cookie` 读不到，必须在 Application 面板找。）

拿到后**用 `--session` 一次性传入**，不要 `export`：

```bash
node bin/lc.mjs publish --meta ./meta.json --publish --session "<TOKEN>"
```

优先级：`--session` > `--session-file` > 环境变量 `LEETCODE_SESSION` > `~/.leetcode-session`（由 `lc auth login` 创建）。
工具会自动脱敏，token 不会出现在任何输出里。

**如果用户的机器上已经有配置文件存着 token，优先用 `--session-file` 指过去**，
这样 token 不必经过 shell 或对话记录，只在进程内读取：

```bash
node bin/lc.mjs publish --meta ./meta.json --publish \
  --session-file "~/.workbuddy/mcp.json"
```

`--session-file` 既能读裸 token 文件，也能读 JSON（如 MCP 配置文件）——它会在整棵树里递归找
`LEETCODE_SESSION` 这类键，并只回报来源路径（如 `... → $.mcpServers.leetcode.env.LEETCODE_SESSION`），
不回报值。鉴权失败时再用 `--session` 直接传。

## 命令

```bash
node bin/lc.mjs auth check --session "<TOKEN>"     # 校验 token
node bin/lc.mjs pull <userSlug> -o ./out            # 拉取某用户全部题解

# 文风
node bin/lc.mjs style list                          # 列出预设
node bin/lc.mjs style profile --user yeechin --preset yeechin   # 立/刷新预设
node bin/lc.mjs style profile --official <questionSlug> --pack ./pack
node bin/lc.mjs style profile --path <文件或目录> --pack ./pack   # 支持 Obsidian front-matter
node bin/lc.mjs style profile --user a --official b --path c --pack ./pack   # 来源可混用
node bin/lc.mjs style check <draft.md> --style <预设名>
node bin/lc.mjs style check <draft.md> --style yeechin --ignore not-x-but-y   # 确实非用该句式不可时

# 发布
node bin/lc.mjs publish --meta ./meta.json              # 干跑，不发请求
node bin/lc.mjs publish --meta ./meta.json --publish    # 真发
node bin/lc.mjs publish --meta ./meta.json --publish --retry 4 --delay 90
node bin/lc.mjs verify <articleSlug> --against <draft.md>

# 修改一篇已发布的题解：改完 markdown 后用 --draft 带上它自己的 slug 重发
node bin/lc.mjs publish --meta ./meta.json --publish --draft <articleSlug>
```

`meta.json`：

```json
{
  "questionSlug": "two-sum",
  "title": "题解标题",
  "tags": ["hash-table", "python3"],
  "markdown": "D:/path/to/article.md"
}
```

**标题含引号、方括号、中文标点时一律用 `--meta`**，不要走 `--title`，shell 会吞掉字符。

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 出错（消息里有 `→` 开头的行动建议） |
| 2 | 校验未通过（干跑有 warning，或文风检查有 error） |

每行 `RESULT: ...` 是给机器解析的结论行，优先读它而不是读散文输出。

## 必须知道的坑

这些都是踩出来的，不知道会浪费大量时间。

### 1. 发布必须两步

```graphql
# 第一步：建草稿，拿 slug
autoSaveSolutionArticle(data: {questionSlug, title, tags, content: "", slateValue})
  { ok error article { slug status } }

# 第二步：带着这个 slug 发布
publishSolutionArticle(data: {title, content: "", slateValue, enableReward: false,
  questionSlug, tags, slug, mentionedUserSlugs: [], thumbnail, summary})
  { ok error article { slug status } }
```

直接调 publish 会报 **「内容不存在」**——它要求 `data.slug` 指向一个已存在的草稿。
`enableReward` 是必填的布尔值，容易漏。

### 2. 认证需要 CSRF

除了 `LEETCODE_SESSION` cookie，还必须带请求头 `X-CSRFToken`，值与 `csrftoken` cookie 相同（Django double-submit）。
缺了会报 **「🐸☕用户未登录」**——这个报错具有误导性，它其实是 CSRF 失败，不是 token 失效。

本工具会自动伪造一对同值的合法格式 token，所以**不需要真的 csrftoken cookie**。若你手写请求，照做即可。

### 3. 发布有随机限流

报 **「内容发布太频繁啦，请稍候再试」**。等 60~120 秒重试即可。
始终加 `--retry 4 --delay 90`，让它自己扛。

### 4. 正文存在 `slateValue`，不是 `content`

力扣题解正文是 **Slate 富文本 JSON 字符串**，存在 `slateValue` 字段里；`content` 字段**恒为空字符串**。
把 markdown 塞进 `content` 是无效的——必须自己转成 Slate。

本工具内置转换器，且已用真实线上文章回归验证：
**7 篇线上题解往返比对，节点结构 100% 一致，`summary` 逐字节相同。**

### 5. 审核期间读不到正文

刚发布的文章 `status` 是 `CHECKING`。**此期间力扣会隐藏 `title` 和 `slateValue`**，
回读会得到空值或 `发生未知错误`。这是正常的，不是失败。
等状态变成 `PUBLISHED` 再 `lc verify`。过审通常几分钟到几小时。

### 6. 改已发布的文章要用 publish，不能走 autosave

想修改一篇已经 `PUBLISHED` 的题解时，**不要用 `autoSaveSolutionArticle` 带上它的 slug**——服务端会拒绝：

```
autoSaveSolutionArticle: 已发布的文章不能保存草稿
```

正确做法是直接用 `publishSolutionArticle` 带上**同一个 slug**，它会原地覆盖那篇文章：

```bash
node bin/lc.mjs publish --meta ./meta.json --publish --draft <已有的 articleSlug>
```

`--draft <slug>` 就是「跳过建草稿，目标指向这个 slug」。文章会回到 `CHECKING` 重新审核，
过审后内容即更新，slug 和链接都不变。`publishSolutionArticle` 本身就携带完整正文，
所以不需要先写入草稿。

### 7. Markdown 的力扣专有规则

- **块级公式的 `$$` 必须独占一行**，否则被当作行内公式：
  ```
  $$
  dp[i] = dp[i-1] + 1
  $$
  ```
- **代码块支持自定义标签名**（多标签页代码块）。写法是在围栏语言后面加方括号：

  ````
  ```python3 [暴力]
  ...
  ```

  ```python3 [优化]
  ...
  ```
  ````

  规则：**相邻的、带方括号的围栏会合并成一个 CodeBlock 的多个 CodeTab**，力扣渲染成可切换的标签页。
  方括号就是「这一块是一个标签页」的开关；不带方括号的围栏保持独立代码块。
  标签页可以无名，写作 `[]`（例如 python3 和 typescript 并排但不起名）。
  标签名只有在**同一个 CodeBlock 有 2 个以上 CodeTab** 时才可见——单个 CodeBlock 只显示语言，
  所以想显示名字就必须用这个写法，不能写成几个独立代码块。
- `summary` 由力扣按「正文纯文本前 250 字」生成，`thumbnail` 取第一个图片——工具会照算。
- 编辑器**只读 `text/plain`，不读 `text/html`**，所以粘贴富文本会丢格式。

### 8. 不要试图枚举 schema

`__schema` 内省被禁用。
字段名照抄 `src/leetcode.mjs`，那是从力扣前端 bundle 里挖出来的。
真要自己探，办法是发一个**故意写错的字段名**，校验错误会泄漏该字段是否存在及其类型。

## 标准工作流

用户说「把这篇整理成题解发出去」时：

1. **确认题目**：`questionSlug` 取自题目 URL `leetcode.cn/problems/<questionSlug>/`。拿不准就用 `lc_get_question` 验一下。
2. **立文风**（若用户提了风格要求）：`style profile` 生成 `style.json` + 范文包，或直接用已有预设。
3. **写稿**：读范文包里的 `STYLE.md` 和 `samples/`，据此写。不要凭空猜风格。
4. **自查**：`style check <draft> --style <预设名>`，把 `error` 级问题改掉。
5. **干跑**：`publish --meta ...`，看块数、公式数、summary 是否合理。
6. **向用户确认后再发布**——这是往公开主页发内容。确认后加 `--publish`。
7. **发布后**：`status=CHECKING` 是正常的，说明过审后再 `verify --against`。

## style check 会拦什么

分两类，**都跑，且第一类与用哪个预设无关**：

**写作口吻类**

- **`not-x-but-y`：`不是…而是…` 及其同族（`并非…而是` / `不在于…而在于` / `与其说…不如说`）**。
  这是中文写作里最容易被认出「机器写的」句式，社区已经普遍反感，**默认就别用**。
  改法是按顺序直说：把两半拆成两句，或先陈述结论再补理由。
  分级是刻意区分的：单个否定（二元对比）报 `warn`；出现多次否定的**排除式**
  （`不是 A，也不是 B，而是 C`）报 `info`——那是作者真的逐个排除过假设，读起来是推理，可以保留。
  规则会先屏蔽代码块和行内代码，不会误伤代码里的字符串。
  确实非用不可时：CLI 加 `--ignore not-x-but-y`，MCP 传 `ignore: ["not-x-but-y"]`。

**力扣专有 markdown 陷阱**

- 单行 `$$...$$`（会被当成行内公式，块级公式的 `$$` 必须独占一行）
- 代码块语言不在样例常用集合内
- 缺 `# 复杂度` / 没写时间或空间复杂度 / 完全没有代码块
- 篇幅明显偏离样例区间

`warn` 和 `info` 不阻断发布，只有 `error` 才让退出码变 2。所以「确实非用不可」的情形不会被卡住。

## 文风档案能抽什么

`style.json` 里是机械统计出来的客观特征，不是形容词：

- `skeleton`：一级标题骨架及出现频率（如 `思路 → 解题过程 → 复杂度 → Code`）
- `stepHeading`：是否用 `## 第N步：` 分步，实际标题样例
- `pitfalls`：是否单独写「坑」
- `length`：字数中位数与区间
- `codeLangs` / `density`：代码块语言、公式/列表/加粗密度
- `voice`：第一人称、自嘲、口语词频

**分工**：结构由工具抽取，遣词造句由你（语言模型）负责。工具不生成正文。
