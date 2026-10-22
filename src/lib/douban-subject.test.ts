import { parseDoubanPhotos, parseDoubanSubject } from './douban-subject';
it('validates identity and missing fields without inventing a score', () => {
  expect(() =>
    parseDoubanSubject({ id: '1292053', title: '其他电影' }, '1292052')
  ).toThrow();
  expect(
    parseDoubanSubject(
      {
        id: '1292052',
        title: '电影',
        rating: { value: 99 },
        pic: { large: 'https://evil.test/x.jpg' },
      },
      '1292052'
    )
  ).toMatchObject({ rating: null, poster: '', intro: '', photos: [] });
});
it('only returns landscape photos from the approved Douban CDN', () => {
  const photo = {
    id: '12345',
    image: {
      large: {
        width: 800,
        height: 600,
        url: 'https://img3.doubanio.com/view/photo/l/public/p12345.jpg',
      },
    },
  };
  expect(
    parseDoubanPhotos({
      photos: [
        photo,
        photo,
        {
          ...photo,
          id: '12346',
          image: {
            large: { ...photo.image.large, url: 'https://evil.test/x.jpg' },
          },
        },
      ],
    })
  ).toEqual([{ id: '12345', url: photo.image.large.url }]);
  expect(
    parseDoubanPhotos({
      photos: [
        { ...photo, image: { large: { ...photo.image.large, height: 1000 } } },
      ],
    })
  ).toEqual([]);
});
