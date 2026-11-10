/** Accept only local application URLs, including the original category filters. */
export function browseReturn(value: string | null): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char === '\\')
  )
    return '/';
  try {
    const url = new URL(value, 'https://moontv.local');
    return url.origin === 'https://moontv.local' &&
      ['/', '/douban', '/search', '/kids', '/live'].includes(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}`
      : '/';
  } catch {
    return '/';
  }
}

export function readBrowseFilters(
  type: string
): { primary: string; secondary: string } | null {
  try {
    const data = JSON.parse(
      sessionStorage.getItem(`browse-filters:${type}`) || 'null'
    );
    return data &&
      typeof data.primary === 'string' &&
      typeof data.secondary === 'string'
      ? data
      : null;
  } catch {
    return null;
  }
}
export function saveBrowseFilters(
  type: string,
  primary: string,
  secondary: string
) {
  try {
    sessionStorage.setItem(
      `browse-filters:${type}`,
      JSON.stringify({ primary, secondary })
    );
  } catch {
    /* Optional. */
  }
}
