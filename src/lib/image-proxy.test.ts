import { getBuiltinImageProxyUrl, getDoubanImageUrl } from './image-proxy';

const poster =
  'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg';

describe('built-in Douban poster URLs', () => {
  it.each([poster, poster.replace('https:', 'http:'), poster.slice(6)])(
    'normalizes %s to HTTPS',
    (value) => {
      expect(getDoubanImageUrl(value)?.href).toBe(poster);
      expect(getBuiltinImageProxyUrl(value)).toBe(
        `/api/image?url=${encodeURIComponent(poster)}`
      );
    }
  );

  it.each([
    '',
    '/logo.png',
    'https://127.0.0.1/view/photo/poster.jpg',
    poster.replace('img3.doubanio.com', 'img3.doubanio.com.evil.test'),
    poster.replace('img3.doubanio.com', 'evil.doubanio.com'),
    poster.replace('https:', 'ftp:'),
    poster.replace('img3.', 'user:password@img3.'),
    poster.replace('.com/', '.com:8080/'),
    poster.replace('/view/photo/', '/private/'),
    poster.replace('.jpg', '.svg'),
  ])('rejects unsupported targets: %s', (value) => {
    expect(getDoubanImageUrl(value)).toBeNull();
    expect(getBuiltinImageProxyUrl(value)).toBeNull();
  });
});
