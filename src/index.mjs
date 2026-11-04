#!/usr/bin/env node
/**
 * 入口：一次性生成 / 守护模式定时发送
 *
 *   node src/index.mjs once [--date 2026-10-27] [--dry-run] [--force]
 *   node src/index.mjs daemon
 *   node src/index.mjs probe
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, loadPlayers } from './config.mjs';
import {
  connect, championMap, augmentMap, itemMap, spellMap, perkMap, fetchGame,
} from './lcu.mjs';
import { resolvePlayers, collectWindow, statOf, teamsOf } from './collect.mjs';
import { analyze, modeOf } from './analyze.mjs';
import { renderReport } from './report.mjs';
import { sendToWechat } from './publish.mjs';
import { buildFacts, carryScore, renderStory, loadGameData, loadAssets } from './story.mjs';

const CN = 8 * 3600 * 1000;
const STATE_FILE = path.join(ROOT, 'data', 'state.json');

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'once';
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

function dayStartCN(ts) {
  const d = new Date(ts + CN);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - CN;
}

function labelOf(ts) {
  return new Date(ts + CN).toISOString().slice(0, 10);
}

function prettyLabel(label) {
  const [, m, d] = label.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function buildReport({ dateLabel, config, log = console.log }) {
  const players = loadPlayers(config.playersFile);
  const { get, me, source } = await connect({
    lockfile: config.lockfile,
    port: config.lcuPort,
    token: config.lcuToken,
    deep: config.deepScan,
  });
  log(`✓ 客户端已连接（${source}） 账号 ${me.gameName ?? me.displayName}#${me.tagLine ?? ''}`);

  const resolved = await resolvePlayers(get, players, log);
  if (!resolved.length) throw new Error('没有任何玩家解析成功，检查 players.json 的 名字#编号');

  const start = Date.parse(`${dateLabel}T00:00:00+08:00`);
  const window = { start, end: start + 86_400_000 };

  const games = await collectWindow(get, resolved, {
    count: config.count,
    start: window.start,
    end: window.end,
    queues: config.queues,
    log,
  });

  const champions = await championMap(get);
  const augments = await augmentMap(get);
  const analysis = analyze(games);
  const text = renderReport({
    dateLabel: prettyLabel(dateLabel),
    analysis,
    champions,
    augments,
    tone: config.tone,
  });

  return { text, analysis, games: games.length };
}

async function runOnce({ dateLabel, dryRun, force, log = console.log }) {
  const config = loadConfig();
  const label = dateLabel || labelOf(dayStartCN(Date.now()) - 86_400_000);

  log(`\n=== ${prettyLabel(label)} 战报 ===`);
  const { text, games } = await buildReport({ dateLabel: label, config, log });

  log('\n' + text + '\n');

  if (!games) {
    log('昨天没有对局，跳过发送。');
    return;
  }
  if (dryRun || config.sendMode === 'dry-run') {
    log('dry-run：不发送。');
    return;
  }

  const state = readState();
  if (!force && state.lastSent === label) {
    log(`已经发送过 ${label} 的战报，跳过（--force 可强制重发）。`);
    return;
  }

  log(`发送到微信群「${config.group}」...`);
  await sendToWechat({
    group: config.group,
    text,
    delayMs: config.wechatDelayMs ?? 600,
    mock: process.env.WECHAT_MOCK === '1',
  });
  writeState({
    ...state,
    lastSent: label,
    lastRunDate: labelOf(dayStartCN(Date.now())),
    sentAt: new Date().toISOString(),
  });
  log('✓ 已发送');
}

async function probe() {
  const config = loadConfig();
  const { get, me, source } = await connect({
    lockfile: config.lockfile,
    port: config.lcuPort,
    token: config.lcuToken,
    deep: config.deepScan,
  });
  const champions = await championMap(get);
  const augments = await augmentMap(get);
  console.log(`✓ 已连接（${source}）`);
  console.log(`  账号：${me.gameName ?? me.displayName}#${me.tagLine ?? ''}  Lv.${me.summonerLevel ?? '?'}`);
  console.log(`  英雄数据：${champions.size} 个，强化符文：${augments.size} 个`);
  const players = loadPlayers(config.playersFile);
  const resolved = await resolvePlayers(get, players, console.log);
  console.log(`  解析成功：${resolved.length}/${players.length}`);
  console.log(`  sidecar：${config.sendMode}（群「${config.group}」）`);
}

/**
 * 单局全量检查：把 LCU 能给的字段全打出来，并把原始 payload 存到 data/raw/{gameId}.json
 *   node src/index.mjs game 901113996532
 */
