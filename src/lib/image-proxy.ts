/** Only Douban's public poster CDN is supported by the built-in proxy. */
export function getDoubanImageUrl(value: string): URL | null {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !/^img\d+\.doubanio\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/view\/(photo|subject)\//.test(url.pathname) ||
      !/\.(jpe?g|png|webp|avif|gif)$/i.test(url.pathname)
    ) {
      return null;
    }
    url.protocol = 'https:';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

export function getBuiltinImageProxyUrl(value: string): string | null {
  const url = getDoubanImageUrl(value);
  return url ? `/api/image?url=${encodeURIComponent(url.href)}` : null;
}
