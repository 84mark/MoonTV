import {
  mergeSources,
  normalizeSources,
  parseSourceImport,
  validateSourceUrl,
} from './sources';

const source = {
  key: 'sample',
  name: '示例源',
  api: 'https://example.com/api.php/provide/vod',
  from: 'custom' as const,
};

it.each([
  'http://127.0.0.1/api',
  'http://2130706433/api',
  'http://[::1]/api',
  'https://localhost/api',
  'https://metadata.internal/api',
  'file:///tmp/config',
  'https://user:secret@example.com/api',
  'https://example.com:8080/api',
])('rejects unsafe source endpoints: %s', (value) =>
  expect(() => validateSourceUrl(value)).toThrow()
);

it('normalizes sources and rejects duplicate IDs or API endpoints', () => {
  expect(normalizeSources([{ ...source, name: ' 示例源 ' }])[0].name).toBe(
    '示例源'
  );
  expect(() =>
    normalizeSources([source, { ...source, key: 'another' }])
  ).toThrow('重复');
  expect(() =>
    normalizeSources([source, { ...source, api: 'https://example.org/api' }])
  ).toThrow('重复');
});

it('imports MoonTV configuration without treating arbitrary homepages as HTML scrapers', () => {
  const result = parseSourceImport(
    JSON.stringify({
      api_site: { sample: { ...source, detail: 'https://example.com' } },
    })
  );
  expect(result).toHaveLength(1);
  expect(result[0].detail).toBeUndefined();
  expect(result[0].api).toBe(source.api);
});

it('preserves IDs, disabled sources and custom edits while merging subscription updates', () => {
  const result = mergeSources(
    [{ ...source, disabled: true }],
    [{ ...source, key: 'upstream-renamed', name: '更新名称' }]
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    key: 'sample',
    name: '更新名称',
    disabled: true,
  });
});

it('round-trips exports including disabled sources and supports intentional empty configurations', () => {
  const normalized = normalizeSources([{ ...source, disabled: true }]);
  expect(
    parseSourceImport(JSON.stringify({ version: 1, sources: normalized }))
  ).toEqual(normalized);
  expect(normalizeSources([])).toEqual([]);
});
