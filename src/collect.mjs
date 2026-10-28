/**
 * 采集：解析玩家、拉取对局、按 gameId 合并同队对局
 */
import { findSummoner, fetchMatches, fetchGame } from './lcu.mjs';

export function identityOf(game, player) {
  const ids = game.participantIdentities ?? [];
  if (player.puuid) {
    const hit = ids.find((x) => x.player?.puuid === player.puuid);
    if (hit) return hit;
  }
  const names = [
    player.summoner,
    player.gameName && player.tagLine ? `${player.gameName}#${player.tagLine}` : null,
    player.gameName,
  ].filter(Boolean);
  return (
    ids.find(
      (x) => names.includes(x.player?.summonerName) || names.includes(x.player?.gameName),
    ) ?? null
  );
}

export function participantOf(game, player) {
  const identity = identityOf(game, player);
  if (!identity) return null;
  return (game.participants ?? []).find((x) => x.participantId === identity.participantId) ?? null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const raw = (v) => (typeof v === 'number' ? v : 0);

/** 单局单人数据：把 LCU participant.stats 里能用的字段全取出来（118 个里挑有意义的） */
export function statOf(game, player) {
  const p = participantOf(game, player);
  if (!p?.stats) return null;
  const s = p.stats;
  const tl = p.timeline ?? {};
  const deltas = (d) => (d && typeof d === 'object' ? { ...d } : null);

  return {
    // ── 身份与对位
    teamId: p.teamId,
    participantId: p.participantId,
    championId: p.championId,
    championLevel: num(s.champLevel),
    lane: tl.lane ?? null,
    role: tl.role ?? null,
    win: Boolean(s.win),

    // ── 击杀面
    kills: num(s.kills),
    deaths: num(s.deaths),
    assists: num(s.assists),
    doubleKills: num(s.doubleKills),
    tripleKills: num(s.tripleKills),
    quadraKills: num(s.quadraKills),
    pentaKills: num(s.pentaKills),
    unrealKills: num(s.unrealKills),
    largestMultiKill: num(s.largestMultiKill),
    killingSprees: num(s.killingSprees),
    largestKillingSpree: num(s.largestKillingSpree),
    longestTimeSpentLiving: num(s.longestTimeSpentLiving),
    largestCriticalStrike: num(s.largestCriticalStrike),

    // ── 伤害构成（对英雄 / 总计 / 承受）
    damage: num(s.totalDamageDealtToChampions),
    physicalDamage: num(s.physicalDamageDealtToChampions),
    magicDamage: num(s.magicDamageDealtToChampions),
    trueDamage: num(s.trueDamageDealtToChampions),
    totalDamageDealt: num(s.totalDamageDealt),
    damageToObjectives: num(s.damageDealtToObjectives),
    damageToTurrets: num(s.damageDealtToTurrets),
    damageSelfMitigated: num(s.damageSelfMitigated),
    damageTaken: num(s.totalDamageTaken),
    physicalDamageTaken: num(s.physicalDamageTaken),
    magicDamageTaken: num(s.magicalDamageTaken),
    trueDamageTaken: num(s.trueDamageTaken),
    heal: num(s.totalHeal),
    unitsHealed: num(s.totalUnitsHealed),
    ccTime: num(s.timeCCingOthers),
    totalCrowdControl: num(s.totalTimeCrowdControlDealt),

    // ── 经济与发育
    gold: num(s.goldEarned),
    goldSpent: num(s.goldSpent),
    cs: num(s.totalMinionsKilled) + num(s.neutralMinionsKilled),
    minions: num(s.totalMinionsKilled),
    neutralMinions: num(s.neutralMinionsKilled),
    jungleTeam: num(s.neutralMinionsKilledTeamJungle),
    jungleEnemy: num(s.neutralMinionsKilledEnemyJungle),

    // ── 视野
    vision: num(s.visionScore),
    wardsPlaced: num(s.wardsPlaced),
    wardsKilled: num(s.wardsKilled),
    sightWardsBought: num(s.sightWardsBoughtInGame),
    visionWardsBought: num(s.visionWardsBoughtInGame),

    // ── 目标物（个人）
    turretKills: num(s.turretKills),
    inhibitorKills: num(s.inhibitorKills),
    firstBlood: Boolean(s.firstBloodKill),
    firstBloodAssist: Boolean(s.firstBloodAssist),
    firstTower: Boolean(s.firstTowerKill),
    firstTowerAssist: Boolean(s.firstTowerAssist),
    firstInhibitor: Boolean(s.firstInhibitorKill),
    firstInhibitorAssist: Boolean(s.firstInhibitorAssist),

    // ── 装备（0-5 六格 + 6 饰品，0 = 空）
    items: [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].map(raw),

    // ── 召唤师技能
    spells: [p.spell1Id, p.spell2Id].map(raw),

    // ── 符文（0 基石 + 1-3 主系 + 4-5 副系，含每个符文的三个数值）
    perks: {
      keystone: raw(s.perk0),
      primaryStyle: raw(s.perkPrimaryStyle),
      subStyle: raw(s.perkSubStyle),
      ids: [s.perk0, s.perk1, s.perk2, s.perk3, s.perk4, s.perk5].map(raw),
      vars: [0, 1, 2, 3, 4, 5].map((i) => [raw(s[`perk${i}Var1`]), raw(s[`perk${i}Var2`]), raw(s[`perk${i}Var3`])]),
    },

    // ── 官方评分（已采集，暂未展示）
    officialScore: typeof s.totalPlayerScore === 'number' ? s.totalPlayerScore : null,
    officialRank: raw(s.totalScoreRank),
    objectiveScore: raw(s.objectivePlayerScore),
    combatScore: raw(s.combatPlayerScore),
    playerScores: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => raw(s[`playerScore${i}`])),

    // ── 投降 / 异常结束
    surrendered: {
      early: Boolean(s.gameEndedInEarlySurrender),
      normal: Boolean(s.gameEndedInSurrender),
      remake: Boolean(s.gameEndedInIGNBSurrender),
      caused: Boolean(s.causedEarlySurrender),
    },

    // ── 每分钟曲线（来自 participant.timeline）
    perMin: {
      gold: deltas(tl.goldPerMinDeltas),
      xp: deltas(tl.xpPerMinDeltas),
      cs: deltas(tl.creepsPerMinDeltas),
      csDiff: deltas(tl.csDiffPerMinDeltas),
      xpDiff: deltas(tl.xpDiffPerMinDeltas),
      damageTaken: deltas(tl.damageTakenPerMinDeltas),
      damageTakenDiff: deltas(tl.damageTakenDiffPerMinDeltas),
    },

    // ── 海克斯大乱斗的强化符文，最多 6 个，0 表示空位
    augments: [1, 2, 3, 4, 5, 6]
      .map((i) => s[`playerAugment${i}`])
      .filter((id) => typeof id === 'number' && id > 0),
  };
}

