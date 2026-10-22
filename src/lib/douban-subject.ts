import type { DoubanSubject } from './douban-comments';
import { getDoubanImageUrl } from './image-proxy';

export interface DoubanSubjectDetail extends DoubanSubject {
  intro: string;
  poster: string;
  rating: number | null;
  ratingCount: number;
  genres: string[];
  directors: string[];
  actors: string[];
  photos: { id: string; url: string }[];
}

export function parseDoubanSubject(
  value: unknown,
  id: string
): DoubanSubjectDetail {
  if (!value || typeof value !== 'object') throw new Error('影片信息无效');
  const data = value as Record<string, unknown>;
  if (String(data.id) !== id || typeof data.title !== 'string')
    throw new Error('影片信息不匹配');
  const pic = data.pic as { large?: unknown; normal?: unknown } | undefined;
  const rating = data.rating as
    | { value?: unknown; count?: unknown }
    | undefined;
  const names = (items: unknown) =>
    Array.isArray(items)
      ? items
          .flatMap((item) =>
            item && typeof item.name === 'string'
              ? [item.name.slice(0, 100)]
              : []
          )
          .slice(0, 8)
      : [];
  const poster =
    typeof pic?.large === 'string' && getDoubanImageUrl(pic.large)
      ? pic.large
      : typeof pic?.normal === 'string' && getDoubanImageUrl(pic.normal)
      ? pic.normal
      : '';
  return {
    id,
    kind: data.type === 'tv' || data.is_tv === true ? 'tv' : 'movie',
    title: data.title.slice(0, 200),
    year: String(data.year || '').slice(0, 20),
    intro: typeof data.intro === 'string' ? data.intro.slice(0, 10000) : '',
    poster,
    rating:
      typeof rating?.value === 'number' &&
      Number.isFinite(rating.value) &&
      rating.value >= 0 &&
      rating.value <= 10
        ? rating.value
        : null,
    ratingCount:
      typeof rating?.count === 'number' &&
      Number.isSafeInteger(rating.count) &&
      rating.count >= 0
        ? rating.count
        : 0,
    genres: Array.isArray(data.genres)
      ? data.genres
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 8)
      : [],
    directors: names(data.directors),
    actors: names(data.actors),
    photos: [],
  };
}

export function parseDoubanPhotos(
  value: unknown
): DoubanSubjectDetail['photos'] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('photos' in value) ||
    !Array.isArray(value.photos)
  )
    return [];
  const photos: DoubanSubjectDetail['photos'] = [];
  for (const photo of value.photos.slice(0, 12)) {
    const image = photo?.image?.large || photo?.image?.normal;
    if (
      typeof photo?.id !== 'string' ||
      !/^\d+$/.test(photo.id) ||
      typeof image?.url !== 'string' ||
      !getDoubanImageUrl(image.url) ||
      image.width < image.height
    )
      continue;
    if (!photos.some((item) => item.id === photo.id))
      photos.push({ id: photo.id, url: image.url });
  }
  return photos.slice(0, 6);
}
