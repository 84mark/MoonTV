# 电视直播

`/live` 共用站点登录、主题、Artplayer/HLS.js 及实时速度／缓存浮窗。
频道名后显示源数量；分为国内频道和海外频道，支持收藏、最近观看、搜索与自定义 M3U；购物频道在内置、上游报告和导入结果中统一过滤。
桌面布局为左侧固定宽度频道栏、右侧播放器，频道列表独立滚动；手机播放器优先，频道列表在下方。切换分类和搜索不打断当前频道。电视导航置后，直播记录与影视点播独立。

## 目录策略

默认目录 `src/lib/live-world.json` 为经官方网页与公开目录交叉核对的精选候选：
DW、France24、NHK WORLD、Al Jazeera、Euronews、TRT World，及国内官方品牌域的高清卫视候选。
国内种子优先保留官方品牌域 HTTPS HLS；包含 CGTN、宜昌、东莞、南宁、临沂、延安等近期上游检测快照。
国际刷新仅允许各频道指定 tvg-id（保留语言后缀）及官方 CDN 白名单，排除匿名 restream 和明确低于 720p 线路。
源地址参考 iptv-org 的公开列表，但官方页面存在、目录更新或 HTTP200 均不等于实际可播。

国内补充读取 gchust/iptv-daily 的 status/channels 报告：仅接受 48 小时内匹配的成功报告、明确通过实际解码且有视频帧、无错误的国内央视、卫视与地方台 HLS。接受可用标清，HTTP 源须通过兼容转发；RTP/UDP、非 HLS、购物频道及无有效检测证据条目不加入。
2026-11-10 报告在本版过滤下得到 73 个国内频道，其中 24 个具有 HTTPS URL，49 个仅 HTTP；这不是本站播放成功计数。目录会随上游更新变化。
公开报告仅标“上游检测通过”(upstream-decode)，不能当本站／用户所在地实测。48 小时后种子检测标记降级为待重测。

## 指定订阅

接入 [best-fan/cn_all.m3u8](https://raw.githubusercontent.com/best-fan/iptv-sources/main/cn_all.m3u8)，动态拉取并与已有频道按名称合并，保留多个备用线路、收藏与最近观看对应的稳定 ID。过滤购物频道、非 HLS 和私网／保留地址。凤凰频道归海外组，国内 HTTPS 优先，HTTP 走既有兼容转发。

2026-11-10 读取到 199 条线路（12 HTTPS、187 HTTP），合并为 52 个频道（50 国内、2 海外）。这是订阅目录数量，不是实测可播放数量。订阅线路不继承已有线路的解码检测结论；混合频道显示待实测。

完整目录成功缓存 30 分钟；订阅成功但其他目录失败时 5 分钟刷新；订阅失败时 60 秒后重试，并保留当前实例中上次成功结果；首次启动有本次解析的 52 频道快照备用，显示真实快照获取时间和 fallback 状态。API 独立返回订阅更新时间和频道数量，UI 不会把其他目录失败误报为订阅同步失败。

## 直连与转发

默认 auto：国内 HTTPS 浏览器直连优先，海外内置频道默认 Cloudflare 转发；国内 HTTP 因 HTTPS 页面的混合内容限制走 CF 兼容转发，不伪称国内流量。直连失败先尝试同源 CF，再尝试下一线路。
用户可手动强制直连／兼容转发；实际使用路径在播放器旁显示。自定义导入永不通过本站转发，当前仅支持 HTTPS。
国内/海外是频道分组和默认路由策略，不代表已检测用户所在地屏蔽状态。开着 VPN 时，浏览器直连最终走国内还是代理由用户设备的分流规则决定。

兼容接口 `/api/live/stream` 只允许内置频道根入口，HLS 子资源必须有 URL/类型/有效期 HMAC 签名。
覆盖主/子清单、密钥、初始化段和视频分片；逐跳检查重定向与私网／保留字面地址。
不转发用户 Cookie 或 Authorization，不提供任意未签名 URL 代理；不能完全防止可信上游的 DNS 重绑定。
根入口登录验证沿用 middleware 与 PASSWORD，分片 token10 分钟、子清单 24 小时，清单 1MB、单资源 20 秒超时。
兼容模式会产生 Worker 分片请求，受 Cloudflare 请求额度限制，不承诺无限免费转发。
不能靠 CF 修复失效源站或保证绕过版权地域限制。

## 测速与浮窗

各源复用影视的实际媒体字节短采样、3 并发队列与缓存，单源采样 3.5 秒。
第一条线路立即开始播放，多源测速后台进行，后续结果只更新提示，不打断已开始的线路。首帧等待直连 8 秒、Cloudflare 12 秒，已播放后的缓冲恢复上限 20 秒；首次重复 waiting 事件不会延长首帧期限。
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

部分央视 HD 地址只有 HTTP/IP、运营商 RTP，或需 Referer、动态签名和同出口 IP；这些不满足浏览器直接播放条件；只有经有效检测报告确认的公开 HTTP HLS 才加入兼容转发，其余不作为已验证网页直播加入。央视官方调度 API 的开源用法也已查到，但未经同出口/时效实测，不硬编码短期 URL。

## 本次验证

使用本地生成的 H.264/AAC HLS 媒体在 Chromium 实际解码：国内直连、海外转发、国内直连 503 后同源转发均能播放，且购物频道不显示。此验证只覆盖播放器及路由链路；执行环境媒体域名网络策略阻止真实频道探测，仍需在用户电信网络及实际 Cloudflare 出口验证频道可用性。

## 用户补充列表核验

额外核对 [fanmingming/live](https://github.com/fanmingming/live)、[Free-TV/IPTV](https://github.com/Free-TV/IPTV)、[best-fan/iptv-sources](https://github.com/best-fan/iptv-sources)、[imDazui/Tvlist-awesome-m3u-m3u8](https://github.com/imDazui/Tvlist-awesome-m3u-m3u8)。前两者只补充名称和品牌域核对过的 HTTPS 候选，并标记未实测；不会整表导入移动 IPv6、联通鉴权、运营商组播或错标条目。iptv-org 国内列表和 imDazui 国内选表已由 daily 上游聚合并检测。
