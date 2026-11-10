import { normalizeSources, VideoSource } from './sources';

// Endpoint metadata only, reviewed against this immutable upstream snapshot.
// No Miru extension JavaScript is downloaded or executed by MoonTV.
const snapshot =
  'https://github.com/miru-project/repo/blob/ea5c6577c5af52468a4ae4165d08958ecc60794c/repo/';
export const ANIMATION_SOURCE_CANDIDATES = [
  {
    source: {
      key: 'miru-subo',
      name: '速播资源',
      api: 'https://subocaiji.com/api.php/provide/vod?from=subm3u8',
      from: 'custom',
      disabled: true,
    } as VideoSource,
    provenance: `${snapshot}subozy.com.js`,
  },
  {
    source: {
      key: 'miru-tiankong',
      name: '天空资源',
      api: 'https://api.tiankongapi.com/api.php/provide/vod?from=tkm3u8',
      from: 'custom',
      disabled: true,
    } as VideoSource,
    provenance: `${snapshot}tiankongzy.com.js`,
  },
  {
    source: {
      key: 'miru-youzhi',
      name: '优质资源',
      api: 'https://api.1080zyku.com/inc/apijson.php',
      from: 'custom',
      disabled: true,
    } as VideoSource,
    provenance: `${snapshot}yzzy.tv.js`,
  },
];

export function missingAnimationSources(
  existing: VideoSource[]
): VideoSource[] {
  const known = normalizeSources(existing);
  return normalizeSources(
    ANIMATION_SOURCE_CANDIDATES.map(({ source }) => source)
  ).filter(
    (candidate) =>
      !known.some(
        (source) =>
          source.key === candidate.key ||
          source.api === candidate.api ||
          // A source already using this host/path with different query flags is
          // still the same provider. Keep the user's endpoint and enabled state.
          new URL(source.api).origin + new URL(source.api).pathname ===
            new URL(candidate.api).origin + new URL(candidate.api).pathname
      )
  );
}
