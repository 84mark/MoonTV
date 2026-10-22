import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import runtimeConfig from '@/lib/runtime';
import { canManageSources, isSameOrigin } from '@/lib/source-admin';
import {
  getSourceDatabase,
  readSourceSettings,
  saveSourceSettings,
} from '@/lib/source-store';
import { normalizeSources, SOURCE_CATALOGS } from '@/lib/sources';

export const runtime = 'edge';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const shared = await readSourceSettings();
    const config = await getConfig();
    return NextResponse.json(
      {
        sources: shared?.sources || config.SourceConfig,
        defaults: Object.entries(runtimeConfig.api_site).map(([key, site]) => ({
          ...site,
          key,
          from: 'config',
          disabled: false,
        })),
        configured: !!getSourceDatabase(),
        revision: shared?.revision || 0,
        updatedAt: shared?.updatedAt || null,
        canManage: await canManageSources(request),
        sharedPasswordAccess:
          (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') ===
          'localstorage',
        catalogs: SOURCE_CATALOGS,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          '读取共享视频源失败，请确认 SOURCE_DB 绑定并执行 migrations/sources/0001_source_settings.sql',
      },
      { status: 503, headers }
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { error: '不允许跨站修改' },
      { status: 403, headers }
    );
  if (!(await canManageSources(request)))
    return NextResponse.json(
      { error: '需要管理权限' },
      { status: 403, headers }
    );
  const db = getSourceDatabase();
  if (!db)
    return NextResponse.json(
      { error: '请先绑定共享视频源数据库 SOURCE_DB' },
      { status: 503, headers }
    );
  try {
    if (Number(request.headers.get('Content-Length')) > 512000)
      throw new Error('配置过大');
    const text = await request.text();
    if (text.length > 512000) throw new Error('配置过大');
    const body = JSON.parse(text);
    const sources = normalizeSources(body.sources);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0)
      throw new Error('配置版本错误');
    if (!(await saveSourceSettings(db, sources, body.revision))) {
      return NextResponse.json(
        { error: '另一设备已更新配置，请重新加载后再保存' },
        { status: 409, headers }
      );
    }
    return NextResponse.json(
      { ok: true, revision: body.revision + 1 },
      { headers }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '保存配置失败' },
      { status: 400, headers }
    );
  }
}
