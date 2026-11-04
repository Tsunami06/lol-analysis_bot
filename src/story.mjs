/**
 * 悲情英雄尽力局文案生成
 *
 * 输入一局完整对局（可选时间线），判断某位玩家是否“尽力局”，
 * 并生成一段群聊风格的小作文。所有描述都必须有数据支撑。
 */
import fs from 'node:fs';
import path from 'node:path';

const CN = 8 * 3600 * 1000;

const QUEUE_LABEL = {
  420: '单双排', 430: '匹配', 440: '灵活排位', 450: '极地大乱斗',
  2400: '海克斯大乱斗', 480: '快速匹配', 900: '无限火力',
  1700: '斗魂竞技场', 1750: '斗魂竞技场',
};

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const fmtK = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pct = (x) => `${Math.round((Number.isFinite(x) ? x : 0) * 100)}%`;
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function roleOf(participant, frames = []) {
  const lane = participant?.timeline?.lane;
  const role = participant?.timeline?.role;

  if (lane === 'TOP') return '上单';
  if (lane === 'MIDDLE') return '中单';
  if (lane === 'BOTTOM') return role === 'SUPPORT' ? '辅助' : 'ADC';
  if (role === 'SUPPORT') return '辅助';

  // 带惩戒就是打野（LCU 的 JUNGLE 标记并不可靠，青钢影也可能被标成 JUNGLE）
  const spells = [participant?.spell1Id, participant?.spell2Id];
  if (spells.includes(11)) return '打野';

  // 其余用前 14 分钟的位置分布推断
  const zones = { top: 0, mid: 0, bot: 0 };
  for (const f of frames.slice(1, 15)) {
    const pf = f.participantFrames?.[participant?.participantId];
    if (!pf?.position) continue;
    zones[zoneOf(pf.position.x, pf.position.y)] += 1;
  }
  const best = Object.entries(zones).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mid';
  return best === 'top' ? '上单' : best === 'bot' ? 'ADC' : '中单';
}

function zoneOf(x, y) {
  if (x < 5000 && y > 9000) return 'top';
  if (x > 9000 && y < 5000) return 'bot';
  if (Math.abs(y - x) <= 3500) return 'mid';
  return y > x ? 'top' : 'bot';
}

export function loadGameData(dataDir, gameId) {
  const want = `game-${gameId}.json`;
  let gameFile = null;
  let timelineFile = null;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === want) gameFile = p;
      else if (e.name === `timeline-${gameId}.json`) timelineFile = p;
    }
  };
  if (!fs.existsSync(dataDir)) throw new Error(`数据目录不存在：${dataDir}`);
  walk(dataDir);
  if (!gameFile) throw new Error(`在 ${dataDir} 里找不到 ${want}`);

  return {
    game: JSON.parse(fs.readFileSync(gameFile, 'utf8')),
    timeline: timelineFile ? JSON.parse(fs.readFileSync(timelineFile, 'utf8')) : null,
    gameFile,
    timelineFile,
  };
}

