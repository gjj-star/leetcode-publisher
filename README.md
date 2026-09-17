# leetcode-publisher

把 Markdown 直接发成**力扣（leetcode.cn）题解**——不开编辑器，不逐行调格式。

为 agent 而建：**每一个已知的坑都被编码成一条可执行的错误提示**，所以下一个 agent 不用再逆向一遍。

```bash
node bin/lc.mjs publish --meta ./meta.json --publish --session "<TOKEN>"
# → https://leetcode.cn/problems/number-of-sets-of-k-non-overlapping-line-segments/solutions/dong-tai-gui-hua-.../
```

> 仅支持 **leetcode.cn**。国际站正文存储方式不同（走 `content` 而非 `slateValue`），未实现。

## 为什么需要它

力扣的题解编辑器是 Slate 富文本编辑器，**只读剪贴板的 `text/plain`，不读 `text/html`**。
所以从 Obsidian / 网页 / Word 里粘贴 markdown，格式全丢，只能一行行手改。

它内置了「输入 Markdown」入口（在空行输入 `/markdown`），但没有任何 API 或 MCP 支持程序化发布——
现有的 leetcode MCP server 里，题解工具**只有只读的两个**，笔记才有增删改。

这个工具补上了这块，并且把踩过的坑都固化了下来。

## 安装

只需要 Node 20+。

```bash
git clone https://github.com/gjj-star/leetcode-publisher.git
cd leetcode-publisher
npm install          # marked + MCP SDK
node bin/lc.mjs help
```

没有全局状态，没有配置文件，没有绝对路径。Windows / macOS / Linux 都能直接跑。
想全局可用：`npm link`，之后直接 `lc help`。

## 拿 token

写操作需要 `LEETCODE_SESSION`；**读操作全都不需要**（拉题解、文风归纳、干跑、校验）。

浏览器登录 leetcode.cn → `F12` → Application → Cookies → `https://leetcode.cn` → 复制 `LEETCODE_SESSION` 的值。
（它是 httpOnly，`document.cookie` 读不到。）

四种给法，优先级从高到低：

```bash
--session "<TOKEN>"              # 一次性，什么都不落盘
--session-file <路径>             # 从文件读；支持裸 token，也支持 JSON 配置
LEETCODE_SESSION=<TOKEN>         # 环境变量
lc auth login                    # 交互式存到 ~/.leetcode-session（0600 权限）
```

`--session-file` 可以指向任意 JSON 配置（例如 MCP 的 `mcp.json`）：它会在整棵树里递归查找
`LEETCODE_SESSION` 键，取到就用。这样 token **不需要经过 shell 参数或对话记录**，只在进程内读取。
输出里只回报来源路径，例如：

```
token 来源: ~/.workbuddy/mcp.json → $.mcpServers.leetcode.env.LEETCODE_SESSION
```

token **不会被写入仓库、不会被打印**，输出里有自动脱敏。

## 命令

