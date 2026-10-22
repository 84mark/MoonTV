import { firstMeasuredSource, speedKBps } from './source-selection';
import type { SearchResult } from './types';
import type { VideoProbeResult } from './video-probe';
import { getVideoResolutionFromM3u8 } from './video-probe';

export interface PlaybackPreparationState {
  status: 'searching' | 'testing' | 'complete' | 'error';
  sources: SearchResult[];
  results: Map<string, VideoProbeResult>;
  firstSource: SearchResult | null;
  selected: SearchResult | null;
  completed: number;
}
export interface PlaybackPreparation {
  id: string;
  createdAt: number;
  snapshot: PlaybackPreparationState;
  subscribe: (
    listener: (state: PlaybackPreparationState) => void
  ) => () => void;
}
const sessions = new Map<string, PlaybackPreparation>();
let sequence = 0;
const key = (source: SearchResult) => `${source.source}-${source.id}`;
const normalized = (title: string) => title.replaceAll(' ', '').toLowerCase();

export function getPreparedPlayback(
  id: string | null
): PlaybackPreparation | null {
  const session = id ? sessions.get(id) : undefined;
  if (!session || Date.now() - session.createdAt > 5 * 60 * 1000) {
    if (id) sessions.delete(id);
    return null;
  }
  return session;
}

export function preparePlayback(
  query: string,
  force = false
): PlaybackPreparation {
  const listeners = new Set<(state: PlaybackPreparationState) => void>();
  const session: PlaybackPreparation = {
    id: `${Date.now().toString(36)}-${++sequence}`,
    createdAt: Date.now(),
    snapshot: {
      status: 'searching',
      sources: [],
      results: new Map(),
      firstSource: null,
      selected: null,
      completed: 0,
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  while (sessions.size >= 8)
    sessions.delete(sessions.keys().next().value as string);
  sessions.set(session.id, session);
  const publish = (state: PlaybackPreparationState) => {
    session.snapshot = state;
    listeners.forEach((listener) => listener(state));
  };
  void (async () => {
    const params = new URLSearchParams(query);
    const title = params.get('title') || '';
    const search = params.get('stitle') || title;
    const year = params.get('year') || '';
    const type = params.get('stype') || '';
    let sources: SearchResult[] = [];
    let failed = false;
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(search.trim())}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      if (!Array.isArray(data.results)) throw new Error('Invalid results');
      sources = (data.results as SearchResult[]).filter(
        (source) =>
          typeof source.title === 'string' &&
          Array.isArray(source.episodes) &&
          source.episodes.length > 0 &&
          normalized(source.title) === normalized(title) &&
          (!year || source.year === year) &&
          (!type ||
            (type === 'movie'
              ? source.episodes.length === 1
              : source.episodes.length > 1))
      );
    } catch {
      failed = true;
    }
    const sourceCode = params.get('source');
    const sourceId = params.get('id');
    if (
      sourceCode &&
      sourceId &&
      !sources.some(
        (source) => source.source === sourceCode && source.id === sourceId
      )
    ) {
      try {
        const response = await fetch(
          `/api/detail?${new URLSearchParams({
            source: sourceCode,
            id: sourceId,
          })}`,
          { cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Detail failed');
        const source: SearchResult = await response.json();
        if (!Array.isArray(source.episodes) || !source.episodes.length)
          throw new Error('No episodes');
        sources.push(source);
      } catch {
        failed = true;
      }
    }
    sources = Array.from(
      new Map(sources.map((source) => [key(source), source])).values()
    );
    publish({
      ...session.snapshot,
      sources,
      status: sources.length ? 'testing' : failed ? 'error' : 'complete',
    });
    if (!sources.length) return;
    await firstMeasuredSource(
      sources,
      (url) => getVideoResolutionFromM3u8(url, { force }),
      (source, result) => {
        const previous = session.snapshot;
        const results = new Map(previous.results).set(key(source), result);
        const firstSource =
          previous.firstSource ||
          (speedKBps(result.loadSpeed) > 0 ? source : null);
        const complete = results.size === sources.length;
        const ranked = [...sources]
          .filter((item) => speedKBps(results.get(key(item))?.loadSpeed) > 0)
          .sort(
            (a, b) =>
              speedKBps(results.get(key(b))?.loadSpeed) -
              speedKBps(results.get(key(a))?.loadSpeed)
          );
        publish({
          status: complete ? 'complete' : 'testing',
          sources,
          results,
          firstSource,
          selected: complete ? ranked[0] || null : firstSource,
          completed: results.size,
        });
      }
    );
  })().catch(() => publish({ ...session.snapshot, status: 'error' }));
  return session;
}
