# LCU 对局数据字段全表

基于真实国服抓包（`2026-05-16-tencent-hn10`）逐字段提取，15 种队列各取一局核对。
数据来源：

- 列表：`/lol-match-history/v1/products/lol/{puuid}/matches`
- 单局：`/lol-match-history/v1/games/{gameId}`
- 时间线：`/lol-match-history/v1/game-timelines/{gameId}`

> 标记「实测为空」的字段在国服 15 局样本中恒为 0 或空对象，不要作为产品依据。

## 1. 层级结构

```
Game
├─ teams[2]                    队伍级
├─ participants[10]            玩家级（每人的 stats / timeline）
└─ participantIdentities[10]   participantId ↔ 玩家身份
GameTimeline
└─ frames[]                    每 60 秒一帧
   ├─ participantFrames[1..10] 经济/等级/补刀/坐标
   └─ events[]                 击杀/建筑/史诗野怪
```

## 2. Game（单局，16 字段）

| 字段 | 类型 | 含义 |
|---|---|---|
| `gameId` | number | 对局 ID，跨玩家合并的唯一键 |
| `gameCreation` | number | 开局时间，Unix 毫秒 |
| `gameCreationDate` | string | 开局时间，ISO 8601 |
| `gameDuration` | number | 时长（秒） |
| `gameMode` | string | `CLASSIC` / `ARAM` / `KIWI`(海克斯大乱斗) / `CHERRY`(斗魂竞技场) / `BRAWL` / `URF` / `SWIFTPLAY` 等 |
| `gameModeMutators` | string[] | 模式变体，如 `["mapskin_map12_bloom"]` |
| `gameType` | string | `MATCHED_GAME` / `CUSTOM_GAME` |
| `gameVersion` | string | 客户端版本，如 `16.10.776.5552` |
| `mapId` | number | 11 召唤师峡谷 / 12 极地大乱斗 / 30 斗魂竞技场 / 35 斗魂竞技场(2v2) |
| `platformId` | string | 大区，如 `HN10` |
| `queueId` | number | 队列 ID，如 420/440/450/2400 |
| `seasonId` | number | 赛季 ID（实测 0） |
| `endOfGameResult` | string | `GameComplete` 等 |
| `teams` | Team[2] | 队伍数据 |
| `participants` | Participant[10] | 玩家数据 |
| `participantIdentities` | ParticipantIdentity[10] | 玩家身份 |

## 3. Team（每队，16 字段）

| 字段 | 类型 | 含义 |
|---|---|---|
| `teamId` | number | 100 / 200 |
| `win` | string | `Win` / `Fail` |
| `bans` | {championId, pickTurn}[] | 5 个 ban，`championId=-1` 表示空 ban |
| `baronKills` | number | 大龙击杀 |
| `dragonKills` | number | 小龙击杀 |
| `riftHeraldKills` | number | 峡谷先锋 |
| `hordeKills` | number | 虚空巢虫 |
| `vilemawKills` | number | 蜘蛛（旧地图，基本 0） |
| `towerKills` | number | 推塔数 |
| `inhibitorKills` | number | 推水晶数 |
| `firstBlood` | boolean | 一血 |
| `firstTower` | boolean | 一塔 |
| `firstInhibitor` | boolean | 一水晶 |
| `firstBaron` | boolean | 首条大龙 |
| `firstDargon` | boolean | 首条小龙（原文拼写错误，就是 dragon） |
| `dominionVictoryScore` | number | 统治战场遗留，恒 0 |

## 4. Participant（每人，8 字段）

| 字段 | 类型 | 含义 |
|---|---|---|
| `participantId` | number | 1–10（斗魂竞技场可到 18） |
| `teamId` | number | 100 / 200（斗魂为子队） |
| `championId` | number | 英雄 ID |
| `spell1Id` / `spell2Id` | number | 召唤师技能 ID |
| `highestAchievedSeasonTier` | string | 历史最高段位（旧字段，常空） |
| `stats` | Stats | 118 个统计字段，见第 6 节 |
| `timeline` | object | 分路/位置 + 分钟增量，见第 5 节 |

## 5. Participant.timeline（每人，10 字段）