export function loadAssets(dataDir) {
  const candidates = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'assets.json') candidates.push(p);
    }
  };
  if (fs.existsSync(dataDir)) walk(dataDir);
  candidates.sort();
  const file = candidates.at(-1);
  if (!file) return { champions: {}, augments: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function buildFacts(game, timeline, playerKey, assets = {}) {
  const identities = game.participantIdentities ?? [];
  const participants = game.participants ?? [];

  const identity = identities.find((x) => {
    const p = x.player ?? {};
    if (!playerKey) return false;
    return (
      p.puuid === playerKey ||
      p.gameName === playerKey ||
      `${p.gameName}#${p.tagLine ?? ''}` === playerKey
    );
  });
  if (!identity) throw new Error(`对局里找不到玩家：${playerKey}`);

  const pid = identity.participantId;
  const me = participants.find((p) => p.participantId === pid);
  const teamId = me.teamId;
  const mine = participants.filter((p) => p.teamId === teamId);
  const theirs = participants.filter((p) => p.teamId !== teamId);

  const nameOf = (id) => {
    const it = identities.find((x) => x.participantId === id);
    return it?.player?.gameName ?? `#${id}`;
  };
  const champOf = (id) => {
    const p = participants.find((x) => x.participantId === id);
    return assets.champions?.[String(p?.championId)] ?? `#${p?.championId ?? '?'}`;
  };
  const statOfPid = (id) => participants.find((x) => x.participantId === id)?.stats ?? {};

  const teamKills = mine.reduce((a, p) => a + (p.stats?.kills ?? 0), 0);
  const teamDamage = mine.reduce((a, p) => a + (p.stats?.totalDamageDealtToChampions ?? 0), 0);
  const teamGold = mine.reduce((a, p) => a + (p.stats?.goldEarned ?? 0), 0);
  const teamDeaths = mine.reduce((a, p) => a + (p.stats?.deaths ?? 0), 0);
  const teamVision = mine.reduce((a, p) => a + (p.stats?.visionScore ?? 0), 0);
  const frames = timeline?.frames ?? [];

  const buildRow = (p) => {
    const s = p.stats ?? {};
    const k = s.kills ?? 0;
    const d = s.deaths ?? 0;
    const a = s.assists ?? 0;
    return {
      pid: p.participantId,
      name: nameOf(p.participantId),
      champion: champOf(p.participantId),
      role: roleOf(p, frames),
      k, d, a,
      kills: k,
      assists: a,
      deaths: d,
      kda: (k + a) / Math.max(1, d),
      kp: (k + a) / Math.max(1, teamKills),
      damage: s.totalDamageDealtToChampions ?? 0,
      damageShare: (s.totalDamageDealtToChampions ?? 0) / Math.max(1, teamDamage),
      gold: s.goldEarned ?? 0,
      goldShare: (s.goldEarned ?? 0) / Math.max(1, teamGold),
      cs: (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0),
      vision: s.visionScore ?? 0,
      taken: s.totalDamageTaken ?? 0,
      heal: s.totalHeal ?? 0,
      cc: Math.round(s.timeCCingOthers ?? 0),
      turretKills: s.turretKills ?? 0,
      penta: s.pentaKills ?? 0,
      quadra: s.quadraKills ?? 0,
      triple: s.tripleKills ?? 0,
      double: s.doubleKills ?? 0,
      firstBlood: Boolean(s.firstBloodKill),
    };
  };

  const player = buildRow(me);
  const mates = mine.filter((p) => p.participantId !== pid).map(buildRow);
  const enemies = theirs.map(buildRow);

  // 对位经济差
  for (const m of mates) {
    const opp = enemies.find((e) => e.role === m.role);
    m.enemyDiff = opp ? m.gold - opp.gold : null;
    m.enemyName = opp?.name ?? null;
    m.enemyChampion = opp?.champion ?? null;
  }

  let maxLead = null;
  let lead20 = null;
  for (const f of frames) {
    let ours = 0;
    let theirsGold = 0;
    for (const [idStr, pf] of Object.entries(f.participantFrames ?? {})) {
      const id = Number(idStr);
      const p = participants.find((x) => x.participantId === id);
      if (!p) continue;
      if (p.teamId === teamId) ours += pf.totalGold ?? 0;
      else theirsGold += pf.totalGold ?? 0;
    }
    const diff = ours - theirsGold;
    if (maxLead === null || diff > maxLead) maxLead = diff;
    // 取离 20 分钟最近的一帧
    if (lead20 === null || Math.abs(f.timestamp - 20 * 60 * 1000) < Math.abs(lead20.t - 20 * 60 * 1000)) {
      lead20 = { t: f.timestamp, diff };
    }
  }
  lead20 = lead20?.diff ?? null;

  const events = frames.flatMap((f) => f.events ?? []);
  const kills = events.filter((e) => e.type === 'CHAMPION_KILL');

  const myKills = kills
    .filter((e) => e.killerId === pid)
    .map((e) => ({
      t: e.timestamp,
      victim: nameOf(e.victimId),
      victimChampion: champOf(e.victimId),
      assists: (e.assistingParticipantIds ?? []).map(nameOf),
    }));

  const myDeaths = kills
    .filter((e) => e.victimId === pid)
    .map((e) => ({
      t: e.timestamp,
      killer: nameOf(e.killerId),
      killerChampion: champOf(e.killerId),
    }));

  const deathTimes = new Map();
  for (const e of kills) {
    if (!deathTimes.has(e.victimId)) deathTimes.set(e.victimId, []);
    deathTimes.get(e.victimId).push(e.timestamp);
  }
  const lastDeathBefore = (id, t) => {
    const arr = deathTimes.get(id);
    if (!arr) return undefined;
    let last;
    for (const x of arr) {
      if (x <= t) last = x;
      else break;
    }
    return last;
  };

  const matesDeadBefore = (t) =>
    mates.filter((m) => {
      const d = lastDeathBefore(m.pid, t);
      return d !== undefined && t - d <= 60_000;
    }).length;

  // 15 秒内的连杀，才叫“一波”
  const bursts = [];
  for (const k of myKills) {
    const last = bursts.at(-1);
    if (last && k.t - last.end <= 15_000) {
      last.kills.push(k);
      last.end = k.t;
    } else {
      bursts.push({ start: k.t, end: k.t, kills: [k] });
    }
  }

  // 连杀期间至少两名队友刚阵亡 → 守家/少打多
  const clutchBursts = bursts
    .filter((b) => b.kills.length >= 2 && matesDeadBefore(b.start) >= 2)
    .sort((a, b) => b.kills.length - a.kills.length || b.start - a.start);
  const bestClutch = clutchBursts[0] ?? null;

  const buildings = events
    .filter((e) => e.type === 'BUILDING_KILL' && e.killerId === pid)
    .map((e) => ({ t: e.timestamp, towerType: e.towerType, lane: e.laneType }));

  const objectives = events
    .filter((e) => e.type === 'ELITE_MONSTER_KILL')
    .map((e) => {
      const killer = participants.find((p) => p.participantId === e.killerId);
      return {
        t: e.timestamp,
        type: e.monsterType,
        sub: e.monsterSubType,
        team: killer?.teamId ?? null,
        ours: killer?.teamId === teamId,
      };
    });

  const laneKills = myKills.filter((k) => k.t <= 14 * 60 * 1000).length;
  const nexusTurrets = buildings.filter((b) => b.towerType === 'NEXUS_TURRET');

  return {
    gameId: game.gameId,
    queueId: game.queueId,
    queueLabel: QUEUE_LABEL[game.queueId] ?? `队列 ${game.queueId}`,
    mode: game.gameMode,
    creation: game.gameCreation,
    duration: game.gameDuration,
    win: Boolean(me.stats?.win),
    player,
    mates,
    enemies,
    team: { kills: teamKills, damage: teamDamage, gold: teamGold, deaths: teamDeaths, vision: teamVision },
    timeline: {
      has: frames.length > 0,
      maxLead,
      lead20,
      laneKills,
      myKills,
      myDeaths,
      clutchBursts,
      bestClutch,
      buildings,
      nexusTurrets: nexusTurrets.length,
      objectives,
    },
  };
}

/** 尽力局指数 0–100；胜局直接返回 0 */
export function carryScore(f) {
  if (f.win) return 0;
  const p = f.player;
  const parts = [
    clamp((p.damageShare - 0.2) / 0.15) * 30,
    clamp((p.kp - 0.4) / 0.35) * 25,
    clamp((p.kda - 2) / 4) * 15,
    clamp((p.goldShare - 0.2) / 0.12) * 10,
    clamp((f.timeline.maxLead ?? 0) / 4000) * 10,
    clamp((f.team.deaths - 20) / 20) * 10,
  ];
  return Math.round(parts.reduce((a, b) => a + b, 0));
}

function seedOf(f) {
  return Number(f.gameId) % 997;
}

function pick(arr, seed, offset = 0) {
  return arr[(seed + offset) % arr.length];
}

function toneBucket(tone) {
  if (tone <= 2) return 'soft';
  if (tone === 3) return 'neutral';
  return 'sharp';
}

const OPENINGS = {
  soft: [
    (f) => `这局输了，但「${f.player.name}」真的没什么可自责的。`,
    (f) => `「${f.player.name}」打完了自己能打的一切，比分没能跟上。`,
  ],
  neutral: [
    (f) => `记分板写着负，「${f.player.name}」的数据写着“不服”。`,
    (f) => `这局输得不冤，但锅不该由「${f.player.name}」一个人背。`,
  ],
  sharp: [
    (f) => `输了。但谁要把锅扣到「${f.player.name}」头上，建议先看看伤害条。`,
    (f) => `比分是负的，「${f.player.name}」的表现是正的。`,
  ],
};

function highlightParagraphs(f) {
  const p = f.player;
  const t = f.timeline;
  const out = [];

  if (t.laneKills >= 3) {
    out.push(`前 14 分钟 ${t.laneKills} 次击杀，全场 ${p.kills} 杀 ${p.deaths} 死 ${p.assists} 助，${p.cs} 刀、${fmtK(p.damage)} 伤害，占全队 ${pct(p.damageShare)}。`);
  } else {
    out.push(`全场 ${p.kills}/${p.deaths}/${p.assists}，${p.cs} 刀、${fmtK(p.damage)} 伤害，占全队 ${pct(p.damageShare)}。`);
  }

  if (t.bestClutch) {
    const b = t.bestClutch;
    const span = Math.max(1, Math.round((b.end - b.start) / 1000));
    out.push(`${mmss(b.start)}，队友刚倒，他一个人在 ${span} 秒内连收 ${b.kills.length} 人。`);
  } else if (p.triple || p.quadra || p.penta) {
    const label = p.penta ? '五杀' : p.quadra ? '四杀' : '三杀';
    const at = t.myKills.at(-1);
    out.push(`${at ? mmss(at.t) + '，' : ''}${label}，全场 ${p.kills} 杀。`);
  }

  if (t.nexusTurrets > 0) {
    const times = t.buildings.filter((b) => b.towerType === 'NEXUS_TURRET').map((b) => mmss(b.t));
    out.push(`${times.join('、')}，他推到对面基地，连拆 ${t.nexusTurrets} 座双子塔。`);
  }

  if (t.lead20 > 1000) {
    out.push(`20 分钟时队伍领先 ${fmtK(t.lead20)} 经济，这是他打出来的。`);
  }

  return out;
}

function roastLine(m, f) {
  const parts = [`${m.role} ${m.name}（${m.champion}）${m.k}/${m.deaths}/${m.a}`];
  if (m.role !== '打野' && m.enemyDiff !== null && m.enemyDiff <= -1000) {
    parts.push(`对位经济差 ${fmtK(m.enemyDiff)}`);
  }
  if (m.deaths >= 8) {
    parts.push(`平均 ${(f.duration / 60 / m.deaths).toFixed(1)} 分钟送一次`);
  } else if (m.damageShare < 0.12) {
    parts.push(`伤害占比 ${pct(m.damageShare)}`);
  }
  return parts.join('，') + '。';
}

export function renderStory(f, { tone = 3 } = {}) {
  const bucket = toneBucket(tone);
  const seed = seedOf(f);
  const lines = [];

  const d = new Date(f.creation + CN);
  lines.push(`【尽力局】${d.getUTCMonth() + 1}月${d.getUTCDate()}日 · ${f.queueLabel} · ${dur(f.duration)} · 负`);
  lines.push('');
  lines.push(pick(OPENINGS[bucket], seed)(f));
  lines.push('');

  const highlights = highlightParagraphs(f);
  for (const h of highlights) lines.push(h);
  lines.push('');

  // 避免把辅助放进挨骂名单
  const supports = f.mates.filter((m) => m.role === '辅助');
  const suspects = f.mates
    .filter((m) => m.role !== '辅助')
    .sort((a, b) => (b.deaths * 2 + (1 - b.damageShare) * 20 - b.kda * 2) - (a.deaths * 2 + (1 - a.damageShare) * 20 - a.kda * 2))
    .slice(0, 3);

  if (suspects.length) {
    lines.push('当然，这局也不是没有别的原因。');
    for (const m of suspects) lines.push(roastLine(m, f));
    lines.push('');
  }

  const support = supports.sort((a, b) => b.a - a.a)[0];
  if (support) {
    const quip = bucket === 'soft'
      ? '辛苦了。'
      : bucket === 'neutral'
        ? '全队唯一一个把“保护”当任务的人。'
        : `没有他，「${f.player.name}」连一打四的资格都没有。`;
    lines.push(`全场唯一清醒的是辅助 ${support.name}（${support.champion}）：${support.a} 助攻、${support.vision} 视野、${fmtK(support.taken)} 承伤。${quip}`);
    lines.push('');
  }

  const p = f.player;
  const recap = [];
  if (f.timeline.maxLead !== null && f.timeline.maxLead < -2000) recap.push(`落后 ${fmtK(-f.timeline.maxLead)} 是他扛住的`);
  if (f.timeline.nexusTurrets > 0) recap.push('对面双子塔是他拆的');
  if (recap.length) lines.push(`把这些串起来：${recap.join('，')}。`);

  lines.push('');
  lines.push(
    bucket === 'soft'
      ? `「${p.name}」，这把不怪你。`
      : bucket === 'neutral'
        ? `「${p.name}」，这把真不怪你；队友把桌子掀了，你还在收拾碗筷。`
        : `「${p.name}」，队友把桌子掀了，你还在收拾碗筷。下次谁再说 ADC 没用，把 ${p.kills}/${p.deaths}/${p.assists} 甩他脸上。`,
  );

  return lines.join('\n');
}