async function inspect(gameIdArg) {
  const gameId = Number(gameIdArg);
  if (!gameId) throw new Error('用法：node src/index.mjs game <gameId>');

  const config = loadConfig();
  const { get, source } = await connect({
    lockfile: config.lockfile,
    port: config.lcuPort,
    token: config.lcuToken,
    deep: config.deepScan,
  });
  const [champs, items, spells, perks] = await Promise.all([
    championMap(get), itemMap(get), spellMap(get), perkMap(get),
  ]);
  const game = await fetchGame(get, gameId);

  const rawDir = path.join(ROOT, 'data', 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const rawFile = path.join(rawDir, `${gameId}.json`);
  fs.writeFileSync(rawFile, JSON.stringify(game, null, 2));

  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  const pct = (x) => `${Math.round((Number.isFinite(x) ? x : 0) * 100)}%`;
  const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const name = (m, id) => (id ? m.get(id) ?? `#${id}` : '—');
  const meta = new Date(game.gameCreation + CN).toISOString().slice(0, 16).replace('T', ' ');
  const teams = teamsOf(game);
  const label = modeOf(game).label;

  const totals = new Map();
  for (const p of game.participants ?? []) {
    const t = totals.get(p.teamId) ?? { kills: 0, damage: 0, gold: 0 };
    t.kills += p.stats?.kills ?? 0;
    t.damage += p.stats?.totalDamageDealtToChampions ?? 0;
    t.gold += p.stats?.goldEarned ?? 0;
    totals.set(p.teamId, t);
  }

  console.log(`连接：${source}`);
  console.log(`=== 对局 ${gameId} ===`);
  console.log(`${meta} · ${label}(${game.queueId}) · 时长 ${dur(game.gameDuration)} · 版本 ${game.gameVersion ?? '?'} · 地图 ${game.mapId}`);
  console.log('');
  for (const t of teams) {
    const tot = totals.get(t.teamId) ?? { kills: 0, damage: 0, gold: 0 };
    console.log(
      `队伍 ${t.teamId} ${t.win ? '（胜）' : '（负）'}：击杀 ${tot.kills} · 经济 ${k(tot.gold)} · 对英雄伤害 ${k(tot.damage)} · `
      + `塔 ${t.towerKills} · 兵营 ${t.inhibitorKills} · 小龙 ${t.dragonKills} · 大龙 ${t.baronKills} · 峡谷先锋 ${t.riftHeraldKills}`,
    );
    console.log(
      `  首杀 ${t.firstBlood ? '✓' : '✗'} · 首塔 ${t.firstTower ? '✓' : '✗'} · 首龙 ${t.firstDragon ? '✓' : '✗'} · `
      + `首大龙 ${t.firstBaron ? '✓' : '✗'} · 首兵营 ${t.firstInhibitor ? '✓' : '✗'}`,
    );
    const bans = t.bans.filter((b) => b > 0).map((b) => name(champs, b));
    if (bans.length) console.log(`  BAN：${bans.join(' / ')}`);
  }
  console.log('');

  const ordered = [...(game.participants ?? [])].sort((a, b) => a.teamId - b.teamId || a.participantId - b.participantId);
  for (const p of ordered) {
    const identity = (game.participantIdentities ?? []).find((x) => x.participantId === p.participantId)?.player ?? {};
    const s = p.stats ?? {};
    const tl = p.timeline ?? {};
    const tot = totals.get(p.teamId) ?? { kills: 1, damage: 1, gold: 1 };
    const kda = ((s.kills ?? 0) + (s.assists ?? 0)) / Math.max(1, s.deaths ?? 0);
    const itemNames = [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5]
      .filter((x) => x > 0).map((x) => name(items, x));
    const trinket = name(items, s.item6);
    const perkNames = [p.stats?.perk0, p.stats?.perk1, p.stats?.perk2, p.stats?.perk3, p.stats?.perk4, p.stats?.perk5]
      .filter((x) => x > 0).map((x) => name(perks, x));

    console.log(`▍${identity.gameName ?? '?'}#${identity.tagLine ?? ''}  ${name(champs, p.championId)} Lv.${s.champLevel ?? '?'}  ${tl.lane ?? ''}/${tl.role ?? ''}`);
    console.log(`   KDA ${s.kills}/${s.deaths}/${s.assists} (${kda.toFixed(2)}) · 参团 ${pct(((s.kills ?? 0) + (s.assists ?? 0)) / Math.max(1, tot.kills))} · 伤害 ${k(s.totalDamageDealtToChampions ?? 0)}(${pct((s.totalDamageDealtToChampions ?? 0) / Math.max(1, tot.damage))})`);
    console.log(`   经济 ${k(s.goldEarned ?? 0)}(${pct((s.goldEarned ?? 0) / Math.max(1, tot.gold))}) · 花费 ${k(s.goldSpent ?? 0)} · CS ${s.totalMinionsKilled ?? 0}+${s.neutralMinionsKilled ?? 0} · 视野 ${s.visionScore ?? 0} · 真眼 ${s.visionWardsBoughtInGame ?? 0}`);
    console.log(`   伤害构成：物理 ${k(s.physicalDamageDealtToChampions ?? 0)} / 魔法 ${k(s.magicDamageDealtToChampions ?? 0)} / 真实 ${k(s.trueDamageDealtToChampions ?? 0)}`);
    console.log(`   承伤 ${k(s.totalDamageTaken ?? 0)}（物理 ${k(s.physicalDamageTaken ?? 0)} / 魔法 ${k(s.magicalDamageTaken ?? 0)} / 真实 ${k(s.trueDamageTaken ?? 0)}）· 减伤 ${k(s.damageSelfMitigated ?? 0)} · 治疗 ${k(s.totalHeal ?? 0)} · 控制 ${((s.totalTimeCrowdControlDealt ?? 0)).toFixed(0)}s`);
    console.log(`   目标物：拆塔伤害 ${k(s.damageDealtToTurrets ?? 0)} · 目标伤害 ${k(s.damageDealtToObjectives ?? 0)} · 推塔 ${s.turretKills ?? 0} · 兵营 ${s.inhibitorKills ?? 0}`);
    console.log(`   多杀：双 ${s.doubleKills ?? 0} 三 ${s.tripleKills ?? 0} 四 ${s.quadraKills ?? 0} 五 ${s.pentaKills ?? 0} · 最大连杀 ${s.largestKillingSpree ?? 0} · 最长存活 ${s.longestTimeSpentLiving ?? 0}s · 最大暴击 ${s.largestCriticalStrike ?? 0}`);
    console.log(`   出装：${itemNames.join(' / ') || '—'}${trinket && trinket !== '—' ? ` （饰品 ${trinket}）` : ''}`);
    console.log(`   召唤师技能：${[p.spell1Id, p.spell2Id].filter((x) => x > 0).map((x) => name(spells, x)).join(' / ')}`);
    console.log(`   符文：${name(perks, s.perkPrimaryStyle)} / ${name(perks, s.perkSubStyle)} · ${perkNames.join(' / ')}`);
    if (s.playerAugment1) {
      const aug = [1, 2, 3, 4, 5, 6].map((i) => s[`playerAugment${i}`]).filter((x) => x > 0);
      console.log(`   海克斯强化：${aug.length} 个（id ${aug.join(',')}）`);
    }
    const goldCurve = tl.goldPerMinDeltas ?? {};
    const curve = Object.entries(goldCurve).slice(0, 5).map(([band, v]) => `${band}:${k(v)}`).join(' ');
    if (curve) console.log(`   经济曲线：${curve}`);
    console.log('');
  }

  console.log(`官方评分 totalPlayerScore：${ordered.map((p) => `${(game.participantIdentities ?? []).find((x) => x.participantId === p.participantId)?.player?.gameName ?? '?'}=${p.stats?.totalPlayerScore ?? '-'}`).join('  ')}`);
  console.log(`原始 payload（全部 118 个字段）：${rawFile}`);
}

/**
 * 悲情英雄尽力局文案
 *   node src/index.mjs story 901121026061 --player "急了就点一下赞" --tone 4
 *   node src/index.mjs story 901121026061            # 自动挑尽力局指数最高的人
 */
async function story(gameIdArg) {
  const gameId = Number(gameIdArg);
  if (!gameId) throw new Error('用法：node src/index.mjs story <gameId> [--player 名字] [--tone 1-5] [--out 文件] [--json]');

  const dataDir = path.join(ROOT, 'data', 'pull');
  const { game, timeline } = loadGameData(dataDir, gameId);
  const assets = loadAssets(dataDir);

  const playerKey = typeof opt('player') === 'string' ? opt('player') : null;
  const tone = Number(opt('tone', 3)) || 3;

  let facts;
  let score;
  if (playerKey) {
    facts = buildFacts(game, timeline, playerKey, assets);
    score = carryScore(facts);
  } else {
    let best = null;
    for (const it of game.participantIdentities ?? []) {
      const f = buildFacts(game, timeline, it.player.puuid, assets);
      const s = carryScore(f);
      if (!best || s > best.score) best = { facts: f, score: s };
    }
    facts = best.facts;
    score = best.score;
  }

  if (flag('json')) {
    console.log(JSON.stringify({ score, facts }, null, 2));
    return;
  }

  const text = renderStory(facts, { tone });
  console.log(`尽力局指数：${score}/100　${facts.player.name} ${facts.player.champion} ${facts.player.k}/${facts.player.deaths}/${facts.player.assists}（${facts.win ? '胜' : '负'}）`);
  console.log('');
  console.log(text);

  const out = typeof opt('out') === 'string' ? opt('out') : null;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text + '\n');
    console.log(`\n已写入 ${out}`);
  }
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

