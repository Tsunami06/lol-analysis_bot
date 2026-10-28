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
import { connect, championMap } from './lcu.mjs';
import { resolvePlayers, collectWindow } from './collect.mjs';
import { analyze } from './analyze.mjs';
import { renderReport } from './report.mjs';
import { sendToWechat } from './publish.mjs';

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
    log,
  });

  const champions = await championMap(get);
  const analysis = analyze(games);
  const text = renderReport({
    dateLabel: prettyLabel(dateLabel),
    analysis,
    champions,
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
  console.log(`✓ 已连接（${source}）`);
  console.log(`  账号：${me.gameName ?? me.displayName}#${me.tagLine ?? ''}  Lv.${me.summonerLevel ?? '?'}`);
  console.log(`  英雄数据：${champions.size} 个`);
  const players = loadPlayers(config.playersFile);
  const resolved = await resolvePlayers(get, players, console.log);
  console.log(`  解析成功：${resolved.length}/${players.length}`);
  console.log(`  sidecar：${config.sendMode}（群「${config.group}」）`);
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

(mode === 'daemon' ? daemon() : mode === 'probe' ? probe() : runOnce({
  dateLabel: typeof opt('date') === 'string' ? opt('date') : undefined,
  dryRun: flag('dry-run'),
  force: flag('force'),
})).catch((e) => {
  console.error(`✗ ${e?.message ?? e}`);
  process.exit(1);
});
