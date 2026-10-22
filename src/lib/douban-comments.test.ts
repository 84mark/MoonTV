import {
  fetchDoubanJson,
  matchDoubanSubjects,
  parseDoubanComments,
  validDoubanId,
} from './douban-comments';

const film = {
  id: '1292052',
  title: '肖申克的救赎',
  year: '1994',
  type: 'movie',
};
it('matches exact titles and years and excludes people and ambiguous remakes', () => {
  const remake = { ...film, id: '1292053', year: '2026' };
  expect(
    matchDoubanSubjects([film, remake], film.title, '1994').subject?.id
  ).toBe(film.id);
  expect(
    matchDoubanSubjects([film, remake], film.title, '').subject
  ).toBeNull();
  expect(matchDoubanSubjects([film], '肖申克', '1994').subject).toBeNull();
  expect(matchDoubanSubjects([film], film.title, '1995').subject).toBeNull();
  expect(
    matchDoubanSubjects([{ ...film, type: 'celebrity' }], film.title, '')
      .candidates
  ).toEqual([]);
});
it('rejects URL/path injection as an id', () => {
  for (const id of [
    '0',
    '../1292052',
    'https://evil.test',
    '1292052?x=y',
    '01292052',
    'undefined',
  ])
    expect(validDoubanId(id)).toBe(false);
  expect(validDoubanId('1292052')).toBe(true);
});
it('normalizes public interests, omits empty comments and bounds excerpts without splitting unicode', () => {
  const data = {
    total: 30,
    interests: [
      {
        id: '32514679',
        comment: '😀'.repeat(100),
        user: { name: '<script>作者</script>' },
        rating: { value: 5 },
        create_time: '2008-02-27 21:43:23',
        vote_count: 26521,
      },
      { id: '2', comment: '' },
      { id: '3', comment: '未评分短评', rating: { value: 99 }, vote_count: -1 },
    ],
  };
  const result = parseDoubanComments(data, 20);
  expect(result.nextStart).toBe(23);
  expect(result.comments).toHaveLength(2);
  expect(Array.from(result.comments[0].text)).toHaveLength(81);
  expect(result.comments[0]).toMatchObject({
    rating: 5,
    time: '2008-02-27 21:43',
    votes: 26521,
  });
  expect(result.comments[1]).toMatchObject({ rating: null, votes: 0 });
});
it('does not pretend captcha or malformed responses mean there are no reviews', () => {
  for (const data of [
    null,
    {},
    { interests: [], total: '3' },
    { interests: [], total: -1 },
    '<html>验证</html>',
  ])
    expect(() => parseDoubanComments(data, 0)).toThrow();
  expect(parseDoubanComments({ interests: [], total: 0 }, 0)).toEqual({
    comments: [],
    nextStart: null,
  });
  expect(
    parseDoubanComments(
      { interests: [{ id: '1', comment: '好' }], total: 1000 },
      200
    ).nextStart
  ).toBeNull();
});

it('uses Cloudflare-supported manual redirects and rejects a redirect response', async () => {
  const original = global.fetch;
  const mocked = jest.fn().mockResolvedValue({ ok: false, status: 302 });
  global.fetch = mocked;
  try {
    await expect(
      fetchDoubanJson('https://m.douban.com/rexxar/api/v2/movie/1292052')
    ).rejects.toThrow();
    expect(mocked).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'manual' })
    );
  } finally {
    global.fetch = original;
  }
});
