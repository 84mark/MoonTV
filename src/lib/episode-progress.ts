// Keep only episode numbers in a bounded cookie; precise time remains in play records.
const COOKIE = 'moontv_episodes';
type Entries = [string, number][];
function identity(title: string, year: string) {
  let hash = 2166136261;
  for (const char of `${title.replace(/\s/g, '').toLowerCase()}|${year}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return (hash >>> 0).toString(36);
}
function entries(): Entries {
  if (typeof document === 'undefined') return [];
  try {
    const raw = document.cookie
      .split('; ')
      .find((item) => item.startsWith(`${COOKIE}=`));
    const data: unknown = JSON.parse(
      decodeURIComponent(raw?.slice(COOKIE.length + 1) || '[]')
    );
    return Array.isArray(data)
      ? data
          .filter(
            (item): item is [string, number] =>
              Array.isArray(item) &&
              typeof item[0] === 'string' &&
              /^[a-z0-9]{1,7}$/.test(item[0]) &&
              Number.isSafeInteger(item[1]) &&
              item[1] >= 0 &&
              item[1] < 100000
          )
          .slice(-40)
      : [];
  } catch {
    return [];
  }
}
export function storedEpisode(title: string, year = ''): number | undefined {
  return entries().find((item) => item[0] === identity(title, year))?.[1];
}
export function readEpisode(title: string, year = ''): number {
  return storedEpisode(title, year) ?? 0;
}
export function rememberEpisode(title: string, year: string, index: number) {
  if (
    !title ||
    typeof document === 'undefined' ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= 100000
  )
    return;
  try {
    const key = identity(title, year);
    const data = [
      ...entries().filter((item) => item[0] !== key),
      [key, index],
    ].slice(-40);
    document.cookie = `${COOKIE}=${encodeURIComponent(
      JSON.stringify(data)
    )}; Path=/; Max-Age=31536000; SameSite=Lax${
      location.protocol === 'https:' ? '; Secure' : ''
    }`;
  } catch {
    /* Playback still works when cookies are disabled. */
  }
}
export function requestedEpisode(params: URLSearchParams): number {
  const explicit = params.get('episode');
  if (explicit && /^[1-9]\d{0,4}$/.test(explicit)) return Number(explicit) - 1;
  return readEpisode(params.get('title') || '', params.get('year') || '');
}
