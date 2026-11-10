import {
  LIVE_REGIONS,
  mergeLiveChannels,
  parseLiveM3u,
  seededLiveChannels,
} from './live';

let saved = { channels: seededLiveChannels(), updatedAt: 0, fallback: true };
let cachedAt = 0;
let pending: Promise<typeof saved> | null = null;

export async function getLiveCatalog() {
  if (
    !cachedAt ||
    Date.now() - cachedAt > (saved.fallback ? 60000 : 30 * 60 * 1000)
  ) {
    if (!pending)
      pending = (async () => {
        const results = await Promise.all(
          LIVE_REGIONS.map(async (region) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            try {
              const response = await fetch(
                `https://raw.githubusercontent.com/iptv-org/iptv/master/streams/${region}.m3u`,
                { signal: controller.signal, cache: 'no-store' }
              );
              if (!response.ok) throw new Error('Playlist unavailable');
              const channels = parseLiveM3u(await response.text(), region);
              if (!channels.length) throw new Error('Empty playlist');
              return { channels, fresh: true };
            } catch {
              return {
                channels: seededLiveChannels().filter((c) =>
                  c.id.startsWith(`${region}:`)
                ),
                fresh: false,
              };
            } finally {
              clearTimeout(timer);
            }
          })
        );
        const fresh = results.every((r) => r.fresh);
        saved = {
          channels: mergeLiveChannels(results.flatMap((r) => r.channels)),
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