```bash
lc auth check                     # 校验 token
lc pull <userSlug> -o ./out        # 拉取某人全部题解为 markdown

# —— 文风 ——
lc style list                                      # 列出已有预设
lc style profile --user yeechin --preset yeechin    # 立/刷新一个预设
lc style profile --official two-sum --pack ./pack   # 按官方题解立文风
lc style profile --path ~/notes/算法 --pack ./pack   # 按本地 markdown 立文风
lc style profile --user a --official b --path c --pack ./pack   # 来源可混用
lc style check draft.md --style yeechin             # 按预设体检

# —— 发布 ——
lc publish --meta ./meta.json                       # 干跑（不发任何写请求）
lc publish --meta ./meta.json --publish --retry 4 --delay 90
lc verify <articleSlug> --against draft.md           # 回读线上并逐块比对
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

标题里若有引号、方括号、中文标点，**一律走 `--meta`**，别用 `--title`——shell 会吞字符。

退出码：`0` 成功 / `1` 出错 / `2` 校验未通过。
每行 `RESULT: ...` 是给机器读的结论行。

## 文风预设

`styles/<名字>/` 就是一个预设，布局固定：

```
styles/yeechin/
  STYLE.md        人/agent 读的风格指南
  style.json      机器可读档案（喂给 style check）
  samples/*.md    归纳所依据的范文（可直接当 few-shot 参考）
```

`lc style profile --user <slug> --preset <名字>` 会整体重写这个目录。

`style.json` 里全是**客观统计**，不是形容词：

```json
{
  "skeleton":    [{"heading":"思路","inSamples":7}, {"heading":"解题过程","inSamples":7}, ...],
  "stepHeading": {"articles":7, "samples":["第一步：暴力为什么写不出来", ...]},
  "length":      {"medianChars":1477, "minChars":1238, "maxChars":3219},
  "codeLangs":   [{"lang":"python3","count":7}],
  "density":     {"inlineLatex":6.7, "bullets":4.3, "tables":0},
  "voice":       [{"label":"第一人称「我」","perArticle":8.4}, ...]
}
```

**分工是关键**：结构抽取是确定性的，交给工具；遣词造句是语言模型的活，交回给 agent。
工具不生成正文，只给参考 + 判合规。

`lc style check` 会跑两类检查，**第一类与用哪个预设无关**：

**写作口吻**：`not-x-but-y` —— `不是…而是…` 及其同族（`并非…而是` / `不在于…而在于` / `与其说…不如说`）。
这是中文写作里最容易被认出「机器写的」句式。分级做了区分：

| 形式 | 级别 | 说明 |
| --- | --- | --- |
| `不是 A，而是 B` | `warn` | 二元对比，默认建议改掉 |
| `不是 A，也不是 B，而是 C` | `info` | 排除式，作者真的逐个排除过假设时读起来是推理，可保留 |

检查前会屏蔽代码块与行内代码，不会误伤代码里的字符串。
确实非用不可时：`--ignore not-x-but-y`（MCP 传 `ignore: ["not-x-but-y"]`）。

**力扣专有 markdown 陷阱**：单行 `$$...$$`、代码块语言、缺 `# 复杂度`、篇幅偏离等。
`warn` / `info` 不阻断发布，只有 `error` 让退出码变 2。

## 多标签页代码块

在围栏语言后面加方括号即可命名：

````markdown
```python3 [暴力]
...
```

```python3 [优化]
...
```
````

**相邻的、带方括号的围栏会合并成一个 CodeBlock 的多个 CodeTab**，力扣渲染成可切换的标签页。
方括号就是「这一块是一个标签页」的开关；不带方括号的围栏保持独立代码块。
标签页可以无名，写作 `[]`。

标签名只有在块内有 2 个以上 CodeTab 时才可见——单个 CodeBlock 只显示语言，
所以想显示名字就必须用这个写法，不能拆成几个独立代码块。

## 用作 MCP server

```json
{
  "mcpServers": {
    "leetcode-publisher": {
      "command": "node",
      "args": ["<repo>/mcp/server.mjs"]
    }
  }
}
```

暴露 9 个工具：`lc_auth_check` / `lc_get_question` / `lc_get_official_solution` /
`lc_style_list` / `lc_style_profile` / `lc_style_check` / `lc_publish` / `lc_verify` / `lc_pull_user`。

`lc_publish` 默认干跑，只有显式传 `publish=true` 才真正写入。

## 给 agent 用

**先读 [`SKILL.md`](./SKILL.md)。** 它把接口细节、五个必踩的坑、标准工作流都写全了。

## 正确性

不靠"看起来对"，靠回归验证：

- **转换保真度**：拿 7 篇真实线上题解做 `线上 slateValue → markdown → slate` 往返比对，
  节点结构 100% 一致，`summary` 逐字节相同。跑 `npm run selftest` 复现。
- **端到端**：已用本工具实际发布题解，过审后回读比对 **40/40 项一致**，公式、代码块、引用块全在。
- **接口知识**来自力扣自己的前端 bundle（GraphQL 内省被禁用，无法运行时发现）。

## 已知边界

- **仅 leetcode.cn**。国际站未实现。
- 发布后 `status=CHECKING` 期间，力扣**会隐藏 `title` 和 `slateValue`**，此时 `verify` 读不到正文——这是正常的。
- 官方题解取自 `question.solution.content`（本身就是 markdown）。
- 发布有随机限流，`--retry` 可自动扛。

## 许可

MIT。这是非官方工具，与领扣网络无关；用它自动化操作你自己的账号，风险自负。
