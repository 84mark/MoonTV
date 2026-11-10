import type { KidsTitle } from './kids';

// IDs checked against Bangumi Archive 2026-11-03 (title, season and release).
// Unmatched/ambiguous titles deliberately continue through Douban discovery.
const seriesIds: Record<string, number> = {
  peppa: 219075,
  ricky: 422176,
  rainbow: 183746,
  octonauts: 507559,
  fixies: 658349,
  superwings: 132572,
  pawpatrol: 264310,
  mickey: 236635,
  dora: 389046,
  tutu: 44676,
  historycats: 259553,
  shuke: 318874,
  bluey: 366227,
  pony: 29870,
  thomas: 259618,
  bears: 81109,
  pleasantgoat: 13131,
};

// Public documented image endpoint; the browser follows its CDN redirect.
// No metadata search is needed to show these already identified titles.
export function getKidsPosterFallback(seed: KidsTitle): string {
  const id = seed.catalogSource?.id || seriesIds[seed.id];
  return id ? `https://api.bgm.tv/v0/subjects/${id}/image?type=medium` : '';
}
