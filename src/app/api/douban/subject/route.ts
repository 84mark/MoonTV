import { NextResponse } from 'next/server';

import {
  fetchDoubanJson,
  fetchDoubanRelated,
  fetchDoubanSubjectData,
  matchDoubanSubjects,
  validDoubanId,
} from '@/lib/douban-comments';
import { parseDoubanPhotos, parseDoubanSubject } from '@/lib/douban-subject';

export const runtime = 'edge';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let id = params.get('id') || '';
  const title = (params.get('title') || '').trim();
  const year = params.get('year') || '';
  const preferredKind = params.get('kind') || '';
  const headers = { 'Cache-Control': 'private, max-age=300' };
  if (
    (preferredKind && !['movie', 'tv'].includes(preferredKind)) ||
    (id && !validDoubanId(id)) ||
    (!id && (!title || title.length > 200)) ||
    (year && !/^\d{4}$/.test(year))
  )
    return NextResponse.json(
      { error: '影片参数无效' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  try {
    if (!id) {
      const suggestions = await fetchDoubanJson(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(
          title
        )}`
      );
      const posterOnly = params.get('posterOnly') === '1';
      const matchingSuggestions =
        // The suggestion API labels TV subjects as `movie` too; it is not
        // a reliable movie/series discriminator. Exact title/year matching
        // still prevents selecting a similarly named season or remake.
        posterOnly && preferredKind === 'movie' && Array.isArray(suggestions)
          ? suggestions.filter((item) => item?.type === 'movie')
          : suggestions;
      const result = matchDoubanSubjects(matchingSuggestions, title, year);
      if (!result.subject)
        return NextResponse.json(
          { subject: null, candidates: result.candidates },
          { headers }
        );
      id = result.subject.id;
      if (posterOnly && Array.isArray(matchingSuggestions)) {
        const suggestion = matchingSuggestions.find((item) => item?.id === id);
        let poster = '';
        try {
          const url = new URL(suggestion?.img);
          if (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password
          )
            poster = url.href;
        } catch {
          // Missing or malformed thumbnails use the full subject fallback.
        }
        if (poster)
          return NextResponse.json(
            {
              subject: {
                ...result.subject,
                poster,
                kind: preferredKind || suggestion.type,
              },
              candidates: [],
            },
            { headers }
          );
      }
    }
    const { data, kind } = await fetchDoubanSubjectData(id, preferredKind);
    const subject = parseDoubanSubject(data, id);
    subject.kind = kind;
    // Missing photos must never hide the synopsis or prevent playback.
    try {
      if (params.get('posterOnly') !== '1')
        subject.photos = parseDoubanPhotos(
          await fetchDoubanRelated(
            id,
            kind,
            'photos',
            'count=12&start=0&type=S'
          )
        );
    } catch {
      /* Optional gallery. */
    }
    return NextResponse.json({ subject, candidates: [] }, { headers });
  } catch {
    return NextResponse.json(
      { error: '豆瓣资料暂时无法获取，仍可直接播放。' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
