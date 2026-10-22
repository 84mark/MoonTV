export interface DoubanSubject {
  id: string;
  title: string;
  year: string;
  kind?: 'movie' | 'tv';
}
export interface DoubanComment {
  id: string;
  author: string;
  text: string;
  rating: number | null;
  time: string;
  votes: number;
}
export interface DoubanCommentsResult {
  subject: DoubanSubject | null;
  candidates: DoubanSubject[];
  comments: DoubanComment[];
  nextStart: number | null;
}

export const validDoubanId = (id: string) => /^[1-9]\d{4,11}$/.test(id);
const normalizeTitle = (title: string) =>
  title.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

// Suggestions are only candidates. Never silently choose a similarly named film.
export function matchDoubanSubjects(
  data: unknown,
  title: string,
  year: string
) {
  if (!Array.isArray(data)) throw new Error('豆瓣搜索返回格式异常');
  const candidates: DoubanSubject[] = [];
  for (const item of data) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !validDoubanId(item.id) ||
      typeof item.title !== 'string' ||
      !['movie', 'tv'].includes(item.type)
    )
      continue;
    if (!candidates.some((candidate) => candidate.id === item.id))
      candidates.push({
        id: item.id,
        title: item.title.slice(0, 200),
        year: String(item.year || '').slice(0, 20),
      });
  }
  const matches = candidates.filter(
    (item) =>
      normalizeTitle(item.title) === normalizeTitle(title) &&
      (!year || item.year === year)
  );
  return { candidates, subject: matches.length === 1 ? matches[0] : null };
}

export function parseDoubanComments(
  data: unknown,
  start: number
): Pick<DoubanCommentsResult, 'comments' | 'nextStart'> {
  if (!data || typeof data !== 'object')
    throw new Error('豆瓣短评返回格式异常');
  const value = data as { interests?: unknown; total?: unknown };
  if (
    !Array.isArray(value.interests) ||
    typeof value.total !== 'number' ||
    !Number.isFinite(value.total) ||
    value.total < 0
  )
    throw new Error('豆瓣短评暂不可用');
  const comments: DoubanComment[] = [];
  for (const item of value.interests.slice(0, 20)) {
    if (
      !item ||
      !/^\d+$/.test(String(item.id)) ||
      typeof item.comment !== 'string' ||
      !item.comment.trim()
    )
      continue;
    comments.push({
      id: String(item.id),
      author:
        typeof item.user?.name === 'string'
          ? item.user.name.slice(0, 100)
          : '豆瓣网友',
      text:
        Array.from(item.comment).slice(0, 80).join('') +
        (Array.from(item.comment).length > 80 ? '…' : ''),
      rating:
        Number.isInteger(item.rating?.value) &&
        item.rating.value >= 1 &&
        item.rating.value <= 5
          ? item.rating.value
          : null,
      time:
        typeof item.create_time === 'string'
          ? item.create_time.slice(0, 16)
          : '',
      votes:
        Number.isSafeInteger(item.vote_count) && item.vote_count >= 0
          ? item.vote_count
          : 0,
    });
  }
  const next = start + value.interests.length;
  return {
    comments,
    nextStart:
      value.interests.length > 0 && next < value.total && next <= 200
        ? next
        : null,
  };
}

// Fixed public endpoints only. No cookies, credentials or arbitrary proxy URLs.
export async function fetchDoubanJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const target = new URL(url);
    const subject = target.pathname.match(/\/(movie|tv)\/(\d+)/);
    const referer =
      target.hostname === 'movie.douban.com'
        ? 'https://movie.douban.com/'
        : subject
        ? `https://m.douban.com/${subject[1]}/subject/${subject[2]}/`
        : 'https://m.douban.com/';
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!response.ok)
      throw new Error('豆瓣暂时限制访问，请稍后重试或前往豆瓣查看');
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error('豆瓣暂时需要验证，请前往豆瓣查看');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('豆瓣响应为空');
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error('豆瓣响应过大');
        text += decoder.decode(value, { stream: true });
      }
      if (controller.signal.aborted) throw new Error('豆瓣请求超时');
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDoubanSubjectData(
  id: string,
  preferred?: string
): Promise<{ data: Record<string, unknown>; kind: 'movie' | 'tv' }> {
  const kinds: ('movie' | 'tv')[] =
    preferred === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];
  for (const endpoint of kinds) {
    try {
      const data = await fetchDoubanJson(
        `https://m.douban.com/rexxar/api/v2/${endpoint}/${id}`
      );
      if (!data || typeof data !== 'object') continue;
      const value = data as Record<string, unknown>;
      if (String(value.id) !== id || typeof value.title !== 'string') continue;
      return {
        data: value,
        kind:
          value.type === 'tv' || value.is_tv === true
            ? 'tv'
            : value.type === 'movie'
            ? 'movie'
            : endpoint,
      };
    } catch {
      /* Try the other public subject endpoint, never a challenge page. */
    }
  }
  throw new Error('豆瓣影片资料暂不可用');
}

export async function fetchDoubanRelated(
  id: string,
  kind: 'movie' | 'tv',
  field: 'interests' | 'photos',
  query: string
): Promise<unknown> {
  for (const endpoint of [kind, kind === 'tv' ? 'movie' : 'tv']) {
    try {
      const data = await fetchDoubanJson(
        `https://m.douban.com/rexxar/api/v2/${endpoint}/${id}/${field}?${query}`
      );
      if (
        data &&
        typeof data === 'object' &&
        Array.isArray((data as Record<string, unknown>)[field])
      )
        return data;
    } catch {
      /* Compatibility fallback for public endpoints. */
    }
  }
  throw new Error('豆瓣内容暂不可用');
}
