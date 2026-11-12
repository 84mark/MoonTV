# 独立直播代理 Worker

该 Worker 只处理需要转发的当前直播流，分片以 `ReadableStream` 转发，不下载整段视频到内存、不缓存视频、不拉取或解析全量频道目录。直接可播的 HTTPS 频道不使用它。

参考项目：[MHSanaei/HLS-Proxy-Worker](https://github.com/MHSanaei/HLS-Proxy-Worker)。该项目当前示例只将播放列表中的相对地址改为绝对地址；这里另外代理主／子列表、音轨、加密 KEY、初始化 MAP 和分片，以覆盖 HTTP 混合内容与 CORS。

## 接口和配置

- `GET /health`：部署检查，返回是否配置密钥；不返回密钥。
- `GET /stream?token=...`：已签名播放请求；不接受任意 `url` 或自定义请求头。
- `OPTIONS /stream`：允许的站点跨域预检。
- Worker Secret `LIVE_PROXY_SECRET`：至少 32 个字符，与 Pages 中的同名密钥完全一致。
- Worker Variable `ALLOWED_ORIGINS`：逗号分隔的前端 origin，默认 `https://tv.markoo.cn`。
- Pages 的代理 URL 配置应使用这个 Worker 的 HTTPS origin，不能含令牌或密钥。

票据使用 `base64url(JSON).base64url(HMAC-SHA256(payloadBase64))`，字段为：

```ts
{ url: string, playlist: boolean, expires: number, referer?: string, userAgent?: string }
```

`expires` 为 Unix 毫秒，根播放票据建议 4 小时，最大 24 小时。Pages 可直接导入 `workers/live-proxy/token.ts` 的 `signProxyToken`；鉴权端点必须验证请求来自已登录用户，且 URL／Referer／User-Agent 来自已认可的订阅条目。浏览器不得获取共享密钥。

Worker 为子资源签发新票据，但所有票据均不超过根会话的到期时间；分片票据最多 10 分钟。播放会话到期后前端应重新申请根票据并连接。不能把带票据的播放 URL 用作长期公开订阅。

只从票据读取 Referer，并由它生成源站 Origin；可选 User-Agent 也必须已签名，最多 512 字符且拒绝控制字符，向子列表和分片继续传递；不向上游传递用户 Cookie 或 Authorization。保留有效的单段 Range。逐跳拒绝私网／保留字面地址及非 HTTP(S)，最多 4 次重定向。与一般域名代理一样，无法完全证明可信上游 DNS 不会重绑定；签名端点的站点认证和地址验证仍然必要。CORS 不是认证，签名才是请求授权。

## 部署

在本仓库根目录运行；不要将密钥写入 wrangler.toml 或提交到 Git。

```sh
npx wrangler@4 secret put LIVE_PROXY_SECRET --config workers/live-proxy/wrangler.toml
npx wrangler@4 deploy --config workers/live-proxy/wrangler.toml
```

命令使用环境中的 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`，或 Wrangler 的已登录身份。Token 需要目标账号的 Workers Scripts 编辑权限。将输出的 `https://moontv-live-proxy.<account>.workers.dev` 地址配置到 Pages，再在 Pages 设置同名共享密钥并重新部署前端。

生产域名变化时同步更新 `ALLOWED_ORIGINS`。本地测试可使用 `wrangler dev`，通过未提交的 `workers/live-proxy/.dev.vars` 设置测试密钥，并覆盖允许的本地 origin。

## 自动发布

可在 Cloudflare Workers 的 Git 集成中连接同一仓库，构建根目录为仓库根目录，部署命令设为：

```sh
npx wrangler@4 deploy --config workers/live-proxy/wrangler.toml
```

将 `LIVE_PROXY_SECRET` 设置为该 Worker 的 Secret，`ALLOWED_ORIGINS` 设置为变量。Pages 与 Worker 是两个独立部署目标；前端部署成功不能代表 Worker 已部署。确认 Worker 的 `/health` 和真实播放请求后，再判断独立代理是否正常运行。

## 检查

```sh
node_modules/.bin/jest workers/live-proxy/index.test.ts --runInBand
curl https://<worker-host>/health
```

自动测试覆盖签名篡改／过期、CORS、HTTP 分片重写、音轨／KEY／MAP、Range 二进制转发、源站请求头隔离、重定向私网拦截和清单大小限制。清单最大 1 MiB，源站请求超时 20 秒。Worker 只在播放需要转发的线路时消耗分片请求；实际配额和 CPU 限制以 Cloudflare 当前账号套餐为准。
