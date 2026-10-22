# 豆瓣海报修复与 Cloudflare Pages 部署

电影、剧集和综艺共用 `VideoCard`。原代码把豆瓣 CDN 地址直接交给浏览器，
`referrerPolicy="no-referrer"` 无法解决 CDN 对无 Referer 请求的拦截。

2026-10-22 实测同一张豆瓣海报：自定义域名 Referer 返回 403，无 Referer 返回
418，豆瓣 Referer 返回 200 JPEG。

现在 `processImageUrl` 默认把豆瓣海报改为同域 `/api/image?url=...`。
接口采用 Edge runtime，可随现有 Next.js 应用部署到 Cloudflare Pages，
由服务器带豆瓣 Referer 取回图片。无需新建 Worker、配置外部代理或更改自定义域名。
原有 `/api/image-proxy` 是独立的兼容接口，未被默认海报加载流程使用，本次保留不变。

自定义图片代理仍可使用；卡片在其失败后只重试一次内置接口。
旧浏览器中关闭自定义代理的设置不会关闭内置豆瓣海报处理。
其他图片来源保留现有行为。

接口只接收豆瓣图片 CDN 的公开海报路径；对每次重定向重新验证目标。
请求不转发访客 Cookie、Authorization 或本站 Referer。成功的图片响应缓存
一天（共享缓存七天），失败响应不缓存。超时为十秒，图片最大八 MiB。

## 验证

```sh
pnpm test --runInBand
pnpm typecheck
pnpm lint
pnpm build
```

回归测试覆盖电影、剧集和综艺卡片、旧自定义代理失败回退、URL 限制、重定向、
图片内容类型、响应大小和错误缓存。
本次还对三类页面各三张真实海报执行了处理函数请求与 JPEG 解码验证。
这不替代发布后在 Cloudflare 实例上的验证。

## 发布

在 Cloudflare Pages 的 `moontv` 项目中确认 Production branch 与 GitHub
收到修复的分支一致，沿用原有构建命令（仓库提供 `pnpm run pages:build`）
和输出目录 `.vercel/output/static`。保留现有密码、存储配置及域名绑定。

发布完成后，用该站点上的 `/api/image?url=` 加上 URL 编码的豆瓣海报地址验证：
应返回 200、`Content-Type: image/jpeg`（或其他支持的图片类型）和实际图片字节。
随后检查电影、剧集、综艺页面，图片请求应指向本站 `/api/image`，
而不是浏览器直连 `img*.doubanio.com`。
如果旧 PWA 页面仍显示缓存版本，关闭旧标签页后重新打开或更新站点 Service Worker。

回滚时使用 Cloudflare Pages 的上一个成功生产部署，或撤销本次修复提交。
