import {
  filterKidsTitles,
  KIDS_AGE_GROUPS,
  KIDS_TITLES,
  kidsAgeGroup,
  kidsDetailHref,
} from './kids';

it('keeps an explicit age group and defaults unknown URL values to parent-guided preschool picks', () => {
  expect(kidsAgeGroup(null)).toBe('2-4');
  expect(kidsAgeGroup('all')).toBe('2-4');
  expect(kidsAgeGroup('8-12')).toBe('8-12');
});
it('provides distinct, nonempty curated selections for each supported age', () => {
  expect(new Set(KIDS_TITLES.map((item) => item.id)).size).toBe(
    KIDS_TITLES.length
  );
  for (const group of KIDS_AGE_GROUPS) {
    const items = filterKidsTitles(group.id);
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.every((item) => item.age === group.id)).toBe(true);
  }
});
it('combines age, theme and case-insensitive keyword filtering without leaking other groups', () => {
  expect(filterKidsTitles('5-7', '自然科学', '海底')).toEqual([
    expect.objectContaining({ id: 'octonauts' }),
  ]);
  expect(filterKidsTitles('2-4', '全部', '头脑特工队')).toEqual([]);
  expect(
    filterKidsTitles('8-12', '历史文化').every(
      (item) => item.theme === '历史文化'
    )
  ).toBe(true);
});
it('sends every pick to source discovery with its content type and an age-preserving return route', () => {
  for (const item of KIDS_TITLES) {
    const url = new URL(kidsDetailHref(item, item.age), 'https://tv.example');
    expect(url.pathname).toBe('/play');
    expect(url.searchParams.get('title')).toBe(item.name);
    expect(url.searchParams.get('stype')).toBe(item.kind);
    expect(url.searchParams.get('douban_type')).toBe(item.kind);
    expect(url.searchParams.get('returnTo')).toBe(`/kids?age=${item.age}`);
    expect(url.searchParams.has('source')).toBe(false);
    expect(url.searchParams.get('year')).toBe(item.year || null);
  }
});

it('ships an offline, traceable movie catalog with separate sequels', () => {
  const movies = KIDS_TITLES.filter((item) => item.kind === 'movie');
  expect(movies.length).toBeGreaterThanOrEqual(100);
  expect(
    movies.every((item) => item.catalogSource?.provider === 'bangumi')
  ).toBe(true);
  expect(movies.every((item) => /^\d{4}$/.test(item.year || ''))).toBe(true);
  expect(new Set(movies.map((item) => item.catalogSource?.id)).size).toBe(
    movies.length
  );
  const first = movies.find((item) => item.id === 'toystory');
  const second = movies.find((item) => item.name === '玩具总动员2');
  expect(first?.year).toBe('1995');
  expect(second?.year).toBe('1999');
  expect(first?.id).not.toBe(second?.id);
  expect(filterKidsTitles('8-12', '全部', '料理鼠王')).toEqual([
    expect.objectContaining({ name: '美食总动员' }),
  ]);
});
