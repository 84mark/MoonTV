/** @jest-environment node */
import { webcrypto } from 'crypto';

import {
  rewriteLivePlaylist,
  signLiveRelayToken,
  validateLiveRelayUrl,
  verifyLiveRelayToken,
} from './live-relay';

Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const secret = 'test-only-site-secret';
it('rewrites variants, media renditions, maps, keys and relative segment URLs into signed same-origin resources', async () => {
  const result = await rewriteLivePlaylist(
    `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/live.m3u8"
#EXT-X-KEY:METHOD=AES-128,URI="../key.bin?token=abc"
#EXT-X-MAP:URI="init.mp4"
#EXT-X-STREAM-INF:BANDWIDTH=1000
low/index.php?quality=1
#EXTINF:6,
http://cdn.example.com/segment.ts
`,
    'https://media.example.com/live/master.m3u8',
    secret
  );
  expect(result).not.toContain('http://');
  const tokens = Array.from(result.matchAll(/token=([A-Za-z0-9_.%-]+)/g)).map(
    (m) => decodeURIComponent(m[1])
  );
  const resources = await Promise.all(
    tokens.map((token) => verifyLiveRelayToken(token, secret))
  );
  expect(resources.map((r) => [r.url, r.playlist])).toEqual([
    ['https://media.example.com/live/audio/live.m3u8', true],
    ['https://media.example.com/key.bin?token=abc', false],
    ['https://media.example.com/live/init.mp4', false],
    ['https://media.example.com/live/low/index.php?quality=1', true],
    ['http://cdn.example.com/segment.ts', false],
  ]);
});
it('rejects altered and expired tokens', async () => {
  const token = await signLiveRelayToken(
    'https://media.example.com/a.ts',
    secret
  );
  await expect(verifyLiveRelayToken(token, secret)).resolves.toMatchObject({
    playlist: false,
  });
  await expect(verifyLiveRelayToken(token + 'a', secret)).rejects.toThrow();
  await expect(verifyLiveRelayToken(token, 'wrong')).rejects.toThrow();
  const spy = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.now() + 11 * 60 * 1000);
  await expect(verifyLiveRelayToken(token, secret)).rejects.toThrow('过期');
  spy.mockRestore();
});
it.each([
  'http://127.0.0.1/a',
  'http://0x7f000001/a',
  'http://2130706433/a',
  'http://10.0.0.1/a',
  'http://172.16.1.2/a',
  'http://169.254.169.254/latest',
  'http://[::1]/a',
  'http://localhost/a',
  'http://service.local/a',
  'https://user:secret@example.com/a',
  'file:///etc/passwd',
])('rejects non-public resource %s', (url) => {
  expect(() => validateLiveRelayUrl(url)).toThrow();
});
it('rejects malformed playlists and private nested addresses', async () => {
  await expect(
    rewriteLivePlaylist(
      '<html>error</html>',
      'https://media.example.com/a',
      secret
    )
  ).rejects.toThrow();
  await expect(
    rewriteLivePlaylist(
      '#EXTM3U\nhttp://10.0.0.1/segment.ts',
      'https://media.example.com/a',
      secret
    )
  ).rejects.toThrow();
});

it('keeps child playlists usable beyond segment-token lifetime for long live sessions', async () => {
  const token = await signLiveRelayToken(
    'https://media.example.com/variant.m3u8',
    secret,
    true
  );
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
  await expect(verifyLiveRelayToken(token, secret)).resolves.toMatchObject({
    playlist: true,
  });
  spy.mockReturnValue(now + 25 * 60 * 60 * 1000);
  await expect(verifyLiveRelayToken(token, secret)).rejects.toThrow('过期');
  spy.mockRestore();
});