| 字段 | 类型 | 含义 |
|---|---|---|
| `participantId` | number | 对应 participantId |
| `lane` | string | `TOP` / `JUNGLE` / `MIDDLE` / `BOTTOM` / `NONE` |
| `role` | string | `SOLO` / `DUO` / `SUPPORT` / `NONE` |
| `creepsPerMinDeltas` | object | 补刀/分钟增量 —— **实测为空** |
| `csDiffPerMinDeltas` | object | 补刀差增量 —— **实测为空** |
| `goldPerMinDeltas` | object | 经济/分钟增量 —— **实测为空** |
| `xpPerMinDeltas` | object | 经验/分钟增量 —— **实测为空** |
| `xpDiffPerMinDeltas` | object | 经验差增量 —— **实测为空** |
| `damageTakenPerMinDeltas` | object | 承伤/分钟增量 —— **实测为空** |
| `damageTakenDiffPerMinDeltas` | object | 承伤差增量 —— **实测为空** |

> 国服 LCU 不填这些 delta。要分钟级数据只能用 `/game-timelines/{gameId}`。

## 6. Stats（每人，118 字段）

### 6.1 基础与胜负（6）

| 字段 | 含义 |
|---|---|
| `kills` / `deaths` / `assists` | K / D / A |
| `champLevel` | 英雄等级 |
| `win` | 是否获胜 |
| `longestTimeSpentLiving` | 最长存活时间（秒） |

### 6.2 多杀与连杀（8）

| 字段 | 含义 |
|---|---|
| `doubleKills` / `tripleKills` / `quadraKills` / `pentaKills` | 双杀/三杀/四杀/五杀次数 |
| `largestMultiKill` | 最高连杀等级（1–5） |
| `killingSprees` | 连杀次数 |
| `largestKillingSpree` | 最大连杀数 |
| `unrealKills` | 特殊击杀（旧字段，基本 0） |

### 6.3 首杀/首塔参与（6）

| 字段 | 含义 |
|---|---|
| `firstBloodKill` / `firstBloodAssist` | 一血击杀 / 助攻 |
| `firstTowerKill` / `firstTowerAssist` | 一塔击杀 / 助攻 |
| `firstInhibitorKill` / `firstInhibitorAssist` | 一水晶击杀 / 助攻 |

### 6.4 伤害（10）

| 字段 | 含义 |
|---|---|
| `totalDamageDealtToChampions` | 对英雄总伤害 |
| `physicalDamageDealtToChampions` | 对英雄物理伤害 |
| `magicDamageDealtToChampions` | 对英雄魔法伤害 |
| `trueDamageDealtToChampions` | 对英雄真实伤害 |
| `totalDamageDealt` | 总输出（含小兵/野怪/建筑） |
| `physicalDamageDealt` / `magicDamageDealt` / `trueDamageDealt` | 分类型总输出 |
| `damageDealtToObjectives` | 对目标物伤害（龙/塔/水晶） |
| `damageDealtToTurrets` | 对防御塔伤害 |

### 6.5 承伤与减免（5）

| 字段 | 含义 |
|---|---|
| `totalDamageTaken` | 总承伤 |
| `physicalDamageTaken` / `magicalDamageTaken` / `trueDamageTaken` | 分类型承伤 |
| `damageSelfMitigated` | 自身减免伤害 |

### 6.6 经济与补刀（7）

| 字段 | 含义 |
|---|---|
| `goldEarned` | 获得金币 |
| `goldSpent` | 花费金币 |
| `totalMinionsKilled` | 总补刀（小兵） |
| `neutralMinionsKilled` | 野怪击杀 |
| `neutralMinionsKilledEnemyJungle` | 反野数量 |
| `neutralMinionsKilledTeamJungle` | 自家野区数量 |
| `roleBoundItem` | 角色绑定装备（如辅助装） |

### 6.7 装备（7）

| 字段 | 含义 |
|---|---|
| `item0`–`item5` | 6 个装备位 |
| `item6` | 饰品位 |

### 6.8 视野（5）

| 字段 | 含义 |
|---|---|
| `visionScore` | 视野分 |
| `wardsPlaced` | 插眼数 |
| `wardsKilled` | 排眼数 |
| `sightWardsBoughtInGame` | 黄眼购买 |
| `visionWardsBoughtInGame` | 真眼购买 |

### 6.9 符文（26）

| 字段 | 含义 |
|---|---|
| `perk0`–`perk5` | 6 个符文 ID |
| `perk0Var1`–`perk5Var3` | 每个符文的 3 个数值（共 18） |
| `perkPrimaryStyle` | 主系 |
| `perkSubStyle` | 副系 |

### 6.10 强化符文（6，海克斯大乱斗）

