import { KIDS_TITLES } from './kids';
import { getKidsPosterFallback } from './kids-posters';

it('provides an immediate official cover URL for every archive-identified movie', () => {
  const movies = KIDS_TITLES.filter((seed) => seed.kind === 'movie');
  expect(movies.length).toBeGreaterThan(100);
  for (const seed of movies) {
    expect(getKidsPosterFallback(seed)).toBe(
      `https://api.bgm.tv/v0/subjects/${seed.catalogSource?.id}/image?type=medium`
    );
  }
});

it('uses verified TV IDs and does not guess artwork for unmatched series', () => {
  const peppa = KIDS_TITLES.find((seed) => seed.id === 'peppa');
  const garden = KIDS_TITLES.find((seed) => seed.id === 'garden');
  if (!peppa || !garden) throw new Error('Missing catalog entries');
  expect(getKidsPosterFallback(peppa)).toContain('/219075/image');
  expect(getKidsPosterFallback(garden)).toBe('');
});
