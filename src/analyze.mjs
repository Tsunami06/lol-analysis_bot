/**
 * 分析：单局指标、同队内 z-score 评分、当日称号
 */

const QUEUES = {
  400: '匹配', 420: '单双排', 430: '匹配', 440: '灵活排位',
  450: '极地大乱斗', 700: '冠军杯', 720: '冠军杯大乱斗',
  830: '人机', 840: '人机', 850: '人机',
  900: '无限火力', 1020: '克隆', 1300: '极限闪击', 1400: '终极魔典',
  1700: '斗魂竞技场', 1900: '无限乱斗', 2300: '斗魂竞技场',
};

// 海克斯大乱斗等新模式，先用 gameMode 归类，queueId 由真实数据确认后再补
const ARAM_QUEUES = new Set([450, 720, 2400]);

export function modeOf(game) {
  if (ARAM_QUEUES.has(game.queueId) || game.gameMode === 'ARAM' || game.gameMode === 'KIWI') {
    return { bucket: 'aram', label: QUEUES[game.queueId] ?? '大乱斗' };
  }
  return { bucket: 'rift', label: QUEUES[game.queueId] ?? (game.gameMode === 'CLASSIC' ? '峡谷' : '其他') };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function zscores(values) {
  const m = mean(values);
  const variance = mean(values.map((x) => (x - m) ** 2));
  const sd = Math.sqrt(variance);
  return values.map((x) => (sd > 0 ? (x - m) / sd : 0));
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * @param {Array<{game:object, entries:Array<{player:object, stat:object}>}>} games
 */
export function analyze(games) {
  const analyzed = [];

  for (const { game, entries } of games) {
    const mode = modeOf(game);
    const durationMin = Math.max(1, (game.gameDuration ?? 0) / 60);

    const teamKills = new Map();
    const teamDamage = new Map();
    for (const p of game.participants ?? []) {
      teamKills.set(p.teamId, (teamKills.get(p.teamId) ?? 0) + (p.stats?.kills ?? 0));
      teamDamage.set(
        p.teamId,
        (teamDamage.get(p.teamId) ?? 0) + (p.stats?.totalDamageDealtToChampions ?? 0),
      );
    }

    const rows = entries.map(({ player, stat }) => {
      const kills = teamKills.get(stat.teamId) || 1;
      const damage = teamDamage.get(stat.teamId) || 1;
      const kda = (stat.kills + stat.assists) / Math.max(1, stat.deaths);
      return {
        nickname: player.nickname,
        player,
        championId: stat.championId,
        teamId: stat.teamId,
        win: stat.win,
        kills: stat.kills,
        deaths: stat.deaths,
        assists: stat.assists,
        damage: stat.damage,
        physicalDamage: stat.physicalDamage,
        magicDamage: stat.magicDamage,
        trueDamage: stat.trueDamage,
        damageTaken: stat.damageTaken,
        heal: stat.heal,
        ccTime: stat.ccTime,
        gold: stat.gold,
        cs: stat.cs,
        vision: stat.vision,
        wardsPlaced: stat.wardsPlaced,
        wardsKilled: stat.wardsKilled,
        tripleKills: stat.tripleKills,
        quadraKills: stat.quadraKills,
        pentaKills: stat.pentaKills,
        firstBlood: stat.firstBlood,
        augments: stat.augments,
        officialScore: stat.officialScore,
        kda,
        damageShare: stat.damage / damage,
        participation: (stat.kills + stat.assists) / kills,
        goldPerMin: stat.gold / durationMin,
        csPerMin: stat.cs / durationMin,
        deathsPerMin: stat.deaths / durationMin,
      };
    });

    if (rows.length) {
      const z = {
        kda: zscores(rows.map((r) => r.kda)),
        damageShare: zscores(rows.map((r) => r.damageShare)),
        participation: zscores(rows.map((r) => r.participation)),
        deathsPerMin: zscores(rows.map((r) => -r.deathsPerMin)),
        goldPerMin: zscores(rows.map((r) => r.goldPerMin)),
      };
      rows.forEach((r, i) => {
        const total =
          0.3 * z.kda[i] + 0.3 * z.damageShare[i] + 0.2 * z.participation[i] +
          0.1 * z.deathsPerMin[i] + 0.1 * z.goldPerMin[i];
        r.score = Math.round(clamp(50 + 16 * total, 5, 95));
      });
    }

    analyzed.push({
      gameId: game.gameId,
      queueId: game.queueId,
      gameMode: game.gameMode,
      creation: game.gameCreation,
      duration: game.gameDuration ?? 0,
      mode,
      win: rows[0]?.win ?? false,
      rows,
      teamSize: rows.length,
    });
  }

  // 当日汇总
  const byPlayer = new Map();
  for (const g of analyzed) {
    for (const r of g.rows) {
      if (!byPlayer.has(r.nickname)) {
        byPlayer.set(r.nickname, {
          nickname: r.nickname,
          games: 0, wins: 0, scoreSum: 0, dmgShareSum: 0,
          partSum: 0, kills: 0, deaths: 0, assists: 0, damage: 0,
          bestGame: null,
        });
      }
      const p = byPlayer.get(r.nickname);
      p.games += 1;
      p.wins += r.win ? 1 : 0;
      p.scoreSum += r.score ?? 50;
      p.dmgShareSum += r.damageShare;
      p.partSum += r.participation;
      p.kills += r.kills;
      p.deaths += r.deaths;
      p.assists += r.assists;
      p.damage += r.damage;
      if (!p.bestGame || (r.score ?? 0) > (p.bestGame.score ?? 0)) {
        p.bestGame = r;
      }
    }
  }

  const standings = [...byPlayer.values()]
    .map((p) => ({
      ...p,
      avgScore: p.scoreSum / p.games,
      avgDamageShare: p.dmgShareSum / p.games,
      avgParticipation: p.partSum / p.games,
      deathsPerGame: p.deaths / p.games,
      kdaRatio: (p.kills + p.assists) / Math.max(1, p.deaths),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return {
    games: analyzed,
    standings,
    titles: pickTitles(standings),
    highlights: pickHighlights(analyzed),
  };
}

function pickHighlights(games) {
  const list = [];
  let topDamage = null;
  for (const g of games) {
    for (const r of g.rows) {
      if (r.pentaKills > 0) {
        list.push({ kind: 'penta', nickname: r.nickname, championId: r.championId, text: '五杀' });
      } else if (r.quadraKills > 0) {
        list.push({ kind: 'quadra', nickname: r.nickname, championId: r.championId, text: '四杀' });
      }
      if (r.firstBlood) {
        list.push({ kind: 'firstBlood', nickname: r.nickname, championId: r.championId, text: '一血' });
      }
      if (!topDamage || r.damage > topDamage.damage) topDamage = r;
    }
  }
  if (topDamage) {
    list.push({
      kind: 'damage',
      nickname: topDamage.nickname,
      championId: topDamage.championId,
      text: `单局最高伤害 ${Math.round(topDamage.damage / 1000)}k`,
    });
  }

  const seen = new Set();
  const rank = { penta: 0, quadra: 1, firstBlood: 2, damage: 3 };
  return list
    .filter((h) => {
      const key = `${h.kind}:${h.nickname}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => rank[a.kind] - rank[b.kind])
    .slice(0, 3);
}

function pickTitles(standings) {
  if (!standings.length) return null;
  if (standings.length === 1) {
    return { mvp: standings[0], worst: null, carry: standings[0], feeder: standings[0], invisible: null };
  }
  const by = (fn, dir = -1) => [...standings].sort((a, b) => dir * (fn(a) - fn(b)))[0];
  return {
    mvp: by((s) => s.avgScore),
    worst: by((s) => s.avgScore, 1),
    carry: by((s) => s.avgDamageShare),
    feeder: by((s) => s.deathsPerGame),
    invisible: by((s) => s.avgDamageShare, 1),
  };
}
