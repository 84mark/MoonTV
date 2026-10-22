'use client';

import { Suspense, useEffect, useRef, useState } from 'react';

import type { SourceHealth } from '@/lib/source-network';
import {
  mergeSources,
  normalizeSources,
  parseSourceImport,
  SOURCE_CATALOGS,
  VideoSource,
} from '@/lib/sources';

import PageLayout from '@/components/PageLayout';

interface SourceData {
  sources: VideoSource[];
  defaults: VideoSource[];
  revision: number;
  configured: boolean;
  canManage: boolean;
  sharedPasswordAccess: boolean;
  updatedAt: string | null;
}

const emptySource: VideoSource = { key: '', name: '', api: '', from: 'custom' };
const inputClass =
  'w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2';
const buttonClass =
  'rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm disabled:opacity-40';

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

function SourcesPageClient() {
  const [data, setData] = useState<SourceData | null>(null);
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<VideoSource>(emptySource);
  const [importText, setImportText] = useState('');
  const [importUrl, setImportUrl] = useState(SOURCE_CATALOGS[0].url);
  const [pending, setPending] = useState<VideoSource[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [health, setHealth] = useState<Record<string, SourceHealth>>({});
  const [checking, setChecking] = useState(false);
  const checkController = useRef<AbortController | null>(null);
  useEffect(() => () => checkController.current?.abort(), []);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const result: SourceData = await requestJson('/api/sources');
      setData(result);
      setSources(result.sources);
      setRevision(result.revision);
      setDirty(false);
      setHealth({});
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const update = (next: VideoSource[]) => {
    setSources(next);
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const result = await requestJson('/api/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: normalizeSources(sources), revision }),
      });
      setRevision(result.revision);
      setDirty(false);
      setMessage(
        '已保存到共享数据库。所有设备的新搜索和播放请求将使用这份配置。'
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addOrEdit(event: React.FormEvent) {
    event.preventDefault();
    try {
      update(
        normalizeSources(
          editing
            ? sources.map((source) => (source.key === editing ? form : source))
            : [...sources, form]
        )
      );
      setEditing(null);
      setForm(emptySource);
      setMessage('已更新草稿，请保存到所有设备。');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function checkMany(list: VideoSource[]) {
    setChecking(true);
    const controller = new AbortController();
    checkController.current = controller;
    const queue = [...list];
    const worker = async () => {
      for (;;) {
        if (controller.signal.aborted) return;
        const source = queue.shift();
        if (!source) return;
        try {
          const result: SourceHealth = await requestJson('/api/sources/check', {
            signal: controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }),
          });
          setHealth((previous) => ({ ...previous, [source.key]: result }));
        } catch (error) {
          if (controller.signal.aborted) return;
          setHealth((previous) => ({
            ...previous,
            [source.key]: {
              status: 'unreachable',
              latencyMs: null,
              message: (error as Error).message,
            },
          }));
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, list.length) }, worker)
      );
    } finally {
      setChecking(false);
    }
  }

  async function importRemote() {
    setImporting(true);
    try {
      const result = await requestJson('/api/sources/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });
      setPending(result.sources);
      setMessage('订阅已读取，请预览后选择如何导入；尚未修改现有配置。');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function applyImport(replace: boolean) {
    if (!pending) return;
    try {
      update(
        replace ? normalizeSources(pending) : mergeSources(sources, pending)
      );
      setPending(null);
      setMessage('已导入草稿，请检查启用状态并保存到所有设备。');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function exportSources() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, sources }, null, 2)], {
        type: 'application/json',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'moontv-sources.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const writable = !!data?.canManage;
  return (
    <PageLayout activePath='/sources'>
      <div className='source-management mx-auto max-w-6xl px-4 py-16 space-y-6 text-gray-900 dark:text-gray-100'>
        <div>
          <h1 className='text-2xl font-bold'>视频源管理</h1>
          <p className='mt-2 text-sm text-gray-500'>
            电影、剧集和综艺页面的推荐信息来自豆瓣；搜索和播放地址来自下列
            MacCMS 采集接口，并非 MoonTV 自建视频数据库。
          </p>
        </div>
        {message && (
          <p
            role='status'
            className='rounded border border-orange-300 bg-orange-50 dark:bg-orange-950 p-3 text-sm'
          >
            {message}
          </p>
        )}
        {loading && <p>正在读取视频源…</p>}
        {data && !data.configured && (
          <p className='rounded border border-orange-300 p-3 text-sm'>
            共享数据库尚未绑定，当前仍使用内置源。请在 Cloudflare Pages 绑定
            SOURCE_DB
            并执行源配置迁移后重新加载。可先编辑和导出草稿，暂不能共享保存。
          </p>
        )}
        {data?.sharedPasswordAccess && (
          <p className='text-xs text-gray-500'>
            当前为共享密码登录，持有站点密码的用户均可管理视频源；播放记录和收藏仍保存在各自浏览器。
          </p>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          <button
            className={buttonClass}
            disabled={loading || saving}
            onClick={() => {
              if (!dirty || window.confirm('放弃未保存的草稿并重新加载？'))
                void load();
            }}
          >
            重新加载
          </button>
          <button
            className={buttonClass}
            onClick={exportSources}
            disabled={!data}
          >
            导出 JSON 备份
          </button>
          <button
            className={buttonClass}
            disabled={!writable || checking || !sources.length}
            onClick={() => void checkMany(sources)}
          >
            {checking ? '检测中…' : '检测所有接口'}
          </button>
          <button
            className='rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40'
            disabled={!writable || !data?.configured || !dirty || saving}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : '保存到所有设备'}
          </button>
          <span className='text-sm text-gray-500'>
            {sources.filter((source) => !source.disabled).length} /{' '}
            {sources.length} 个源启用{dirty ? ' · 有未保存修改' : ''}
          </span>
          {checking && (
            <button
              className={buttonClass}
              onClick={() => checkController.current?.abort()}
            >
              停止检测
            </button>
          )}
        </div>
        <p className='text-xs text-gray-500'>
          检测使用当前 Cloudflare 服务器请求采集接口并校验
          JSON。接口可访问不等于每部影片可播放；超时、防护或地区限制也不等于源永久失效，不会自动删除源。
        </p>

        <div className='glass-panel source-table overflow-x-auto'>
          <table className='w-full text-left text-sm'>
            <thead className='bg-gray-100 dark:bg-gray-800'>
              <tr>
                <th className='p-3'>启用</th>
                <th className='p-3'>视频源 / API</th>
                <th className='p-3'>接口检测</th>
                <th className='p-3'>操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr
                  key={source.key}
                  className='border-t border-gray-200 dark:border-gray-700'
                >
                  <td className='p-3'>
                    <input
                      type='checkbox'
                      aria-label={`启用 ${source.name}`}
                      checked={!source.disabled}
                      disabled={!writable || saving || checking}
                      onChange={(event) =>
                        update(
                          sources.map((item) =>
                            item.key === source.key
                              ? { ...item, disabled: !event.target.checked }
                              : item
                          )
                        )
                      }
                    />
                  </td>
                  <td className='p-3'>
                    <div className='font-medium'>
                      {source.name}{' '}
                      <span className='text-xs text-gray-500'>
                        {source.from === 'config' ? '内置' : '自定义'}
                      </span>
                    </div>
                    <div className='text-xs text-gray-500'>{source.key}</div>
                    <div className='mt-1 max-w-md break-all text-xs'>
                      {source.api}
                    </div>
                  </td>
                  <td className='p-3 max-w-xs'>
                    {health[source.key] ? (
                      <>
                        <div
                          className={
                            health[source.key].status === 'ok'
                              ? 'text-blue-600'
                              : 'text-orange-600'
                          }
                        >
                          {health[source.key].message}
                        </div>
                        {health[source.key].latencyMs !== null && (
                          <div className='text-xs text-gray-500'>
                            接口响应 {health[source.key].latencyMs} ms
                          </div>
                        )}
                      </>
                    ) : (
                      <span className='text-gray-500'>未检测</span>
                    )}
                  </td>
                  <td className='p-3'>
                    <div className='flex flex-wrap gap-2'>
                      <button
                        className={buttonClass}
                        disabled={!writable || checking}
                        onClick={() => void checkMany([source])}
                      >
                        检测
                      </button>
                      <button
                        className={buttonClass}
                        disabled={!writable || saving || checking}
                        onClick={() => {
                          setEditing(source.key);
                          setForm({ ...source });
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className={buttonClass}
                        disabled={!writable || saving || checking}
                        onClick={() => {
                          update(
                            sources.filter((item) => item.key !== source.key)
                          );
                          if (editing === source.key) {
                            setEditing(null);
                            setForm(emptySource);
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {writable && (
          <fieldset disabled={saving || checking} className='space-y-6'>
            <legend className='sr-only'>编辑共享视频源</legend>
            <form
              onSubmit={addOrEdit}
              className='glass-panel p-5 space-y-3'
            >
              <h2 className='font-semibold'>
                {editing ? '编辑视频源' : '添加视频源'}
              </h2>
              <div className='grid gap-3 md:grid-cols-2'>
                <label className='text-sm'>
                  源标识
                  <input
                    className={inputClass}
                    required
                    value={form.key}
                    disabled={!!editing}
                    placeholder='例如 my_source'
                    onChange={(event) =>
                      setForm({ ...form, key: event.target.value })
                    }
                  />
                </label>
                <label className='text-sm'>
                  名称
                  <input
                    className={inputClass}
                    required
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className='block text-sm'>
                采集 API 地址
                <input
                  className={inputClass}
                  required
                  type='url'
                  value={form.api}
                  placeholder='https://example.com/api.php/provide/vod'
                  onChange={(event) =>
                    setForm({ ...form, api: event.target.value })
                  }
                />
              </label>
              <details>
                <summary className='cursor-pointer text-sm'>
                  旧式详情页（可选）
                </summary>
                <label className='block text-sm mt-2'>
                  仅兼容旧源的 HTML 详情抓取，普通 JSON 源请留空
                  <input
                    className={inputClass}
                    value={form.detail || ''}
                    onChange={(event) =>
                      setForm({ ...form, detail: event.target.value })
                    }
                  />
                </label>
              </details>
              <div className='flex gap-2'>
                <button className={buttonClass} type='submit'>
                  {editing ? '更新草稿' : '添加到草稿'}
                </button>
                {editing && (
                  <button
                    className={buttonClass}
                    type='button'
                    onClick={() => {
                      setEditing(null);
                      setForm(emptySource);
                    }}
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </form>

            <section className='glass-panel p-5 space-y-3'>
              <h2 className='font-semibold'>从 GitHub 更新视频源</h2>
              <p className='text-sm text-gray-500'>
                以下是第三方维护的源列表，更新状态和地区可用性不由本站保证。读取后先预览、检测，再保存；不会后台自动替换你的配置。
              </p>
              {SOURCE_CATALOGS.map((catalog) => (
                <div
                  key={catalog.url}
                  className='flex flex-wrap items-center gap-2 text-sm'
                >
                  <a
                    className='text-blue-600 underline'
                    href={catalog.repository}
                    target='_blank'
                    rel='noreferrer'
                  >
                    {catalog.name}
                  </a>
                  <button
                    className={buttonClass}
                    onClick={() => setImportUrl(catalog.url)}
                  >
                    使用此订阅
                  </button>
                </div>
              ))}
              <label className='block text-sm'>
                原始 JSON 链接
                <input
                  className={inputClass}
                  value={importUrl}
                  onChange={(event) => setImportUrl(event.target.value)}
                />
              </label>
              <button
                className={buttonClass}
                disabled={importing}
                onClick={() => void importRemote()}
              >
                {importing ? '读取中…' : '读取并预览'}
              </button>
              <details>
                <summary className='cursor-pointer text-sm'>
                  粘贴或上传 JSON
                </summary>
                <div className='mt-3 space-y-2'>
                  <input
                    aria-label='上传源配置 JSON'
                    type='file'
                    accept='.json,application/json'
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (file.size > 1024 * 1024) {
                        setMessage('文件不能超过 1 MiB');
                        return;
                      }
                      setImportText(await file.text());
                    }}
                  />
                  <textarea
                    aria-label='源配置 JSON'
                    className={inputClass}
                    rows={5}
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                  />
                  <button
                    className={buttonClass}
                    onClick={() => {
                      try {
                        setPending(parseSourceImport(importText));
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    预览 JSON
                  </button>
                </div>
              </details>
              {pending && (
                <div className='rounded bg-gray-100 dark:bg-gray-800 p-3 space-y-2'>
                  <p>预览：{pending.length} 个源</p>
                  <ul className='max-h-48 overflow-auto text-xs space-y-1'>
                    {pending.map((source) => (
                      <li key={source.key}>
                        {source.name} · {source.api}
                      </li>
                    ))}
                  </ul>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      className={buttonClass}
                      onClick={() => applyImport(false)}
                    >
                      合并到草稿（保留现有开关）
                    </button>
                    <button
                      className={buttonClass}
                      onClick={() => {
                        if (
                          window.confirm(
                            '使用此列表替换当前草稿？保存后会影响所有设备。'
                          )
                        )
                          applyImport(true);
                      }}
                    >
                      用此列表替换草稿
                    </button>
                    <button
                      className={buttonClass}
                      onClick={() => setPending(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              <button
                className={buttonClass}
                disabled={!data}
                onClick={() => {
                  if (
                    data &&
                    window.confirm(
                      '恢复内置源到草稿？仍需保存后才会影响所有设备。'
                    )
                  )
                    update(data.defaults);
                }}
              >
                恢复内置列表到草稿
              </button>
            </section>
          </fieldset>
        )}
      </div>
    </PageLayout>
  );
}

export default function SourcesPage() {
  return (
    <Suspense fallback={<div className='p-8'>正在读取视频源…</div>}>
      <SourcesPageClient />
    </Suspense>
  );
}
