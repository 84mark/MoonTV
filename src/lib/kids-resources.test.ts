import { KIDS_TITLES } from './kids';
import {
  groupKidsVariants,
  kidsLanguage,
  kidsPlaybackMatches,
  kidsSeason,
  matchesKidsTitle,
} from './kids-resources';
import type { SearchResult } from './types';
const item = KIDS_TITLES[0];
const result = (title = item.name, language?: string): SearchResult => ({
  id: '1',
  source: 'a',
  source_name: 'A',
  title,
  poster: 'https://example.com/poster.jpg',
  episodes: ['https://example.com/a.m3u8'],
  year: '2020',
  language,
});

it('uses source language metadata before title labels and never guesses from title script or country', () => {
  expect(kidsLanguage(result('Bluey'))).toEqual({
    code: 'unknown',
    label: '语言待确认',
  });
  expect(kidsLanguage({ ...result('动画'), region: '中国' })).toEqual({
    code: 'unknown',
    label: '语言待确认',
  });
  expect(kidsLanguage(result('动画国语版', '英语')).code).toBe('en');
  expect(kidsLanguage(result('动画英文版')).code).toBe('en');
  expect(kidsLanguage(result('动画粤语版')).code).toBe('yue');
  expect(kidsLanguage(result('动画英语版', '未知')).code).toBe('en');
  expect(kidsLanguage(result('动画', '普通话/英语')).code).toBe(
    'multi:en+zh-CN'
  );
  expect(kidsLanguage(result('动画中英双语版')).code).toBe('multi');
});
it('matches only approved cartoon families while supporting season and language suffixes', () => {
  expect(
    matchesKidsTitle(
      item,
      result(item.name.replace('第一季', '第三季') + '英语版')
    )
  ).toBe(true);
  expect(matchesKidsTitle(item, result('不相关的动画'))).toBe(false);
  expect(matchesKidsTitle(item, { ...result(), episodes: [] })).toBe(false);
  expect(matchesKidsTitle(item, { ...result(), type_name: '成人动画' })).toBe(
    false
  );
  expect(kidsSeason('示例 第一季')).toBe(kidsSeason('示例 第1季'));
  expect(kidsSeason('示例 Season 12')).toBe('第12季');
});
it('groups only identical season/year/language variants and keeps alternate sources', () => {
  const first = result();
  const variants = groupKidsVariants(item, [
    { ...first, language: '国语' },
    { ...first, id: '2', source: 'b', language: '普通话' },
    { ...first, id: '3', language: '英语' },
    { ...first, id: '4', language: '普通话/英语' },
    {
      ...first,
      id: '5',
      title: item.name.replace('第一季', '第二季'),
      language: '国语',
    },
    { ...first, id: '6', year: '2021', language: '国语' },
  ]);
  expect(variants).toHaveLength(5);
  expect(
    variants.find(
      (v) =>
        v.language.code === 'zh-CN' && v.year === '2020' && v.season === '第1季'
    )?.sources
  ).toHaveLength(2);
  expect(
    variants.find((v) => v.language.code === 'multi:en+zh-CN')?.sources
  ).toHaveLength(1);
});
it('locks children playback to the requested language, season and year', () => {
  const params = new URLSearchParams({
    kids_id: item.id,
    kids_language: 'en',
    title: item.name,
    year: '2020',
  });
  expect(kidsPlaybackMatches(params, result(item.name, '英语'))).toBe(true);
  expect(kidsPlaybackMatches(params, result(item.name, '国语'))).toBe(false);
  expect(
    kidsPlaybackMatches(
      params,
      result(item.name.replace('第一季', '第二季'), '英语')
    )
  ).toBe(false);
  expect(
    kidsPlaybackMatches(params, { ...result(item.name, '英语'), year: '2019' })
  ).toBe(false);
  expect(kidsPlaybackMatches(new URLSearchParams(), result('任意影片'))).toBe(
    true
  );
  params.set('kids_id', 'not-approved');
  expect(kidsPlaybackMatches(params, result())).toBe(false);
});

