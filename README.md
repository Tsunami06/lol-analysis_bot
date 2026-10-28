# lol-daily-bot

每天中午 12:00，把昨天群友的开黑战报发到微信群。

## 它现在是什么

一个跑在 Windows 常开机器上的小服务：

```
英雄联盟客户端（国服，专用小号常驻登录）
        │  LCU 本地接口（只读）
        ▼
   Node 服务 ── 12:00 触发 ── 拉昨日对局 ── 评分/称号 ── 生成战报文本
        │
        ▼
   PowerShell 驱动微信桌面端（专用微信号，群成员之一）
        │
        ▼
     开黑群
```

- **数据**：LCU 本地接口，不需要 Riot API Key，不覆盖国服以外的问题也不存在
- **发送**：UI 自动化（模拟搜索群、粘贴、回车），不注入进程、不碰协议
- **身份**：一个专用微信号，长期在线，在群里就是一个普通成员

## 先澄清：没有"微信群机器人 API"

个人微信没有官方群机器人接口；企业微信的群机器人[只支持内部群，不支持外部群](https://open.work.weixin.qq.com/help2/pc/14931)；客户群 API 需要成员手动确认且有频次限制。

所以"bot 进群"只有一条现实路径：**专用微信号 + 桌面自动化**。这也是本项目采用的方式。hook / 协议注入类方案（WeChatFerry 等）封号风险高且锁死微信版本，不推荐。

## 一次性准备

1. **一台常开的 Windows 机器**，能同时挂英雄联盟客户端和微信
2. **Node.js 20+**（`node -v` 能输出即可），不需要 `npm install`
3. **专用微信号**登录微信，主窗口保持打开（最小化到托盘会找不到窗口）
4. **英雄联盟客户端**已登录（WeGame 启动）
5. 配置：

```bat
copy config\players.example.json config\players.json
copy config\config.example.json  config\config.json
```

`players.json` 填 5 个人：

```json
[
  { "nickname": "老王", "summoner": "游戏名#12345" }
]
```

`config.json` 至少改这三项：

```json
{
  "group": "你们群的真实群名",
  "schedule": "12:00",
  "tone": 3
}
```

## 跑起来

按顺序验证，别一上来就 daemon：

```bat
:: 1. 客户端连通 + 玩家解析
npm run probe

:: 2. 只生成、不发送，看战报文本
npm run dry

:: 3. 手动发一条，确认微信自动化可用（先建一个测试群）
powershell -NoProfile -ExecutionPolicy Bypass -File sidecar\send-wechat.ps1 -Group "测试群" -TextFile 任意文本文件.txt

:: 4. 真发一次
node src\index.mjs once --force

:: 5. 常驻
start-bot.cmd
```

`start-bot.cmd` 会以守护模式运行：每天到点执行，失败 10 分钟后重试（两小时内有效），重启后会补发当天没发的。

## 战报长这样

```
【10月27日 开黑战报】
昨日 2 局 · 1 胜 1 负 · 胜率 50%

▍峡谷五黑 · 1 局 1 胜
  10-27 13:05 · 胜 · 31:40
    🔥 阿杰 · 劫 · 8/2/11 · 伤害 24.5k(21%) · 参团 57% · 评分 67
    👍 大刘 · 阿卡丽 · 9/3/12 · 伤害 26.0k(23%) · 参团 60% · 评分 65
    😐 小张 · 锐雯 · 7/4/10 · 伤害 23.0k(20%) · 参团 49% · 评分 42
    💀 老王 · 阿狸 · 5/2/8 · 伤害 20.0k(17%) · 参团 37% · 评分 38

▍大乱斗 · 1 局 0 胜
  10-27 22:10 · 负 · 21:40
    🔥 阿杰 · 劫 · 8/2/11 · 伤害 24.5k(21%) · 承伤 20.7k · 评分 67
       强化：巨人杀手 / 珠光护手 / 虚幻武器 +1
    ...

🏅 今日大腿：阿杰（均分 67，伤害占比 21%）
💀 今日战犯：老王（均分 38）
🩸 送财童子：小张（场均 4.0 死）
✨ 名场面：阿杰 五杀 · 老王 一血 · 大刘 单局最高伤害 26k

一句话：阿杰 在 C，老王 在逛街。
```

评分是**同局 5 人内的 z-score**（KDA、伤害占比、参团、死亡、经济加权），不是绝对值，所以辅助不会天然吃亏。`tone` 控制最后那句的语气：1 温和、3 阴阳、5 嘴臭。

战报里用到的 LCU 字段（都来自一次 match-history 请求）：

| 展示项 | 字段 |
|---|---|
| KDA / 胜负 | `kills` `deaths` `assists` `win` |
| 伤害占比 | `totalDamageDealtToChampions` / 队伍合计 |
| 参团率 | `(kills+assists)` / 队伍总击杀 |
| 承伤 | `totalDamageTaken` |
| 海克斯强化 | `playerAugment1`–`playerAugment6`（客户端 `cherry-augments.json` 映射名称） |
| 名场面 | `pentaKills` `quadraKills` `firstBloodKill` |
| 官方评分（已采集，暂未展示） | `totalPlayerScore` |

## 配置项

| 键 | 说明 | 默认 |
|---|---|---|
| `group` | 微信群名，必须完全一致 | 开黑群 |
| `schedule` | 每天发送时间 `HH:MM` | 12:00 |
| `tone` | 文案尺度 1–5 | 3 |
| `sendMode` | `wechat` 真发 / `dry-run` 只打印 | wechat |
| `wechatDelayMs` | 粘贴后等待，机器慢就调大 | 600 |
| `playersFile` | 玩家配置路径 | config/players.json |
| `count` | 每人回溯多少场 | 100 |
| `deepScan` | 找不到客户端时全盘扫描 | false |
| `lockfile` / `lcuPort` / `lcuToken` | 手动指定客户端连接 | null |

## 命令

| 命令 | 作用 |
|---|---|
| `npm run probe` | 只检查客户端、玩家、配置 |
| `npm run dry` | 生成战报并打印，不发送 |
| `npm run once` | 生成并发送（当天已发过会跳过） |
| `npm run daemon` | 常驻定时 |
| `node src\index.mjs once --date 2026-10-27` | 指定某天 |
| `node src\index.mjs once --force` | 强制重发 |

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 找不到英雄联盟客户端 | 没登录/装得偏 | `npm run probe`，必要时配 `lockfile` 或开 `deepScan` |
| 查无此人 | 名字缺 `#编号` | 客户端资料页复制完整名字 |
| 微信发送失败，退出码 1 | 微信收进托盘 / 没登录 / 群名不对 | 打开主窗口；用 `-Mock` 先验证；群名完全一致 |
| 消息发到别的窗口 | 搜索后焦点不对 | 调大 `wechatDelayMs`；发送时别动这台机器 |
| 昨天 0 局 | 当天没打 / 战绩同步延迟 | `--date` 换一天验证 |

## 风险与边界

- 桌面自动化不是官方接口，属于灰色地带；**只用小号、每天一条、不要高频**
- 发送时机器不能锁屏，窗口需要能切到前台
- 微信大版本升级可能改变交互，需要重新校准（`after_*` 延时、窗口查找）
- 群成员最好知情

## P0 脚本

`scripts/p0-lcu-spike.mjs` 是最早的数据通路验证工具，仍然保留：

```bat
node scripts\p0-lcu-spike.mjs --date 2026-10-27
```

它会打印队列号分布，用来确认「海克斯大乱斗」的 `queueId`。该模式已确认为 `queueId 2400` / `gameMode KIWI`（依据 Akari 的国服抓包数据），`src/analyze.mjs` 已内置。

`tests/mock-lcu-server.mjs` 是假客户端，本地回归用。
