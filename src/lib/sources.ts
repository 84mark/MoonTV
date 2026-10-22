export interface VideoSource {
  key: string;
  name: string;
  api: string;
  detail?: string;
  from: 'config' | 'custom';
  disabled?: boolean;
}

export const SOURCE_CATALOGS = [
  {
    name: 'MoonTV-api 健康源列表',
    repository: 'https://github.com/dxs1256/MoonTV-api',
    url: 'https://raw.githubusercontent.com/dxs1256/MoonTV-api/main/dist/healthy.json',
  },
  {
    name: 'moontv-source 影视源列表',
    repository: 'https://github.com/shijianus/moontv-source',
    url: 'https://raw.githubusercontent.com/shijianus/moontv-source/main/config-films.json',
  },
];

/** Reject local/network-service addresses before any server-side subrequest. */
export function validateSourceUrl(value: string): string {
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase();
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes('.') ||
    host.endsWith('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /\.(local|localhost|internal|lan|home|test|invalid)$/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  )
    throw new Error(
      '视频源必须使用公开域名的 HTTP/HTTPS 地址，不能包含账号、密码或自定义端口'
    );
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export function normalizeSources(input: unknown): VideoSource[] {
  if (!Array.isArray(input) || input.length > 100) {
    throw new Error('视频源列表最多支持 100 项');
  }
  const keys = new Set<string>();
  const apis = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('视频源格式错误');
    const source = value as Record<string, unknown>;
    if (typeof source.key !== 'string' || !/^[\w-]{1,64}$/.test(source.key)) {
      throw new Error('源标识只能包含字母、数字、下划线或横线（最多 64 字符）');
    }
    if (
      typeof source.name !== 'string' ||
      !source.name.trim() ||
      source.name.length > 100 ||
      typeof source.api !== 'string'
    ) {
      throw new Error('请填写视频源名称和 API 地址');
    }
    if (
      source.api.length > 2048 ||
      (source.detail &&
        (typeof source.detail !== 'string' || source.detail.length > 2048))
    ) {
      throw new Error('视频源地址过长或格式错误');
    }
    const api = validateSourceUrl(source.api);
    if (keys.has(source.key) || apis.has(api))
      throw new Error('源标识或 API 地址重复');
    keys.add(source.key);
    apis.add(api);
    return {
      key: source.key,
      name: source.name.trim(),
      api,
      // Detail is the optional legacy HTML-scraping endpoint, not a homepage.
      ...(source.detail
        ? { detail: validateSourceUrl(source.detail as string) }
        : {}),
      from: source.from === 'config' ? 'config' : 'custom',
      disabled: source.disabled === true,
    };
  });
}

export function parseSourceImport(text: string): VideoSource[] {
  if (text.length > 1024 * 1024) throw new Error('导入文件不能超过 1 MiB');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('配置必须是 JSON 对象或数组');
  const list = Array.isArray(data) ? data : data.sources;
  if (Array.isArray(list)) return normalizeSources(list);
  if (
    !data.api_site ||
    typeof data.api_site !== 'object' ||
    Array.isArray(data.api_site)
  ) {
    throw new Error('支持 MoonTV api_site JSON 或本站导出的 sources JSON');
  }
  // Third-party "detail" often means homepage. Only preserve it for legacy
  // scrapers actually supported here; normal MacCMS APIs supply JSON details.
  return normalizeSources(
    Object.entries(data.api_site).map(([key, value]) => {
      const item = value as Record<string, unknown>;
      return {
        ...item,
        key,
        from: 'custom',
        detail: ['ffzy', 'heimuer', 'dyttzy'].includes(key)
          ? item.detail
          : undefined,
      };
    })
  );
}

/** Merge by API or stable key, keeping a site's saved IDs and enable/disable choice. */
export function mergeSources(
  current: VideoSource[],
  incoming: VideoSource[]
): VideoSource[] {
  const result = current.map((source) => ({ ...source }));
  incoming.forEach((source) => {
    const index = result.findIndex(
      (entry) => entry.key === source.key || entry.api === source.api
    );
    if (index < 0) result.push(source);
    else
      result[index] = {
        ...source,
        key: result[index].key,
        disabled: result[index].disabled,
        from: result[index].from,
      };
  });
  return normalizeSources(result);
}
