#!/usr/bin/env node
/**
 * 真实数据回放：用 akari 抓的国服 LCU 快照跑一遍解析 → 评分 → 渲染，
 * 不连客户端、不需要网络。
 *
 *   node tests/replay-real-fixtures.mjs             # 默认 q_2400（海克斯大乱斗）
 *   node tests/replay-real-fixtures.mjs q_420       # 指定某一局
 *   node tests/replay-real-fixtures.mjs --list      # 列出可用对局
 *
 * 数据来源：akari 仓库
 *   src/shared/test-fixtures/api/snapshots/2026-05-16-tencent-hn10/lcu/match-history
 * 可用 AKARI_FIXTURES 环境变量覆盖路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statOf } from '../src/collect.mjs';
import { analyze } from '../src/analyze.mjs';
import { renderReport } from '../src/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES =
  process.env.AKARI_FIXTURES ||
  path.resolve(
    ROOT,
    '..',
    'akari',
    'src/shared/test-fixtures/api/snapshots/2026-05-16-tencent-hn10/lcu/match-history',
  );

const argv = process.argv.slice(2);
const gamesDir = path.join(FIXTURES, 'games');

if (argv.includes('--list')) {
  for (const f of fs.readdirSync(gamesDir).filter((x) => x.endsWith('.json')).sort()) {
    const g = JSON.parse(fs.readFileSync(path.join(gamesDir, f), 'utf8'));
    console.log(
      `${f.replace('.json', '').padEnd(8)} queue=${String(g.queueId).padEnd(5)} mode=${String(g.gameMode).padEnd(12)} 人数=${g.participants.length}`,
    );
  }
  process.exit(0);
}

const key = argv.find((a) => !a.startsWith('--')) || 'q_2400';
const file = path.join(gamesDir, `${key}.json`);

if (!fs.existsSync(file)) {
  console.error(`找不到 ${file}`);
  console.error('先确认 akari 仓库在同级目录，或用 AKARI_FIXTURES 指定路径');
  process.exit(1);
}

const game = JSON.parse(fs.readFileSync(file, 'utf8'));

// 取人数最多的一队里的 5 个人，模拟“五黑”
const counts = new Map();
for (const p of game.participants) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
const teamId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

const identities = game.participantIdentities
  .filter((x) => {
    const p = game.participants.find((y) => y.participantId === x.participantId);
    return p?.teamId === teamId;
  })
  .slice(0, 5);

const players = identities.map((x) => ({
  nickname: x.player.gameName,
  summoner: `${x.player.gameName}#${x.player.tagLine ?? ''}`,
  puuid: x.player.puuid,
  gameName: x.player.gameName,
  tagLine: x.player.tagLine,
}));

const entries = players
  .map((player) => ({ player, stat: statOf(game, player) }))
  .filter((e) => e.stat);

const d = new Date(game.gameCreation + 8 * 3600 * 1000);
const dateLabel = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;

const analysis = analyze([{ game, entries }]);
const text = renderReport({
  dateLabel,
  analysis,
  champions: new Map(),
  augments: new Map(),
  tone: 3,
});

console.log(`回放 ${key}：queueId=${game.queueId} gameMode=${game.gameMode} 人数=${game.participants.length}`);
console.log(`puuid 覆盖 ${identities.filter((x) => x.player.puuid).length}/${identities.length}，统计成功 ${entries.length}/${players.length}`);
console.log('');
console.log(text);
console.log('');
console.log('注：英雄名与强化名来自客户端本地数据，回放环境没有，所以显示为 #id。');
