/** @jest-environment node */
import { Request } from 'next/dist/compiled/@edge-runtime/primitives';

import { isSameOrigin } from './source-admin';

jest.mock('./config', () => ({ getConfig: jest.fn() }));
Object.assign(global, { Request });

it('accepts the actual browser Host when the Edge adapter reconstructs an internal URL', () => {
  const request = new Request('https://internal.example/api/sources', {
    headers: {
      Host: 'tv.example.com',
      Origin: 'https://tv.example.com',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  expect(isSameOrigin(request)).toBe(true);
});

it.each([
  'https://evil.example.com',
  'null',
  'file://',
  'https://user@tv.example.com',
])('rejects cross-site or opaque origins: %s', (origin) => {
  expect(
    isSameOrigin(
      new Request('https://tv.example.com/api/sources', {
        headers: { Host: 'tv.example.com', Origin: origin },
      })
    )
  ).toBe(false);
});

it('rejects explicitly cross-site browser requests even if Host matches', () => {
  expect(
    isSameOrigin(
      new Request('https://tv.example.com/api/sources', {
        headers: {
          Host: 'tv.example.com',
          Origin: 'https://tv.example.com',
          'Sec-Fetch-Site': 'cross-site',
        },
      })
    )
  ).toBe(false);
});
