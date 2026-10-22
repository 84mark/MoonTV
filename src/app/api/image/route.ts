import { getDoubanImageUrl } from '@/lib/image-proxy';

export const runtime = 'edge';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

function failure(status: number) {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  let target = getDoubanImageUrl(
    new URL(request.url).searchParams.get('url') || ''
  );
  if (!target) return failure(400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // Validate every redirect before issuing a new request. Never forward the
    // visitor's Cookie, Authorization, Origin, or custom-domain Referer.
    for (let redirects = 0; redirects <= 3; redirects++) {
      const upstream: Response = await fetch(target.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Referer: 'https://movie.douban.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/*;q=0.8',
        },
      });

      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location: string | null = upstream.headers.get('Location');
        await upstream.body?.cancel();
        target = location
          ? getDoubanImageUrl(new URL(location, target).href)
          : null;
        if (!target) return failure(502);
        continue;
      }

      const contentType = (upstream.headers.get('Content-Type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!upstream.ok || !IMAGE_TYPES.has(contentType) || !upstream.body) {
        await upstream.body?.cancel();
        return failure(502);
      }
      if (Number(upstream.headers.get('Content-Length')) > MAX_IMAGE_BYTES) {
        await upstream.body.cancel();
        return failure(502);
      }

      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return failure(502);
        }
        chunks.push(value);
      }
      if (!size) return failure(502);

      return new Response(new Blob(chunks, { type: contentType }), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, s-maxage=604800',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return failure(502);
  } catch {
    return failure(controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}
