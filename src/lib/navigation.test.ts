import {
  browseReturn,
  readBrowseFilters,
  saveBrowseFilters,
} from './navigation';

it.each(['movie', 'tv', 'show'])(
  'returns to the original %s menu with filters',
  (type) => {
    expect(browseReturn(`/douban?type=${type}`)).toBe(`/douban?type=${type}`);
    saveBrowseFilters(type, '热门', '欧美');
    expect(readBrowseFilters(type)).toEqual({
      primary: '热门',
      secondary: '欧美',
    });
  }
);
it.each(['//evil.test', '/\\evil.test', 'https://evil.test', '/play', null])(
  'rejects unsafe or looping return targets %s',
  (value) => {
    expect(browseReturn(value)).toBe('/');
  }
);

it('preserves the kids age filter and live browse return targets', () => {
  expect(browseReturn('/kids?age=8-12')).toBe('/kids?age=8-12');
  expect(browseReturn('/live')).toBe('/live');
});
