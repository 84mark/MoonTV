import {
  liveChannelRegion,
  mergeLiveChannels,
  seededLiveChannels,
} from './live';
import subscriptionSnapshot from './live-subscription-snapshot.json';
import {
  BEST_FAN_SUBSCRIPTION_URL,
  DAILY_CHANNELS_URL,
  DAILY_STATUS_URL,
  satelliteReportCurrent,
  subscriptionLiveChannels,
  verifiedSatelliteChannels,
  worldChannelCandidates,
  WorldLiveSource,
} from './live-upstreams';
import world from './live-world.json';

const sources = world as WorldLiveSource[];
const stationName = (name: string) =>
  name
    .replace(/^(CCTV)[-\s]*(\d+\+?)[-\s]*[\u4e00-\u9fff].*$/i, '$1$2')
    .replace(/(?:4K|8K|UHD|FHD|HD|高清|超清|标清|频道|[\s（）()_-])/gi, '')
    .toLowerCase();
let subscriptionChannels = subscriptionSnapshot.channels as ReturnType<
  typeof subscriptionLiveChannels
>;
const initialSeeds = seededLiveChannels();
const initialChannels = mergeLiveChannels([
  ...subscriptionChannels.map((channel) => {
    const known = initialSeeds.find(
      (seed) => stationName(seed.name) === stationName(channel.name)
    );
    return known ? { ...channel, id: known.id } : channel;
  }),
  ...initialSeeds,
]);
let saved = {
  channels: initialChannels,
  updatedAt: 0,
  fallback: true,
  subscription: {
    url: BEST_FAN_SUBSCRIPTION_URL,
    updatedAt: Date.parse(subscriptionSnapshot.capturedAt),
    channelCount: subscriptionChannels.length,
    fallback: true,
  },
};
let cachedAt = 0;
let refreshAfter = 60000;
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
  if (!cachedAt || Date.now() - cachedAt > refreshAfter) {
    if (!pending)
      pending = (async () => {
        // Never expand a country playlist into an unreviewed list of channels.
        const feeds = Array.from(
          new Set(
            sources.map((s) => s.feed).filter((feed) => /^[a-z]{2}$/.test(feed))
          )
        );
        const subscriptionPromise = fetchUpstream(
          BEST_FAN_SUBSCRIPTION_URL,
          'text'
        )
          .then((text) => ({
            channels: subscriptionLiveChannels(String(text)),
            fresh: true,
          }))
          .catch(() => ({ channels: subscriptionChannels, fresh: false }));
        const reportPromise = Promise.all([
          fetchUpstream(DAILY_STATUS_URL, 'json'),
          fetchUpstream(DAILY_CHANNELS_URL, 'json'),
        ]).catch(() => null);
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
          const result = await reportPromise;
          if (!result) throw new Error('Report unavailable');
          const [status, report] = result;
          reportCurrent = satelliteReportCurrent(status, report);
          if (reportCurrent)
            satellites = verifiedSatelliteChannels(status, report);
        } catch {
          /* A report outage never turns stale entries into newly verified channels. */
        }
        const subscription = await subscriptionPromise;
        subscriptionChannels = subscription.channels;
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
          const urls = Array.from(
            new Set([
              ...channel.urls,
              ...(result?.fresh ? found : previous?.urls || []),
            ])
          );
          return {
            ...channel,
            urls,
            relayRequired:
              liveChannelRegion(channel) === 'overseas'
                ? urls
                : urls.filter((url) => url.startsWith('http:')),
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
          reportCurrent &&
          subscription.fresh &&
          playlistResults.every((result) => result.fresh);
        const recentlyVerified = new Set(
          verified.flatMap((channel) => channel.urls)
        );
        const subscriptionCandidates = subscription.channels.map((channel) => {
          const known = [...curated, ...verified].find(
            (item) => stationName(item.name) === stationName(channel.name)
          );
          // Reuse stable IDs so favorites and relay lookups keep working.
          return known ? { ...channel, id: known.id } : channel;
        });
        saved = {
          channels: mergeLiveChannels([
            ...subscriptionCandidates,
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
          ]).map((channel) => ({
            ...channel,
            // New subscription lines have not inherited a prior line's decode result.
            ...(channel.verification?.method === 'upstream-decode' &&
            subscriptionCandidates.some(
              (candidate) =>
                candidate.id === channel.id &&
                candidate.urls.some((url) => !recentlyVerified.has(url))
            )
              ? {
                  verification: {
                    ...channel.verification,
                    method: '含订阅候选，待实测',
                  },
                }
              : {}),
            urls: [...channel.urls].sort((a, b) => {
              const rank = (url: string) =>
                (url.startsWith('https:') ? 0 : 2) +
                (recentlyVerified.has(url) ? 0 : 1);
              return rank(a) - rank(b);
            }),
          })),
          updatedAt: fresh ? Date.now() : saved.updatedAt,
          fallback: !fresh,
          subscription: {
            url: BEST_FAN_SUBSCRIPTION_URL,
            updatedAt: subscription.fresh
              ? Date.now()
              : saved.subscription.updatedAt,
            channelCount: subscription.channels.length,
            fallback: !subscription.fresh,
          },
        };
        // A partial directory outage should not re-download a healthy subscription every minute.
        refreshAfter = fresh
          ? 30 * 60000
          : subscription.fresh
          ? 5 * 60000
          : 60000;
        cachedAt = Date.now();
        return saved;
      })().finally(() => {
        pending = null;
      });
    await pending;
  }
  return saved;
}
