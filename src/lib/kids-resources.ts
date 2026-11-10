import type { KidsTitle } from './kids';
import { KIDS_TITLES } from './kids';
import type { SearchResult } from './types';
import { yellowWords } from './yellow';

export interface KidsLanguage {
  code: string;
  label: string;
}
export interface KidsVariant {
  id: string;
  title: string;
  poster: string;
  language: KidsLanguage;
  sources: SearchResult[];
  season: string;
  year: string;
  kind: 'movie' | 'tv';
}
const languagePatterns: [string, string, RegExp][] = [
  ['zh-CN', '普通话', /普通话|国语|汉语|中文|mandarin|chinese|\bzh(?:-cn)?\b/i],
  ['en', '英语', /英语|英文|english|\ben\b/i],
  ['yue', '粤语', /粤语|粤配|广东话|cantonese|\byue\b/i],
  ['ja', '日语', /日语|日文|japanese|\bja\b/i],
  ['ko', '韩语', /韩语|韩文|korean|\bko\b/i],
  ['fr', '法语', /法语|法文|french|\bfr\b/i],
  ['ru', '俄语', /俄语|俄文|russian|\bru\b/i],
];
function withoutSubtitleLabels(value: string): string {
  return value
    .replace(
      /(?:简体中文|繁体中文|中英双语|中英|简繁|普通话|中文|英文|英语|国语|粤语|日语|日文|韩语|韩文|法语|俄语|简体|繁体)(?:字幕|字)/gi,
      ''
    )
    .replace(/简中|繁中|中字|双字/g, '');
}
/** Resource language is source metadata, not the cartoon's country of origin. */
export function kidsLanguage(
  source: Pick<SearchResult, 'title' | 'language' | 'region'>
): KidsLanguage {
  const explicit =
    typeof source.language === 'string' ? source.language.trim() : '';
  const informative =
    explicit && !/^(未知|不详|内详|其他|unknown|und|无|-)$/i.test(explicit);
  const text = informative
    ? withoutSubtitleLabels(explicit)
    : withoutSubtitleLabels(
        typeof source.title === 'string' ? source.title : ''
      );
  const hits = languagePatterns.filter(([, , pattern]) => pattern.test(text));
  if (hits.length > 1 || /双语|多语|多国语言|dual|multi/i.test(text)) {
    const codes = hits.map(([code]) => code);
    if (codes.length === 1) codes.push('unknown');
    return {
      code: codes.length ? `multi:${codes.sort().join('+')}` : 'multi',
      label:
        hits.length > 1
          ? `${hits.map(([, label]) => label).join(' / ')} · 多语`
          : hits.length === 1
          ? `${hits[0][1]} / 其他语言待确认`
          : '多语版本待确认',
    };
  }
  if (hits.length === 1) return { code: hits[0][0], label: hits[0][1] };
  return { code: 'unknown', label: '语言待确认' };
}
function strippedTitle(title: string, stripSeason = true) {
  const normalized = withoutSubtitleLabels(title).normalize('NFKC');
  const base = stripSeason
    ? normalized
        .replace(/第[一二三四五六七八九十百零〇两\d]+[季部辑]/g, '')
        .replace(/(?:season|\bs)\s*\d+/gi, '')
    : normalized;
  return base
    .replace(
      /(?:普通话|国语|英语|英文|粤语|日语|日文|韩语|中文|汉语|双语|多语)(?:版|配音)?/g,
      ''
    )
    .replace(/(?:Mandarin|English|Cantonese|Japanese)(?:\s*Dub(?:bed)?)?/gi, '')
    .replace(
      /(?:配音版|配音|原声版|原版|全集|完整版|高清版|HD|BD|1080p|720p)/gi,
      ''
    )
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}
export function kidsFamilyTitle(title: string): string {
  return strippedTitle(title);
}
export function kidsSearchTitle(item: KidsTitle): string {
  return item.name
    .replace(/第[一二三四五六七八九十百零〇两\d]+[季部辑]/g, '')
    .trim();
}
export function matchesKidsTitle(
  item: KidsTitle,
  source: SearchResult
): boolean {
  if (
    typeof source.title !== 'string' ||
    !source.title ||
    !Array.isArray(source.episodes) ||
    !source.episodes.length
  )
    return false;
  const contentType = `${source.type_name || ''} ${source.class || ''}`;
  if (
    yellowWords.some((word) => contentType.includes(word)) ||
    /成人|情色|色情|里番|R18|18禁/i.test(contentType)
  )
    return false;
  const type = source.type_name || '';
  const movie = /电影|长片|(?:剧情|动作|喜剧|爱情|恐怖|科幻|纪录)片/.test(type);
  const tv = /电视剧|连续剧|剧集|番剧|动画剧|动漫剧|TV动画/.test(type);
  if (
    /真人电影|真人剧|短剧/.test(type) ||
    (item.kind === 'tv' && movie) ||
    (item.kind === 'movie' && tv)
  )
    return false;
  // Preserve sequel identity; aliases are exact approved titles, never prefix matches.
  // A known different year must not turn an animated pick into a live-action remake.
  if (
    item.kind === 'movie' &&
    item.year &&
    /^\d{4}$/.test(source.year || '') &&
    !(item.releaseYears || [item.year]).includes(source.year)
  )
    return false;
  const stripSeason = item.kind === 'tv';
  const title = strippedTitle(source.title, stripSeason);
  return [item.name, ...(item.aliases || [])].some(
    (name) => strippedTitle(name, stripSeason) === title
  );
}
function ordinal(value: string): string {
  if (/^\d+$/.test(value)) return String(Number(value));
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === '十') return '10';
  const tens = value.split('十');
  if (tens.length === 2)
    return String(
      (tens[0] ? digits[tens[0]] || 0 : 1) * 10 +
        (tens[1] ? digits[tens[1]] || 0 : 0)
    );
  return digits[value] === undefined ? value : String(digits[value]);
}
export function kidsSeason(title: string): string {
  const match = title.match(/第([一二三四五六七八九十百零〇两\d]+)[季部辑]/);
  if (match) return `第${ordinal(match[1])}季`;
  const english = title.match(/(?:season|\bs)\s*(\d+)/i);
  return english ? `第${ordinal(english[1])}季` : '';
}
/** Keep a language/season selected in the children's resource pool during playback. */
export function kidsPlaybackMatches(
  params: URLSearchParams,
  source: SearchResult
): boolean {
  const id = params.get('kids_id');
  if (!id) return true;
  const item = KIDS_TITLES.find((candidate) => candidate.id === id);
  if (!item || !matchesKidsTitle(item, source)) return false;
  const language = params.get('kids_language');
  if (language && kidsLanguage(source).code !== language) return false;
  const requestedSeason = kidsSeason(params.get('title') || '');
  if (kidsSeason(source.title) !== requestedSeason) return false;
  const year = params.get('year');
  if (year && /^\d{4}$/.test(year) && source.year !== year) return false;
  return true;
}

export function groupKidsVariants(
  item: KidsTitle,
  results: SearchResult[]
): KidsVariant[] {
  const groups = new Map<string, KidsVariant>();
  for (const source of results) {
    if (!matchesKidsTitle(item, source)) continue;
    const language = kidsLanguage(source);
    const season = kidsSeason(source.title);
    const year = /^\d{4}$/.test(source.year) ? source.year : '';
    const id = `${item.id}:${season || 'unspecified'}:${year}:${language.code}`;
    const previous = groups.get(id);
    if (previous) {
      if (
        !previous.sources.some(
          (s) => s.source === source.source && s.id === source.id
        )
      )
        previous.sources.push(source);
      if (
        !previous.poster &&
        typeof source.poster === 'string' &&
        source.poster
      )
        previous.poster = source.poster;
    } else
      groups.set(id, {
        id,
        title: source.title,
        poster: typeof source.poster === 'string' ? source.poster : '',
        language,
        season,
        year,
        kind: item.kind,
        sources: [source],
      });
  }
  return Array.from(groups.values()).sort(
    (a, b) =>
      a.language.label.localeCompare(b.language.label, 'zh-CN') ||
      a.title.localeCompare(b.title, 'zh-CN', { numeric: true })
  );
}
