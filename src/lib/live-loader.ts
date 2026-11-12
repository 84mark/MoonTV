import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';
import { FetchLoader } from 'hls.js';

/** Observe active requests and retry root manifests: FetchLoader itself has no retry loop. */
export function createLiveLoader(options: {
  isActive: () => boolean;
  deadline: () => number;
  log: (message: string, error?: boolean) => void;
}) {
  return class LiveFetchLoader implements Loader<LoaderContext> {
    private transport: FetchLoader;
    private retryTimer?: ReturnType<typeof setTimeout>;
    private closed = false;
    constructor(private hlsConfig: HlsConfig) {
      this.transport = new FetchLoader(hlsConfig);
    }
    get context() {
      return this.transport.context;
    }
    get stats() {
      return this.transport.stats;
    }
    getCacheAge() {
      return this.transport.getCacheAge();
    }
    getResponseHeader(name: string) {
      return this.transport.getResponseHeader(name);
    }
    abort() {
      this.closed = true;
      clearTimeout(this.retryTimer);
      this.transport.abort();
    }
    destroy() {
      this.closed = true;
      clearTimeout(this.retryTimer);
      this.transport.destroy();
    }
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ) {
      let retries = 0;
      const active = () => !this.closed && options.isActive();
      const root =
        (context as LoaderContext & { type?: string }).type === 'manifest';
      const retry = (code: number, terminalUpstream = false) => {
        if (
          !active() ||
          !root ||
          terminalUpstream ||
          retries >= 2 ||
          !(code === 0 || code === 408 || code === 429 || code >= 500)
        )
          return false;
        const delay = Math.min(1500 * 2 ** retries, 4000);
        if (Date.now() + delay >= options.deadline()) return false;
        retries += 1;
        options.log(
          `临时连接故障，${
            delay / 1000
          } 秒后重新请求播放清单（重试 ${retries}/2）`,
          true
        );
        this.retryTimer = setTimeout(() => {
          if (!active()) return;
          this.transport.destroy();
          this.transport = new FetchLoader(this.hlsConfig);
          options.log(`正在重新请求播放清单（第 ${retries} 次重试）`);
          request();
        }, delay);
        return true;
      };
      const request = () =>
        this.transport.load(context, config, {
          ...callbacks,
          onError: (error, ctx, response: unknown, stats) => {
            if (!active()) return;
            options.log(
              `资源请求失败：${
                error.code ? `HTTP ${error.code}` : '网络连接失败或跨域限制'
              }${error.text ? ` · ${error.text}` : ''}`,
              true
            );
            const finish = (upstream = '') => {
              if (!active()) return;
              if (upstream) options.log(`源站返回：${upstream}`, true);
              // Do not retry a permanent upstream 4xx just because Worker wraps it in 502.
              const terminal =
                /Upstream HTTP 4\d\d/.test(upstream) &&
                !/Upstream HTTP (408|429)/.test(upstream);
              if (!retry(error.code, terminal))
                callbacks.onError(
                  {
                    ...error,
                    text: upstream ? `${error.text} · ${upstream}` : error.text,
                  },
                  ctx,
                  response,
                  stats
                );
            };
            // Read only the existing error response, never an additional diagnostic request.
            if (
              response instanceof Response &&
              response.headers.get('content-type')?.includes('application/json')
            ) {
              const reader = response.clone().body?.getReader();
              if (reader) {
                void reader
                  .read()
                  .then(({ value }) => {
                    let message = '';
                    try {
                      const body = JSON.parse(
                        new TextDecoder().decode(value?.slice(0, 4096))
                      );
                      if (typeof body.error === 'string') message = body.error;
                    } catch {
                      /* HTTP status still explains non-JSON/oversized errors. */
                    }
                    finish(message);
                  })
                  .catch(() => finish())
                  .finally(() => {
                    void reader.cancel().catch(() => undefined);
                  });
                return;
              }
            }
            finish();
          },
          onTimeout: (stats, ctx, response) => {
            if (!active()) return;
            options.log('资源请求超时，尚未收到完整响应', true);
            if (!retry(0)) callbacks.onTimeout(stats, ctx, response);
          },
        });
      request();
    }
  };
}
