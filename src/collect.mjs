/**
 * 采集：解析玩家、拉取对局、按 gameId 合并同队对局
 */
import { findSummoner, fetchMatches } from './lcu.mjs';

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

export function statOf(game, player) {
  const p = participantOf(game, player);
  if (!p?.stats) return null;
  const s = p.stats;
  return {
    teamId: p.teamId,
    championId: p.championId,
    kills: s.kills ?? 0,
    deaths: s.deaths ?? 0,
    assists: s.assists ?? 0,
    win: Boolean(s.win),
    damage: s.totalDamageDealtToChampions ?? 0,
    physicalDamage: s.physicalDamageDealtToChampions ?? 0,
    magicDamage: s.magicDamageDealtToChampions ?? 0,
    trueDamage: s.trueDamageDealtToChampions ?? 0,
    damageTaken: s.totalDamageTaken ?? 0,
    heal: s.totalHeal ?? 0,
    ccTime: s.timeCCingOthers ?? 0,
    gold: s.goldEarned ?? 0,
    cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0),
    vision: s.visionScore ?? 0,
    wardsPlaced: s.wardsPlaced ?? 0,
    wardsKilled: s.wardsKilled ?? 0,
    tripleKills: s.tripleKills ?? 0,
    quadraKills: s.quadraKills ?? 0,
    pentaKills: s.pentaKills ?? 0,
    firstBlood: Boolean(s.firstBloodKill),
    // 海克斯大乱斗的强化符文，最多 6 个，0 表示空位
    augments: [1, 2, 3, 4, 5, 6]
      .map((i) => s[`playerAugment${i}`])
      .filter((id) => typeof id === 'number' && id > 0),
    officialScore: typeof s.totalPlayerScore === 'number' ? s.totalPlayerScore : null,
  };
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

export async function collectWindow(get, players, { count, start, end, log = () => {} }) {
  const byGame = new Map();

  for (const player of players) {
    let games;
    try {
      games = await fetchMatches(get, player.puuid, count);
    } catch (e) {
      log(`  ✗ ${player.nickname} 拉取失败：${e.message}`);
      continue;
    }
    for (const game of games) {
      if (game.gameCreation < start || game.gameCreation >= end) continue;
      if (!byGame.has(game.gameId)) byGame.set(game.gameId, { game, entries: [] });
      const stat = statOf(game, player);
      if (stat) byGame.get(game.gameId).entries.push({ player, stat });
    }
  }

  return [...byGame.values()].sort((a, b) => a.game.gameCreation - b.game.gameCreation);
}
