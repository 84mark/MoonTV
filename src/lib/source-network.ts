import { validateSourceUrl, VideoSource } from './sources';

export function sourceApiUrl(
  api: string,
  params: Record<string, string>
): string {
  const url = new URL(api);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );
  return url.href;
}

export async function fetchSourceUrl(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let target = validateSourceUrl(url);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(target, {
      ...init,
      cache: 'no-store',
      redirect: 'manual',
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location) throw new Error('源接口返回无效重定向');
    target = validateSourceUrl(new URL(location, target).href);
  }
  throw new Error('源接口重定向过多');
}

export interface SourceHealth {
  status: 'ok' | 'http_error' | 'timeout' | 'invalid_response' | 'unreachable';
  message: string;
  latencyMs: number | null;
  httpStatus?: number;
  itemCount?: number;
}

export async function checkSource(source: VideoSource): Promise<SourceHealth> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const url = new URL(source.api);
    url.searchParams.set('ac', 'videolist');
    url.searchParams.set('pg', '1');
    const response = await fetchSourceUrl(url.href, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        status: 'http_error',
        message: `接口返回 HTTP ${response.status}，不代表所有播放地址失效`,
        latencyMs: Date.now() - started,
        httpStatus: response.status,
      };
    }
    const reader = response.body?.getReader();
    if (!reader)
      return {
        status: 'invalid_response',
        message: '接口返回空响应',
        latencyMs: Date.now() - started,
      };
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        return {
          status: 'invalid_response',
          message: '接口响应超过检测上限（2 MiB），请手动搜索验证',
          latencyMs: Date.now() - started,
        };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        status: 'invalid_response',
        message: '返回内容不是 JSON，可能是防护页面或地址错误',
        latencyMs: Date.now() - started,
      };
    }
    if (!data || !Array.isArray(data.list))
      return {
        status: 'invalid_response',
        message: '缺少 MacCMS list 字段，请检查接口格式',
        latencyMs: Date.now() - started,
      };
    return {
      status: 'ok',
      message: data.list.length
        ? '采集接口正常；播放能力需在播放页单独验证'
        : '采集接口正常，当前列表为空',
      latencyMs: Date.now() - started,
      itemCount: data.list.length,
      httpStatus: response.status,
    };
  } catch {
    return controller.signal.aborted
      ? {
          status: 'timeout',
          message: '12 秒内未完成，可能是网络或地区限制；未判定失效',
          latencyMs: null,
        }
      : {
          status: 'unreachable',
          message: '当前服务器无法访问，可能是网络、防护或地区限制；未判定失效',
          latencyMs: null,
        };
  } finally {
    clearTimeout(timer);
  }
}