async function daemon() {
  const config = loadConfig();
  console.log(`守护模式启动：每天 ${config.schedule} 生成并发送到「${config.group}」`);

  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date();
    const todayLabel = labelOf(dayStartCN(Date.now()));
    const state = readState();
    if (state.lastRunDate === todayLabel) return;

    const nowMin = now.getHours() * 60 + now.getMinutes();
    const schedMin = minutesOf(config.schedule);
    const recentAttempt = state.lastAttemptAt && Date.now() - state.lastAttemptAt < 10 * 60_000;

    // 到点执行；或启动时已过点、两小时内且距上次尝试超过 10 分钟（补发 + 失败重试）
    const due =
      nowMin === schedMin ||
      (nowMin > schedMin && nowMin < schedMin + 120 && !recentAttempt);
    if (!due) return;

    running = true;
    writeState({ ...state, lastAttemptAt: Date.now(), lastAttemptDate: todayLabel });
    try {
      await runOnce({});
    } catch (e) {
      console.error(`[${new Date().toISOString()}] 执行失败：${e.message}`);
    } finally {
      running = false;
    }
  };

  await tick();
  setInterval(tick, 30_000);
}

(mode === 'daemon' ? daemon() : mode === 'probe' ? probe() : mode === 'game' ? inspect(argv[1]) : mode === 'story' ? story(argv[1]) : runOnce({
  dateLabel: typeof opt('date') === 'string' ? opt('date') : undefined,
  dryRun: flag('dry-run'),
  force: flag('force'),
})).catch((e) => {
  console.error(`✗ ${e?.message ?? e}`);
  process.exit(1);
});
