import { validateLiveRelayUrl } from '../../src/lib/live-relay';

export interface ProxyResource {
  url: string;
  playlist: boolean;
  expires: number;
  referer?: string;
  userAgent?: string;
}
const encoder = new TextEncoder();
const MAX_LIFETIME = 24 * 60 * 60 * 1000;
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;
function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decode(value: string): Uint8Array {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid ticket');
  return Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0)
  );
}
async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32)
    throw new Error('Proxy secret must contain at least 32 characters');
  if (cachedKey?.secret === secret) return cachedKey.key;
  const imported = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  cachedKey = { secret, key: imported };
  return imported;
}
function validate(resource: ProxyResource): ProxyResource {
  if (
    typeof resource.playlist !== 'boolean' ||
    !Number.isSafeInteger(resource.expires) ||
    resource.expires <= Date.now() ||
    resource.expires > Date.now() + MAX_LIFETIME + 1000
  )
    throw new Error('Ticket expired or invalid');
  const url = validateLiveRelayUrl(resource.url).href;
  const referer =
    resource.referer === undefined
      ? undefined
      : validateLiveRelayUrl(resource.referer).href;
  if (
    resource.userAgent !== undefined &&
    (typeof resource.userAgent !== 'string' ||
      !resource.userAgent.trim() ||
      resource.userAgent.length > 512 ||
      Array.from(resource.userAgent).some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159) || code > 255;
      }))
  )
    throw new Error('Invalid source User-Agent');
  return {
    url,
    playlist: resource.playlist,
    expires: resource.expires,
    ...(referer ? { referer } : {}),
    ...(resource.userAgent ? { userAgent: resource.userAgent } : {}),
  };
}
export async function signProxyToken(
  resource: ProxyResource,
  secret: string
): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify(validate(resource))));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    encoder.encode(payload)
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyProxyToken(
  token: string,
  secret: string
): Promise<ProxyResource> {
  if (token.length > 16000) throw new Error('Invalid ticket');
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !(await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      decode(parts[1]),
      encoder.encode(parts[0])
    ))
  )
    throw new Error('Invalid ticket');
  return validate(JSON.parse(new TextDecoder().decode(decode(parts[0]))));
}
