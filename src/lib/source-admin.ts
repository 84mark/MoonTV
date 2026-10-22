import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from './auth';
import { getConfig } from './config';

export async function canManageSources(request: NextRequest): Promise<boolean> {
  const auth = getAuthInfoFromCookie(request);
  if (!auth || !process.env.PASSWORD) return false;
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return auth.password === process.env.PASSWORD;
  }
  // The existing middleware verifies the signed session before entering here.
  if (!auth.username || !auth.signature) return false;
  if (auth.username === process.env.USERNAME) return true;
  const config = await getConfig();
  return config.UserConfig.Users.some(
    (user) =>
      user.username === auth.username && user.role === 'admin' && !user.banned
  );
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return false;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      return false;
    if (origin === new URL(request.url).origin) return true;
    // Next's Edge adapter can reconstruct an internal URL (or drop the local
    // dev port). The incoming Host still names the browser's actual target;
    // browsers cannot forge it in a cross-site fetch.
    return parsed.host === request.headers.get('Host');
  } catch {
    return false;
  }
}
