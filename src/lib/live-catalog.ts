import { mergeLiveChannels, seededLiveChannels } from './live';
import {
  DAILY_CHANNELS_URL,
  DAILY_STATUS_URL,
  satelliteReportCurrent,
  verifiedSatelliteChannels,
  worldChannelCandidates,
  WorldLiveSource,
} from './live-upstreams';
import world from './live-world.json';

const sources = world as WorldLiveSource[];
const stationName = (name: string) =>
  name
    .replace(/(?:4K|8K|UHD|FHD|HD|高清|超清|标清|频道|[\s（）()_-])/gi, '')
    .toLowerCase();
let saved = { channels: seededLiveChannels(), updatedAt: 0, fallback: true };
let cachedAt = 0;
let pending: Promise<typeof saved> | null = null;

async function fetchUpstream(url: string, kind: 'text' | 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Live directory unavailable');
    return kind === 'text' ? await response.text() : await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getLiveCatalog() {
  if (
    !cachedAt ||
    Date.now() - cachedAt > (saved.fallback ? 60000 : 30 * 60 * 1000)
  ) {
    if (!pending)
      pending = (async () => {
        // Never expand a country playlist into an unreviewed list of channels.
        const feeds = Array.from(
          new Set(
            sources.map((s) => s.feed).filter((feed) => /^[a-z]{2}$/.test(feed))
          )
        );
        const playlistResults = await Promise.all(
          feeds.map(async (feed) => {
            try {
              const text = await fetchUpstream(
                `https://raw.githubusercontent.com/iptv-org/iptv/master/streams/${feed}.m3u`,
                'text'
              );
              if (!String(text).trimStart().startsWith('#EXTM3U'))
                throw new Error('Invalid playlist');
              return { feed, text: String(text), fresh: true };
            } catch {
              return { feed, text: '', fresh: false };
            }
          })
        );
        const feedMap = new Map(
          playlistResults.map((result) => [result.feed, result])
        );
        let reportCurrent = false;
        let satellites: ReturnType<typeof verifiedSatelliteChannels> = [];
        try {
          const [status, report] = await Promise.all([
            fetchUpstream(DAILY_STATUS_URL, 'json'),
            fetchUpstream(DAILY_CHANNELS_URL, 'json'),
          ]);
          reportCurrent = satelliteReportCurrent(status, report);
          if (reportCurrent)
            satellites = verifiedSatelliteChannels(status, report);
        } catch {
          /* A report outage never turns old or SD entries into verified HD channels. */
        }
        const seeds = seededLiveChannels();
        const curated = seeds.map((channel) => {
          const config = sources.find((source) => source.id === channel.id);
          const result = config && feedMap.get(config.feed);
          const previous = saved.channels.find(
            (item) => item.id === channel.id
          );
          const found =
            config && result?.fresh
              ? worldChannelCandidates(config, result.text)
              : [];
          // Preserve reviewed seeds and previously discovered official alternatives on transient failure.
          return {
            ...channel,
            urls: Array.from(
              new Set([
                ...channel.urls,
                ...(result?.fresh ? found : previous?.urls || []),
              ])
            ),
          };
        });
        const verified = reportCurrent
          ? satellites
          : saved.channels.filter((channel) => {
              if (
                !channel.id.startsWith('cn:') ||
                seeds.some((seed) => seed.id === channel.id)
              )
                return false;
              const verification = (
                channel as {
                  verification?: { checkedAt?: string; method?: string };
                }
              ).verification;
              const at = Date.parse(verification?.checkedAt || '');
              return (
                verification?.method === 'upstream-decode' &&
                Number.isFinite(at) &&
                Date.now() - at <= 48 * 3600000
              );
            });
        const fresh =
          reportCurrent && playlistResults.every((result) => result.fresh);
        saved = {
          channels: mergeLiveChannels([
            ...curated,
            ...verified.map((channel) => {
              const known = curated.find(
                (seed) => stationName(seed.name) === stationName(channel.name)
              );
              return known
                ? {
                    ...known,
                    ...channel,
                    id: known.id,
                    urls: Array.from(new Set([...channel.urls, ...known.urls])),
                  }
                : channel;
            }),
          ]),
          updatedAt: fresh ? Date.now() : saved.updatedAt,
          fallback: !fresh,
        };
        cachedAt = Date.now();
        return saved;
      })().finally(() => {
        pending = null;
      });
    await pending;
  }
  return saved;
}
