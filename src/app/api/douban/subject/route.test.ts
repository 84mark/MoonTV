/** @jest-environment node */
import { Request, Response } from 'next/dist/compiled/@edge-runtime/primitives';

const mockJson = jest.fn();
const mockSubject = jest.fn();
const mockRelated = jest.fn();
jest.mock('@/lib/douban-comments', () => ({
  ...jest.requireActual('@/lib/douban-comments'),
  fetchDoubanJson: mockJson,
  fetchDoubanSubjectData: mockSubject,
  fetchDoubanRelated: mockRelated,
}));
jest.mock('@/lib/douban-subject', () => ({
  parseDoubanSubject: () => ({ poster: 'https://example.com/full.jpg' }),
  parseDoubanPhotos: () => [],
}));
Object.assign(global, { Request, Response });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET }: typeof import('./route') = require('./route');
const suggestion = {
  id: '123456',
  title: '龙猫',
  year: '1988',
  type: 'movie',
  img: 'https://img.example.com/poster.jpg',
};
const request = (extra = '&posterOnly=1') =>
  new Request(
    `https://example.com/api/douban/subject?title=龙猫&year=1988&kind=movie${extra}`
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockJson.mockResolvedValue([suggestion]);
  mockSubject.mockResolvedValue({ data: {}, kind: 'movie' });
  mockRelated.mockResolvedValue({});
});
it('returns the uniquely matching suggestion poster without fetching subject details', async () => {
  const response = await GET(request());
  expect((await response.json()).subject).toEqual({
    id: '123456',
    title: '龙猫',
    year: '1988',
    kind: 'movie',
    poster: suggestion.img,
  });
  expect(mockJson).toHaveBeenCalledTimes(1);
  expect(mockSubject).not.toHaveBeenCalled();
  expect(mockRelated).not.toHaveBeenCalled();
});
it.each([
  [[{ ...suggestion, type: 'tv' }]],
  [[{ ...suggestion, year: '2026' }]],
  [[suggestion, { ...suggestion, id: '123457' }]],
])(
  'does not guess a poster for wrong kinds, years or ambiguous subjects',
  async (items) => {
    mockJson.mockResolvedValue(items);
    expect((await (await GET(request())).json()).subject).toBeNull();
    expect(mockSubject).not.toHaveBeenCalled();
  }
);
it.each(['', 'javascript:alert(1)', 'not a URL'])(
  'falls back for an invalid suggestion image %s',
  async (img) => {
    mockJson.mockResolvedValue([{ ...suggestion, img }]);
    expect((await (await GET(request())).json()).subject.poster).toBe(
      'https://example.com/full.jpg'
    );
    expect(mockSubject).toHaveBeenCalledWith('123456', 'movie');
    expect(mockRelated).not.toHaveBeenCalled();
  }
);
it('keeps normal detail and gallery loading unchanged', async () => {
  await GET(request(''));
  expect(mockSubject).toHaveBeenCalledWith('123456', 'movie');
  expect(mockRelated).toHaveBeenCalledTimes(1);
});
