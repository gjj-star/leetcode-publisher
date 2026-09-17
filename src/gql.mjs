// GraphQL transport for leetcode.cn, with every known failure mode translated into
// an actionable hint. This file is the main reason an agent does not have to
// rediscover the API by trial and error.
//
// Scope: leetcode.cn only. The international site stores article bodies differently
// (content instead of slateValue) and is not supported.

export const ENDPOINT = 'https://leetcode.cn/graphql/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// LeetCode surfaces backend failures as opaque strings. Map the ones we know.
const HINTS = [
  {
    match: /用户未登录|not logged in|Unauthorized/i,
    hint:
      '认证失败。两种可能：(1) LEETCODE_SESSION 缺失/过期；(2) 缺少 CSRF —— 力扣要求 ' +
      'X-CSRFToken 请求头与 csrftoken cookie 取同一个值（Django double-submit）。' +
      '本工具的 client 会自动伪造一对同值 token，若仍报此错，请重新获取 session。',
  },
  {
    match: /内容不存在/,
    hint:
      'publishSolutionArticle 需要 data.slug 指向一个已存在的草稿。必须先调用 ' +
      'autoSaveSolutionArticle 建草稿并取其 article.slug，再带着它发布。直接发布必报此错。',
  },
  {
    match: /太频繁|too frequent|稍候/i,
    hint: '触发发布限流。等 60~120 秒重试即可；用 --retry N --delay 秒 让本工具自动重试。',
  },
  {
    match: /Question doesn't exist|题目不存在/i,
    hint: 'questionSlug 不对。它取自题目 URL：leetcode.cn/problems/<questionSlug>/',
  },
  {
    match: /未知错误/,
    hint:
      '服务端未捕获异常，通常是入参缺字段。publishSolutionArticle 的必填项：' +
      'questionSlug / title / summary / tags / mentionedUserSlugs / thumbnail（另需 enableReward）。',
  },
  {
    match: /Cannot query field/i,
    hint: '字段名不在 schema 里。力扣禁用了 GraphQL 内省（__schema 报错），字段名需照抄 src/leetcode.mjs。',
  },
];

export class LeetCodeError extends Error {
  constructor(message, { hint, cause, status } = {}) {
    super(message);
    this.name = 'LeetCodeError';
    this.hint = hint;
    this.cause = cause;
    this.status = status;
  }
  toString() {
    return this.hint ? `${this.message}\n  → ${this.hint}` : this.message;
  }
}

function hintFor(message) {
  return HINTS.find((h) => h.match.test(message))?.hint;
}

/** Django CSRF tokens are [A-Za-z0-9], length 32 (secret) or 64 (masked). */
export function forgeCsrf() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 64; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function createClient({ session, csrf, retry = 1, delaySec = 60, onRetry } = {}) {
  // The browser sends header == cookie. Django only checks that the pair agrees,
  // so a forged same-value pair is accepted and no real csrftoken cookie is needed.
  const token = csrf || forgeCsrf();

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Accept: 'application/json',
    Origin: 'https://leetcode.cn',
    Referer: 'https://leetcode.cn/',
    'X-CSRFToken': token,
    'random-uuid': forgeCsrf().slice(0, 32),
    ...(session ? { Cookie: `LEETCODE_SESSION=${session}; csrftoken=${token}` } : {}),
  };

  async function raw(query, variables = {}) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /**
   * Run a GraphQL operation. Retries on the publish rate limit.
   * Throws LeetCodeError (with .hint) on failure; returns `data` on success.
   */
  async function request(query, variables = {}, { label = 'request' } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= Math.max(1, retry); attempt++) {
      const { status, json } = await raw(query, variables);
      if (!json) {
        lastErr = new LeetCodeError(`${label}: HTTP ${status}，响应不是 JSON`, { status });
      } else if (json.errors?.length) {
        const message = json.errors.map((e) => e.message).join(' | ');
        lastErr = new LeetCodeError(`${label}: ${message}`, { hint: hintFor(message), status });
      } else {
        return json.data;
      }

      const rateLimited = /太频繁|too frequent|稍候/i.test(lastErr.message);
      if (rateLimited && attempt < retry) {
        onRetry?.(attempt, delaySec);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
        continue;
      }
      throw lastErr;
    }
    throw lastErr;
  }

  /** Like request(), but returns { data, error } instead of throwing. */
  async function tryRequest(query, variables, opts) {
    try {
      return { data: await request(query, variables, opts), error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  return { request, tryRequest, raw, endpoint: ENDPOINT };
}
