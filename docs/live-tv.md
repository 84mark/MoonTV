# 电视直播

`/live` 共用站点登录、主题、Artplayer/HLS.js 及实时速度／缓存浮窗。
频道名后显示源数量；支持国际频道、高清卫视、收藏、最近观看、搜索与自定义 M3U。
电视导航置后。直播记录与影视点播独立。

## 目录策略

默认目录 `src/lib/live-world.json` 为经官方网页与公开目录交叉核对的精选候选：
DW、France24、NHK WORLD、Al Jazeera、Euronews、TRT World，及国内官方品牌域的高清卫视候选。
默认不再导入大批地方台或标清源。NASA 旧线性频道已停播，不把旧地址当稳定直播；NASA+等作为官网外链。
国际刷新仅允许各频道指定 tvg-id（保留语言后缀）及官方 CDN 白名单，排除匿名 restream 和明确低于 720p 线路。
源地址参考 iptv-org 的 CC0 列表，但官方页面存在、目录更新或 HTTP200 均不等于实际可播。

国内补充读取 gchust/iptv-daily 的 status/channels 报告：仅接受 48 小时内匹配的成功报告、
明确通过实际解码且有视频帧、无错误的大陆 HD 卫视，分辨率至少 1280×720 且为 HTTPS HLS。
HTTP、RTP/MPEG-TS、地方台、标清、过期或失败条目均不加入。没有合格条目就不虚构增加。
公开报告仅标“上游检测通过”(upstream-decode)，不能当本站／用户所在地实测。
当前精选 seed 仍是待测候选，不显示绿色已可播承诺。播放慢不等于源永久失效。

## 直连与转发

默认 auto 优先浏览器直连。仅当某个具体 URL 明确列入 relayRequired 时才自动 CF 转发。
超时、CORS 或解码错误不自动等同国内屏蔽；用户可以手动强制直连／兼容模式。
自定义导入永不通过本站转发。当前没有未经实测就预设的 relayRequired 线路。

兼容接口 `/api/live/stream` 只允许内置频道根入口，HLS 子资源必须有 URL/类型/有效期 HMAC 签名。
覆盖主/子清单、密钥、初始化段和视频分片；逐跳检查重定向与私网／保留字面地址。
不转发用户 Cookie 或 Authorization，不提供任意未签名 URL 代理；不能完全防止可信上游的 DNS 重绑定。
根入口登录验证沿用 middleware 与 PASSWORD，分片 token10 分钟、子清单 24 小时，清单 1MB、单资源 20 秒超时。
兼容模式会产生 Worker 分片请求，受 Cloudflare 请求额度限制，不承诺无限免费转发。
不能靠 CF 修复失效源站或保证绕过版权地域限制。

## 测速与浮窗

各源复用影视的实际媒体字节短采样、3 并发队列与缓存，单源采样 3.5 秒。
首次取得可测速度或确认解码即可启动，其余仅更新结果，不打断已播放线路。
支持跳过检测、强制重测和手动切源；短时未测得不标为永久失效。
实时浮窗每秒读取实际分片字节与 video.buffered，支持关闭、重开、常驻；不将预检流量计为播放速度。
原生 HLS 没有字节数据时不伪造速率。当前选源失败显示具体阶段与 HTTP 错误信息。

目录成功实例缓存 30 分钟，失败短缓存 60 秒；来源质量与用户地区网络仍需实测。
执行环境媒体域名未放行时，测试只证明代码链路／可控媒体，不能声称真实频道全部测通。

## 聚合 App 公开配置复核

另外核查了以下公开配置（不是直接照搬 App 可播结论）：

- https://github.com/Lightconer/TVBox-Sources/blob/main/output/live.m3u
- https://github.com/RaycornM/TVbox-IPTV/blob/main/Tivi.m3u
- https://github.com/jiusanzhou/tvbox/blob/main/shared/lives.json
- https://github.com/mytv-android/China-TV-Live-M3U8/blob/main/iptv.m3u

部分央视 HD 地址只有 HTTP/IP、运营商 RTP，或需 Referer、动态签名和同出口 IP；这些不满足本版 HTTPS 直连约束，
没有当作已验证网页直播默认加入。央视官方调度 API 的开源用法也已查到，但未经同出口/时效实测，不硬编码短期 URL。
