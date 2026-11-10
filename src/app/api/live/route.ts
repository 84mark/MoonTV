import { NextResponse } from 'next/server';

import { getLiveCatalog } from '@/lib/live-catalog';
export const runtime = 'edge';
export async function GET() {
  return NextResponse.json(await getLiveCatalog(), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
