// Domain layer: everything this tool knows about leetcode.cn's schema.
// Field names here were recovered from LeetCode's own frontend bundle — GraphQL
// introspection is disabled, so these cannot be discovered at runtime.
//
// If you ever need to re-derive a field name, the trick is to send a deliberately
// wrong one: validation errors leak whether a field exists and what its type is.

const USER_STATUS = `query globalData {
  userStatus { isSignedIn username realName userSlug isPremium }
}`;

const SOLUTION_LIST = `query profileSolutionArticles($userSlug: String!, $skip: Int, $first: Int) {
  solutionArticles(userSlug: $userSlug, skip: $skip, first: $first) {
    pageInfo { hasNextPage }
    edges {
      node {
        title slug createdAt status
        question { titleSlug translatedTitle questionFrontendId }
        upvoteCount hitCount
      }
    }
  }
}`;

const ARTICLE = `query discussTopic($slug: String) {
  solutionArticle(slug: $slug, orderBy: DEFAULT) {
    title slug status createdAt hitCount favoriteCount isEditorsPick
    slateValue content summary
    author { username profile { userSlug realName } }
    tags { name slug tagType }
    question { titleSlug questionFrontendId }
  }
}`;

const QUESTION = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    difficulty
    topicTags { name slug }
    solution { id title content }
  }
}`;

const QUESTION_SOLUTIONS = `query questionTopicsList($questionSlug: String!, $skip: Int, $first: Int, $orderBy: SolutionArticleOrderBy) {
  questionSolutionArticles(questionSlug: $questionSlug, skip: $skip, first: $first, orderBy: $orderBy) {
    totalNum
    edges {
      node {
        title slug hitCount upvoteCount isEditorsPick
        author { username profile { userSlug realName } }
      }
    }
  }
}`;

// --- mutations. Order matters: publish requires a draft slug to already exist. ---

const AUTO_SAVE = `mutation autoSaveSolutionArticle($data: AutoSaveSolutionArticleInput!) {
  autoSaveSolutionArticle(data: $data) {
    ok
    error
    article { slug uuid title status }
  }
}`;

const PUBLISH = `mutation publishSolutionArticle($data: PublishSolutionArticleInput!) {
  publishSolutionArticle(data: $data) {
    ok
    error
    article { slug uuid title status createdAt }
  }
}`;

// ---------------------------------------------------------------------------

export async function whoami(client) {
  const d = await client.request(USER_STATUS, {}, { label: 'userStatus' });
  return d.userStatus;
}

export async function listSolutions(client, userSlug, { max = 500 } = {}) {
  const out = [];
  for (let skip = 0; skip < max; skip += 50) {
    const d = await client.request(SOLUTION_LIST, { userSlug, skip, first: 50 }, { label: 'solutionArticles' });
    const page = d.solutionArticles;
    for (const e of page.edges) out.push(e.node);
    if (!page.pageInfo.hasNextPage) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

export async function getArticle(client, slug) {
  const d = await client.request(ARTICLE, { slug }, { label: 'solutionArticle' });
  return d.solutionArticle;
}

export async function getQuestion(client, titleSlug) {
  const d = await client.request(QUESTION, { titleSlug }, { label: 'question' });
  return d.question;
}

export async function listQuestionSolutions(client, questionSlug, { first = 20, orderBy = 'DEFAULT' } = {}) {
  const d = await client.request(
    QUESTION_SOLUTIONS,
    { questionSlug, skip: 0, first, orderBy },
    { label: 'questionSolutionArticles' }
  );
  return d.questionSolutionArticles;
}

/**
 * The official/editorial solution for a problem, if it has one.
 * `question.solution.content` is already Markdown, so no extra article fetch is needed.
 * (The same write-up also appears in questionSolutionArticles under author
 *  username "LeetCode-Solution" / realName "力扣官方题解".)
 * Returns null when the problem has no official write-up.
 */
export async function getOfficialSolution(client, titleSlug) {
  const q = await getQuestion(client, titleSlug);
  const s = q?.solution;
  if (!s?.content) return null;
  return {
    title: s.title,
    slug: `official-${titleSlug}`,
    // strip the table-of-contents directive LeetCode prepends
    markdown: s.content.replace(/^\[TOC\]\s*\n+/i, '').trim(),
  };
}

/**
 * Two-step publish, exactly mirroring the editor:
 *   1. autoSaveSolutionArticle -> creates a DRAFT, returns its slug
 *   2. publishSolutionArticle  -> publishes that draft (needs the slug from step 1)
 * Skipping step 1 makes the server answer 内容不存在.
 */
export async function createDraft(client, { questionSlug, title, tags, slateValue, slug }) {
  const data = { questionSlug, title, tags, content: '', slateValue };
  // Passing an existing slug is how the editor reopens a published article for editing:
  // autosave rewrites it, then publish republishes the same slug.
  if (slug) data.slug = slug;
  const d = await client.request(AUTO_SAVE, { data }, { label: 'autoSaveSolutionArticle' });
  const r = d.autoSaveSolutionArticle;
  if (!r?.article?.slug) {
    throw new Error(`保存${slug ? '（更新）' : '（新建草稿）'}失败：ok=${r?.ok} error=${r?.error ?? '(空)'}`);
  }
  return r.article;
}

export async function publishDraft(client, payload) {
  const d = await client.request(PUBLISH, { data: payload }, { label: 'publishSolutionArticle' });
  const r = d.publishSolutionArticle;
  if (!r?.ok) throw new Error(`发布失败：error=${r?.error ?? '(空)'}`);
  return r.article;
}

/** Built verbatim from the editor's own publish call. All fields are required. */
export function publishPayload({ questionSlug, title, summary, tags, thumbnail, slateValue, slug }) {
  return {
    title,
    content: '',
    slateValue,
    enableReward: false,
    questionSlug,
    tags,
    slug,
    mentionedUserSlugs: [],
    thumbnail: thumbnail || '',
    summary,
  };
}
