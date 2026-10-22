# 视频源核验记录（2026-10-22）

本次检查使用当前开发环境出口，结果不等于每个用户或 Cloudflare 地区的可用性。
基础检查验证 HTTP 和 MacCMS JSON `list`；搜索检查使用同一关键词“庆余年”。
HTTP 内置地址采用 HTTPS 再测。未下载或判断所有影片可播放，未因单次失败删除任何源。

| 来源 | 名称 | 检测地址 | 接口 HTTP | JSON 列表有效 | 搜索列表有效 |
|---|---|---|---|---|---|
| builtin | 电影天堂资源 | https://caiji.dyttzyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 黑木耳 | https://json.heimuer.xyz/api.php/provide/vod | 302 | 未确认 | 未确认 |
| builtin | 如意资源 | https://cj.rycjapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 暴风资源 | https://bfzyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 天涯资源 | https://tyyszy.com/api.php/provide/vod | 200 | 是 | 未确认 |
| builtin | 非凡影视 | https://ffzy5.tv/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 360资源 | https://360zy.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 茅台资源 | https://caiji.maotaizy.cc/api.php/provide/vod | 200 | 是 | 未确认 |
| builtin | 卧龙资源 | https://wolongzyw.com/api.php/provide/vod | 200 | 未确认 | 未确认 |
| builtin | 极速资源 | https://jszyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 豆瓣资源 | https://dbzy.tv/api.php/provide/vod | 200 | 是 | 未确认 |
| builtin | 魔爪资源 | https://mozhuazy.com/api.php/provide/vod | 503 | 未确认 | 未确认 |
| builtin | 魔都资源 | https://www.mdzyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 最大资源 | https://api.zuidapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 樱花资源 | https://m3u8.apiyhzy.com/api.php/provide/vod | 200 | 是 | 未确认 |
| builtin | 无尽资源 | https://api.wujinapi.me/api.php/provide/vod | 200 | 是 | 未确认 |
| builtin | 旺旺短剧 | https://wwzy.tv/api.php/provide/vod | 301 | 未确认 | 未确认 |
| builtin | iKun资源 | https://ikunzyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 量子资源站 | https://cj.lziapi.com/api.php/provide/vod | 200 | 是 | 是 |
| builtin | 小猫咪资源 | https://zy.xmm.hk/api.php/provide/vod | 000 | 未确认 | 未确认 |
| candidate | 爱奇艺资源 | https://iqiyizyapi.com/api.php/provide/vod | 503 | 未确认 | 未确认 |
| candidate | 豆瓣资源 | https://caiji.dbzy5.com/api.php/provide/vod | 200 | 是 | 未确认 |
| candidate | 猫眼资源 | https://api.maoyanapi.top/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 非凡资源 | https://api.ffzyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 速播资源 | https://subocaiji.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | U酷影视 | https://api.ukuapi88.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 如意资源 | https://cj.rycjapi.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 豪华资源 | https://hhzyapi.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 量子资源 | https://cj.lzcaiji.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 360 资源 | https://360zyzz.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 新浪资源 | https://api.xinlangapi.com/xinlangapi.php/provide/vod | 200 | 是 | 是 |
| candidate | 金鹰点播 | https://jyzyapi.com/provide/vod/from/jinyingyun/at/json | 200 | 是 | 是 |
| candidate | 飘零资源 | https://p2100.net/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 光速资源 | https://api.guangsuapi.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 红牛资源 | https://www.hongniuzy2.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 魔都动漫 | https://caiji.moduapi.cc/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 百度云zy | https://api.apibdzy.com/api.php/provide/vod | 200 | 是 | 是 |
| candidate | 艾旦影视 | https://pz.v88.qzz.io/?url=https://lovedan.net/api.php/provide/vod | 404 | 未确认 | 未确认 |

GitHub 发现来源：

- https://github.com/dxs1256/MoonTV-api （定时检测报告及健康源订阅）
- https://github.com/shijianus/moontv-source （分类源列表）

共核验 38 个不同 API，31 个基础 JSON 检查通过。内置源 15/20 通过；其余包含重定向、防护和出口限制，不能一概判死。
导入第三方列表需管理员预览并明确保存，默认不会自动安装或移除任何视频源。