| 字段 | 含义 |
|---|---|
| `playerAugment1`–`playerAugment6` | 6 个强化 ID，0 为空位 |

### 6.11 控制与治疗（4）

| 字段 | 含义 |
|---|---|
| `timeCCingOthers` | 控制他人时长 |
| `totalTimeCrowdControlDealt` | 控制总时长 |
| `totalHeal` | 总治疗 |
| `totalUnitsHealed` | 治疗单位数 |

### 6.12 个人推塔/推水晶（2）

| 字段 | 含义 |
|---|---|
| `turretKills` | 个人推塔数 |
| `inhibitorKills` | 个人推水晶数 |

### 6.13 客户端评分（14，实测全 0）

| 字段 | 含义 |
|---|---|
| `playerScore0`–`playerScore9` | 客户端内部评分项（10 个） |
| `totalPlayerScore` / `totalScoreRank` | 总评分 / 排名 |
| `combatPlayerScore` / `objectivePlayerScore` | 战斗 / 目标评分 |

> 国服 LCU 这 14 个字段在 15 局样本里全部为 0。SGP 数据源可能有值。

### 6.14 投降与行为（8）

| 字段 | 含义 |
|---|---|
| `gameEndedInSurrender` | 是否投降结束 |
| `gameEndedInEarlySurrender` | 是否提前投降（15 分钟） |
| `teamEarlySurrendered` | 本队是否提前投降 |
| `earlySurrenderAccomplice` | 是否参与提前投降 |
| `causedEarlySurrender` | 是否导致提前投降 |
| `gameEndedInIGNBSurrender` | IGNB 投降标记 |
| `causedGameEndFromIGNBSurrender` | IGNB 结束标记 |
| `wasSevereTransgressor` | 严重违规标记 |

### 6.15 其他（4）

| 字段 | 含义 |
|---|---|
| `participantId` | 玩家 ID |
| `largestCriticalStrike` | 最大暴击伤害 |
| `playerSubteamId` | 斗魂竞技场子队 ID |
| `subteamPlacement` | 斗魂竞技场名次 |

### 6.16 字段名总表（118 个，抓包原始顺序）

```
assists  causedEarlySurrender  causedGameEndFromIGNBSurrender  champLevel  combatPlayerScore  damageDealtToObjectives  damageDealtToTurrets  damageSelfMitigated
deaths  doubleKills  earlySurrenderAccomplice  firstBloodAssist  firstBloodKill  firstInhibitorAssist  firstInhibitorKill  firstTowerAssist
firstTowerKill  gameEndedInEarlySurrender  gameEndedInIGNBSurrender  gameEndedInSurrender  goldEarned  goldSpent  inhibitorKills  item0
item1  item2  item3  item4  item5  item6  killingSprees  kills
largestCriticalStrike  largestKillingSpree  largestMultiKill  longestTimeSpentLiving  magicDamageDealt  magicDamageDealtToChampions  magicalDamageTaken  neutralMinionsKilled
neutralMinionsKilledEnemyJungle  neutralMinionsKilledTeamJungle  objectivePlayerScore  participantId  pentaKills  perk0  perk0Var1  perk0Var2
perk0Var3  perk1  perk1Var1  perk1Var2  perk1Var3  perk2  perk2Var1  perk2Var2
perk2Var3  perk3  perk3Var1  perk3Var2  perk3Var3  perk4  perk4Var1  perk4Var2
perk4Var3  perk5  perk5Var1  perk5Var2  perk5Var3  perkPrimaryStyle  perkSubStyle  physicalDamageDealt
physicalDamageDealtToChampions  physicalDamageTaken  playerAugment1  playerAugment2  playerAugment3  playerAugment4  playerAugment5  playerAugment6
playerScore0  playerScore1  playerScore2  playerScore3  playerScore4  playerScore5  playerScore6  playerScore7
playerScore8  playerScore9  playerSubteamId  quadraKills  roleBoundItem  sightWardsBoughtInGame  subteamPlacement  teamEarlySurrendered
timeCCingOthers  totalDamageDealt  totalDamageDealtToChampions  totalDamageTaken  totalHeal  totalMinionsKilled  totalPlayerScore  totalScoreRank
totalTimeCrowdControlDealt  totalUnitsHealed  tripleKills  trueDamageDealt  trueDamageDealtToChampions  trueDamageTaken  turretKills  unrealKills
visionScore  visionWardsBoughtInGame  wardsKilled  wardsPlaced  wasSevereTransgressor  win
```

## 7. participantIdentities（身份，12 字段）