/** 队伍层面：ban 位、大小龙、塔、一血/一塔 */
export function teamsOf(game) {
  return (game.teams ?? []).map((t) => ({
    teamId: t.teamId,
    win: t.win === 'Win' || t.win === true,
    bans: (t.bans ?? []).map((b) => b.championId),
    baronKills: num(t.baronKills),
    dragonKills: num(t.dragonKills),
    riftHeraldKills: num(t.riftHeraldKills),
    hordeKills: num(t.hordeKills),
    vilemawKills: num(t.vilemawKills),
    towerKills: num(t.towerKills),
    inhibitorKills: num(t.inhibitorKills),
    firstBlood: Boolean(t.firstBlood),
    firstTower: Boolean(t.firstTower),
    firstBaron: Boolean(t.firstBaron),
    firstDragon: Boolean(t.firstDargon),
    firstInhibitor: Boolean(t.firstInhibitor),
  }));
}


export async function resolvePlayers(get, players, log = () => {}) {
  const out = [];
  for (const p of players) {
    const s = await findSummoner(get, p.summoner);
    if (!s) {
      log(`  ✗ ${p.nickname}（${p.summoner}）查无此人`);
      continue;
    }
    out.push({
      ...p,
      puuid: s.puuid,
      gameName: s.gameName,
      tagLine: s.tagLine,
    });
    log(`  ✓ ${p.nickname} -> ${s.gameName}#${s.tagLine ?? ''}`);
  }
  return out;
}

export async function collectWindow(get, players, { count, start, end, queues, log = () => {} }) {
  // 第一遍：只按时间窗 + 队列白名单挑出候选对局（列表接口的 payload 不完整，不能直接拿来算指标）
  const inWindow = new Map();
  const skippedIds = new Set();

  for (const player of players) {
    let games;
    try {
      games = await fetchMatches(get, player.puuid, count);
    } catch (e) {
      log(`  ✗ ${player.nickname} 拉取失败：${e.message}`);
      continue;
    }
    for (const raw of games) {
      if (raw.gameCreation < start || raw.gameCreation >= end) continue;
      // 队列过滤：只保留白名单里的队列（例如只统计灵活组排 440）
      if (queues?.length && !queues.includes(raw.queueId)) {
        skippedIds.add(raw.gameId);
        continue;
      }
      if (!inWindow.has(raw.gameId)) inWindow.set(raw.gameId, raw);
    }
  }
  if (skippedIds.size) {
    log(`  已跳过 ${skippedIds.size} 局非指定队列的对局（只统计 queue ${queues.join('/')}）`);
  }

  // 第二遍：补拉完整对局，再按 puuid 取每个人的 stat
  const byGame = new Map();
  for (const [gameId, summary] of inWindow) {
    let game = summary;
    try {
      const full = await fetchGame(get, gameId);
      if ((full?.participants?.length ?? 0) > (summary.participants?.length ?? 0)) {
        game = { ...summary, ...full };
      }
    } catch (e) {
      log(`  ! 对局 ${gameId} 详情拉取失败，指标可能失真：${e.message}`);
    }
    const entries = [];
    for (const player of players) {
      const stat = statOf(game, player);
      if (stat) entries.push({ player, stat });
    }
    byGame.set(gameId, { game, entries });
  }

  return [...byGame.values()].sort((a, b) => a.game.gameCreation - b.game.gameCreation);
}
