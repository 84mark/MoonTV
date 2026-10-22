import { NextResponse } from 'next/server';

import type { DoubanSubject } from '@/lib/douban-comments';
import {
  fetchDoubanJson,
  fetchDoubanRelated,
  fetchDoubanSubjectData,
  matchDoubanSubjects,
  parseDoubanComments,
  validDoubanId,
} from '@/lib/douban-comments';

export const runtime = 'edge';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id') || '';
  const title = (params.get('title') || '').trim();
  const year = params.get('year') || '';
  const offset = params.get('start') || '0';
  const preferredKind = params.get('kind') || '';
  if (
    (preferredKind && !['movie', 'tv'].includes(preferredKind)) ||
    (id && !validDoubanId(id)) ||
    (!id && (!title || title.length > 200)) ||
    (year && !/^\d{4}$/.test(year)) ||
    !/^\d{1,3}$/.test(offset) ||
    Number(offset) > 200 ||
    (!id && offset !== '0')
  ) {
    return NextResponse.json(
      { error: '影片或分页参数无效' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  try {
    let subject: DoubanSubject | null = null;
    let candidates: DoubanSubject[] = [];
    if (id) {
      const { data, kind } = await fetchDoubanSubjectData(id, preferredKind);
      subject = {
        id,
        title: String(data.title).slice(0, 200),
        year: String(data.year || '').slice(0, 20),
        kind,
      };
    } else {
      ({ subject, candidates } = matchDoubanSubjects(
        await fetchDoubanJson(
          `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(
            title
          )}`
        ),
        title,
        year
      ));
    }
    if (!subject)
      return NextResponse.json(
        { subject, candidates, comments: [], nextStart: null },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    const kind = subject.kind || (preferredKind === 'tv' ? 'tv' : 'movie');
    const data = await fetchDoubanRelated(
      subject.id,
      kind,
      'interests',
      `count=20&start=${Number(offset)}&order_by=hot&status=done`
    );
    return NextResponse.json(
      { subject, candidates: [], ...parseDoubanComments(data, Number(offset)) },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch {
    return NextResponse.json(
      { error: '豆瓣短评暂时无法获取，请稍后重试或前往豆瓣查看。' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