it('does not confuse subtitle languages with audio languages', () => {
  expect(kidsLanguage(result('动画英语中文字幕')).code).toBe('en');
  expect(kidsLanguage(result('动画', '英语中文字幕')).code).toBe('en');
  expect(kidsLanguage(result('动画国语配音 英语字幕')).code).toBe('zh-CN');
  expect(kidsLanguage(result('动画', '国语配音 英语字幕')).code).toBe('zh-CN');
  expect(kidsLanguage(result('动画中文字幕')).code).toBe('unknown');
  expect(matchesKidsTitle(item, result(item.name + '英语中文字幕'))).toBe(true);
});
it('does not mix clearly classified film and series resources', () => {
  expect(
    matchesKidsTitle(
      { ...item, kind: 'tv' },
      { ...result(), type_name: '动画电影' }
    )
  ).toBe(false);
  expect(
    matchesKidsTitle(
      { ...item, kind: 'movie' },
      { ...result(), type_name: '动画剧集' }
    )
  ).toBe(false);
  expect(matchesKidsTitle(item, { ...result(), type_name: '真人电影' })).toBe(
    false
  );
});

it('keeps distinct multilingual audio combinations separate and locks playback to the exact combination', () => {
  const englishChinese = { ...result(), language: '英语/国语' };
  const japaneseChinese = {
    ...result(),
    id: 'different',
    language: '日语/国语',
  };
  const variants = groupKidsVariants(item, [englishChinese, japaneseChinese]);
  expect(variants).toHaveLength(2);
  expect(new Set(variants.map((v) => v.language.code)).size).toBe(2);
  const params = new URLSearchParams({
    kids_id: item.id,
    title: item.name,
    kids_language: 'multi:en+zh-CN',
  });
  expect(kidsPlaybackMatches(params, englishChinese)).toBe(true);
  expect(kidsPlaybackMatches(params, japaneseChinese)).toBe(false);
});

it('treats malformed upstream language metadata as unconfirmed instead of throwing', () => {
  expect(
    kidsLanguage({ ...result('动画'), language: [] as unknown as string })
  ).toEqual({ code: 'unknown', label: '语言待确认' });
});

it('matches approved movie aliases without admitting sequels or live-action remakes', () => {
  const movie = KIDS_TITLES.find((title) => title.id === 'toystory');
  if (!movie) throw new Error('Missing original movie');
  const sequel = KIDS_TITLES.find((title) => title.name === '玩具总动员2');
  if (!sequel) throw new Error('Missing sequel');
  const original = { ...result('反斗奇兵 英语版'), year: '1995' };
  expect(matchesKidsTitle(movie, original)).toBe(true);
  expect(matchesKidsTitle(sequel, original)).toBe(false);
  expect(matchesKidsTitle(movie, { ...result('玩具总动员2'), year: '' })).toBe(
    false
  );
  expect(
    matchesKidsTitle(movie, { ...result('玩具总动员第二部'), year: '' })
  ).toBe(false);
  const dragon = KIDS_TITLES.find((title) => title.name === '驯龙高手');
  if (!dragon) throw new Error('Missing dragon movie');
  expect(
    matchesKidsTitle(dragon, { ...result('驯龙高手'), year: '2010' })
  ).toBe(true);
  expect(
    matchesKidsTitle(dragon, { ...result('驯龙高手'), year: '2025' })
  ).toBe(false);
  const params = new URLSearchParams({
    kids_id: movie.id,
    kids_language: 'en',
    title: '反斗奇兵 英语版',
    year: '1995',
  });
  expect(
    kidsPlaybackMatches(params, {
      ...result('Toy Story', '英语'),
      year: '1995',
    })
  ).toBe(true);
  expect(
    kidsPlaybackMatches(params, {
      ...result('Toy Story 2', '英语'),
      year: '1999',
    })
  ).toBe(false);
});

it('accepts explicitly recorded alternate release years for restored editions', () => {
  const movie = KIDS_TITLES.find((title) => title.name === '天书奇谭');
  if (!movie) throw new Error('Missing restored movie');
  expect(matchesKidsTitle(movie, { ...result(movie.name), year: '1983' })).toBe(
    true
  );
  expect(matchesKidsTitle(movie, { ...result(movie.name), year: '2021' })).toBe(
    true
  );
  expect(matchesKidsTitle(movie, { ...result(movie.name), year: '2020' })).toBe(
    false
  );
});

it('allows discovery across audio languages while retaining the selected catalogue title', () => {
  const params = new URLSearchParams({ kids_id: item.id, title: item.name });
  expect(kidsPlaybackMatches(params, result(item.name, '英语'))).toBe(true);
  expect(kidsPlaybackMatches(params, result(item.name, '国语'))).toBe(true);
  expect(kidsPlaybackMatches(params, result(item.name))).toBe(true);
  expect(kidsPlaybackMatches(params, result('任意影片', '国语'))).toBe(false);
});
