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
      const result = matchDoubanSubjects(
        await fetchDoubanJson(
          `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(
            title
          )}`
        ),
        title,
        year
      );
      if (!result.subject)
        return NextResponse.json(
          { subject: null, candidates: result.candidates },
          { headers }
        );
      id = result.subject.id;
    }
    const { data, kind } = await fetchDoubanSubjectData(id, preferredKind);
    const subject = parseDoubanSubject(data, id);
    subject.kind = kind;
    // Missing photos must never hide the synopsis or prevent playback.
    try {
      subject.photos = parseDoubanPhotos(
        await fetchDoubanRelated(id, kind, 'photos', 'count=12&start=0&type=S')
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
