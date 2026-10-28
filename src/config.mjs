import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  group: '开黑群',
  schedule: '12:00',
  tone: 3,
  sendMode: 'wechat', // wechat | dry-run
  wechatDelayMs: 600,
  playersFile: path.join(ROOT, 'config', 'players.json'),
  count: 100,
  deepScan: false,
  lockfile: null,
  lcuPort: null,
  lcuToken: null,
};

function readJson(file) {
  // 兼容记事本 / PowerShell 写出的 UTF-8 BOM
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

export function loadConfig(file = process.env.BOT_CONFIG || path.join(ROOT, 'config', 'config.json')) {
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  const cfg = { ...DEFAULTS, ...readJson(file) };
  if (cfg.playersFile && !path.isAbsolute(cfg.playersFile)) {
    cfg.playersFile = path.join(ROOT, cfg.playersFile);
  }
  return cfg;
}

export function loadPlayers(file) {
  const p = file || path.join(ROOT, 'config', 'players.json');
  if (!fs.existsSync(p)) throw new Error(`缺少玩家配置：${p}（可从 players.example.json 复制）`);
  const list = readJson(p);
  if (!Array.isArray(list) || !list.length) throw new Error('players.json 必须是非空数组');
  return list
    .map((x) => ({ nickname: x.nickname || x.name, summoner: x.summoner || x.riotId || '' }))
    .filter((x) => x.nickname && x.summoner);
}