| 字段 | 含义 |
|---|---|
| `participantId` | 对应 participants |
| `player.puuid` | 跨对局唯一标识（国服实测有值） |
| `player.gameName` | 游戏名 |
| `player.tagLine` | 编号（`#12345` 的数字部分） |
| `player.summonerName` | 旧版召唤师名（新 ID 系统下为空） |
| `player.summonerId` | 召唤师 ID |
| `player.accountId` / `currentAccountId` | 账号 ID |
| `player.platformId` / `currentPlatformId` | 大区 |
| `player.profileIcon` | 头像 ID |
| `player.matchHistoryUri` | 历史地址（常空） |

## 8. GameTimeline（时间线）

### 8.1 Frame（3 字段）

| 字段 | 含义 |
|---|---|
| `timestamp` | 相对开局的毫秒数，帧间隔 60 秒 |
| `participantFrames` | 10 人（或 16/18 人）的分钟快照 |
| `events` | 本帧内发生的事件 |

### 8.2 ParticipantFrame（10 字段）

| 字段 | 含义 |
|---|---|
| `participantId` | 玩家 ID |
| `currentGold` | 当前金币 |
| `totalGold` | 累计金币 |
| `level` | 等级 |
| `xp` | 经验 |
| `minionsKilled` | 补刀 |
| `jungleMinionsKilled` | 野怪数 |
| `position.x` / `position.y` | 地图坐标 |
| `dominionScore` / `teamScore` | 旧模式分数 |

### 8.3 Event（3 类，共用同一扁平结构）

字段：`type` `timestamp` `position{x,y}` `participantId` `killerId` `victimId` `assistingParticipantIds[]` `teamId` `skillSlot` `itemId` `buildingType` `towerType` `laneType` `monsterType` `monsterSubType`

- `CHAMPION_KILL`：`killerId` / `victimId` / `assistingParticipantIds` / `skillSlot` / `position`
- `BUILDING_KILL`：`buildingType`（`TOWER_BUILDING`）/ `towerType`（`OUTER_TURRET`）/ `laneType`（`TOP_LANE`）
- `ELITE_MONSTER_KILL`：`monsterType`（`DRAGON` / `BARON_NASHOR` / `RIFTHERALD` / `HORDE`）/ `monsterSubType`（如 `CHEMTECH_DRAGON`）

> 无关字段用空字符串或 0 占位，不是缺失。

## 9. 实测填充情况

| 数据 | 状态 |
|---|---|
| Stats 118 字段 | 除评分与 delta 外均有值 |
| `playerScore0-9` / `totalPlayerScore` | 15 局全 0 |
| `timeline.*Deltas` | 15 局全空 |
| `puuid` / `gameName` / `tagLine` | 5/5、10/10 有值 |
| 强化符文（2400） | 每人有 4 个左右 |
| 时间线帧 | 每局 25–31 帧，间隔 60 秒 |
| 事件 | 每局 80–170 条击杀 + 建筑/野怪 |

## 10. 与 SGP 数据源的差异

SGP 的 `participantFrames` 额外带：

- `championStats`（当前生命/法力/攻击力等）
- `damageStats`（每分钟对英雄伤害等）
- `victimDamageDealt` / `victimDamageReceived`（逐次伤害明细）

LCU 没有这些，所以：

- 3/4 级抓人只能靠“击杀参与”近似
- 无法做逐分钟伤害曲线
- 无法还原每一击的伤害来源

## 11. 产品能力映射（快速参考）

| 想做的功能 | 需要的字段 | 数据够不够 |
|---|---|---|
| 每日战报 | stats 基础/伤害/经济/视野 | 够 |
| 评分与称号 | stats + 队伍合计 | 够 |
| 海克斯强化展示 | `playerAugment1-6` | 够（需 `cherry-augments.json` 映射名） |
| 翻盘曲线 | timeline `totalGold` | 够，每局多一次请求 |
| 名场面 | 多杀字段 + `CHAMPION_KILL` 坐标/时间 | 够 |
| 打野习惯 | timeline 坐标 + 击杀事件 | 够，粒度 60 秒 |
| 对位经济差 | timeline 两人 `totalGold` | 够，但只有分钟级 |
| 伤害构成 | 物理/魔法/真实三分类 | 够 |
| 技能命中率 | — | 不够，LCU 没有 |
| 逐秒操作复盘 | — | 不够，需要录像/逐帧 |
| 官方评分 | `playerScore*` | 国服不可用 |
