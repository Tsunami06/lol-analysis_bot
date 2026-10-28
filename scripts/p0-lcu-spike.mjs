#!/usr/bin/env node
/**
 * P0 验证脚本：国服 LCU 连通性 + 昨日对局拉取
 *
 * 目标（对应技术方案里的 P0 清单）：
 *   1. 找到 lockfile / 进程参数，连上本地客户端
 *   2. 按「名字#编号」解析出 puuid
 *   3. 拉取每个玩家最近对局，筛出「昨天」窗口
 *   4. 找出同一局 gameId，确认是否同队、几人同队
 *   5. 打印队列号分布（用来确认「海克斯大乱斗」的 queueId）
 *   6. 原始 JSON 落盘，便于离线分析
 *
 * 无第三方依赖，Node >= 20。
 *
 * 用法：
 *   node scripts/p0-lcu-spike.mjs                     # 自动探测，用 config/players.json
 *   node scripts/p0-lcu-spike.mjs --probe             # 只验证连通性
 *   node scripts/p0-lcu-spike.mjs --lockfile "D:\\...\\lockfile"
 *   node scripts/p0-lcu-spike.mjs --deep              # 全盘兜底扫描（慢）
 *   node scripts/p0-lcu-spike.mjs --date 2026-10-27   # 指定某天
 *   node scripts/p0-lcu-spike.mjs --selftest          # 不连客户端，自检
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CN_OFFSET = 8 * 3600 * 1000; // 国服固定 UTC+8，无夏令时

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
function arg(name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const OPT = {
  lockfile: arg('lockfile') || arg('lock'),
  port: arg('port'),
  token: arg('token'),
  players: arg('players', path.join(ROOT, 'config', 'players.json')),
  date: arg('date'),
  count: Number(arg('count', 100)),
  out: arg('out', path.join(ROOT, 'fixtures')),
  deep: Boolean(arg('deep', false)),
  probe: Boolean(arg('probe', false)),
  selftest: Boolean(arg('selftest', false)),
};

// ---------------------------------------------------------------- 时间

/** 某个时间戳所在「国服自然日」的 00:00（返回 UTC 毫秒） */
function dayStartCN(ts) {
  const d = new Date(ts + CN_OFFSET);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - CN_OFFSET;
}

function fmtCN(ts, withDate = true) {
  const iso = new Date(ts + CN_OFFSET).toISOString();
  return withDate ? iso.slice(5, 16).replace('T', ' ') : iso.slice(11, 16);
}

function resolveWindow() {
  if (OPT.date) {
    const start = Date.parse(`${OPT.date}T00:00:00+08:00`);
    if (Number.isNaN(start)) throw new Error(`--date 格式应为 YYYY-MM-DD，收到 ${OPT.date}`);
    return { start, end: start + 86400_000, label: OPT.date };
  }
  const today = dayStartCN(Date.now());
  return { start: today - 86400_000, end: today, label: fmtCN(today - 86400_000).slice(0, 10) };
}

// ---------------------------------------------------------------- LCU 客户端

function createClient({ port, password, protocol = 'https' }) {
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  const auth = 'Basic ' + Buffer.from(`riot:${password}`).toString('base64');

  return function get(pathname) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port,
          path: pathname,
          method: 'GET',
          protocol: `${protocol}:`,
          headers: { Authorization: auth, Accept: 'application/json' },
          agent,
          timeout: 15_000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              const err = new Error(`HTTP ${res.statusCode} ${pathname} :: ${body.slice(0, 160)}`);
              err.status = res.statusCode;
              reject(err);
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      req.end();
    });
  };
}

// ---------------------------------------------------------------- 定位客户端

const CANDIDATE_DIRS = [
  'C:\\Riot Games\\League of Legends',
  'C:\\Program Files\\Riot Games\\League of Legends',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends',
  'C:\\WeGameApps\\英雄联盟',
  'D:\\WeGameApps\\英雄联盟',
  'E:\\WeGameApps\\英雄联盟',
  'F:\\WeGameApps\\英雄联盟',
  'D:\\WeGameApps\\League of Legends',
  'E:\\WeGameApps\\League of Legends',
  'C:\\Program Files\\Tencent\\League of Legends',
  'C:\\Program Files (x86)\\Tencent\\League of Legends',
  'D:\\Tencent\\League of Legends',
  'D:\\Games\\League of Legends',
  'E:\\Games\\League of Legends',
];

function parseLockfileContent(raw) {
  const parts = String(raw).trim().split(':');
  if (parts.length < 5) throw new Error('lockfile 格式异常');
  const [, pid, port, password, protocol] = parts;
  return { port: Number(port), password, protocol: protocol || 'https', pid: Number(pid) };
}

function readLockfile(p) {
  return { ...parseLockfileContent(fs.readFileSync(p, 'utf8')), source: `lockfile: ${p}` };
}

/** 从运行中的 LeagueClientUx.exe 命令行里拿端口与 token（最可靠） */
function fromProcessCmdline() {
  if (process.platform !== 'win32') return null;
  try {
    const cmd = [
      '-NoProfile',
      '-Command',
      '$p = Get-CimInstance Win32_Process -Filter "Name=\'LeagueClientUx.exe\'" | Select-Object -First 1;',
      'if ($p) { $p.CommandLine }',
    ].join(' ');
    const line = execFileSync('powershell.exe', cmd, {
      encoding: 'utf8',
      timeout: 25_000,
      windowsHide: true,
    }).trim();
    if (!line) return null;
    const port = /--app-port=(\d+)/.exec(line)?.[1];
    const token = /--remoting-auth-token=([\w-]+)/.exec(line)?.[1];
    if (!port || !token) return null;
    return { port: Number(port), password: token, protocol: 'https', source: '客户端进程参数' };
  } catch {
    return null;
  }
}

function scanKnownDirs() {
  for (const dir of CANDIDATE_DIRS) {
    const p = path.join(dir, 'lockfile');
    try {
      if (fs.existsSync(p)) return readLockfile(p);
    } catch {
      /* 无权限，跳过 */
    }
  }
  return null;
}

/** 兜底：按目录层级广度扫描各盘（跳过系统目录） */
function deepScan() {
  const skip = new Set([
    'windows',
    'program files',
    'program files (x86)',
    '$recycle.bin',
    'system volume information',
    'programdata',
    'appdata',
    'node_modules',
  ]);
  const queue = [];
  for (const letter of 'CDEFGH') {
    try {
      fs.accessSync(`${letter}:\\`);
      queue.push({ dir: `${letter}:\\`, depth: 0 });
    } catch {
      /* 盘不存在 */
    }
  }

  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === 'lockfile') {
        try {
          const lf = readLockfile(full);
          if (lf.port) return lf;
        } catch {
          /* 不是客户端 lockfile */
        }
      } else if (e.isDirectory() && depth < 4 && !skip.has(e.name.toLowerCase())) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

async function connect() {
  const candidates = [];
  const seen = new Set();
  const push = (c) => {
    if (!c?.port || !c?.password || seen.has(c.port)) return;
    seen.add(c.port);
    candidates.push(c);
  };

  if (OPT.port && OPT.token) {
    push({ port: Number(OPT.port), password: OPT.token, protocol: 'https', source: '命令行参数' });
  }
  if (OPT.lockfile) {
    try {
      push(readLockfile(OPT.lockfile));
    } catch (e) {
      console.error(`✗ 读取 --lockfile 失败：${e.message}`);
    }
  }
  push(fromProcessCmdline());
  push(scanKnownDirs());
  if (OPT.deep) push(deepScan());

  if (!candidates.length) {
    throw new Error(
      [
        '没有找到英雄联盟客户端。',
        '  · 确认客户端已启动并登录（不是停在登录框）',
        '  · 国服请从 WeGame 启动，客户端目录下应有 lockfile',
        '  · 已知装在别处：--lockfile "D:\\路径\\lockfile"',
        '  · 实在找不到：--deep（会扫全盘，慢）',
      ].join('\n'),
    );
  }

  let lastError;
  for (const c of candidates) {
    const get = createClient(c);
    try {
      const me = await get('/lol-summoner/v1/current-summoner');
      return { get, me, conn: c };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`找到 ${candidates.length} 个候选端口，但都连不上：${lastError?.message ?? '未知错误'}`);
}

// ---------------------------------------------------------------- 业务

const QUEUE_NAMES = {
  0: '自定义',
  400: '匹配(征召)',
  420: '单双排',
  430: '匹配(盲选)',
  440: '灵活排位',
  450: '极地大乱斗',
  700: '冠军杯',
  720: '冠军杯大乱斗',
  830: '人机(入门)',
  840: '人机(新手)',
  850: '人机(一般)',
  900: '无限火力',
  1020: '克隆大作战',
  1300: '极限闪击',
  1400: '终极魔典',
  1700: '斗魂竞技场',
  1900: '无限乱斗',
  2000: '新手教程',
  2300: '斗魂竞技场(2v2)',
};

function queueLabel(id) {
  return QUEUE_NAMES[id] ? `${QUEUE_NAMES[id]}(${id})` : `未知模式(${id})`;
}

function loadPlayers() {
  const p = OPT.players;
  if (!fs.existsSync(p)) {
    console.log(`! 没找到 ${p}，本次只验证当前登录账号`);
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('players.json 应为数组');
  return raw
    .map((x) => ({
      nickname: x.nickname || x.name,
      summoner: x.summoner || x.riotId || '',
    }))
    .filter((x) => x.summoner);
}

async function resolvePlayer(get, player) {
  const candidates = [player.summoner];
  if (player.summoner.includes('#')) candidates.push(player.summoner.split('#')[0]);

  for (const name of candidates) {
    try {
      const s = await get(`/lol-summoner/v1/summoners?name=${encodeURIComponent(name)}`);
      if (s?.puuid) {
        return {
          ...player,
          puuid: s.puuid,
          gameName: s.gameName || s.displayName,
          tagLine: s.tagLine,
          level: s.summonerLevel,
        };
      }
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  return { ...player, error: '查无此人' };
}

async function fetchMatches(get, puuid, count) {
  const res = await get(
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${count}`,
  );
  const games = Array.isArray(res?.games) ? res.games : (res?.games?.games ?? []);
  return games;
}

/**
 * 在 participantIdentities 里定位某个玩家。
 * 优先 puuid；部分客户端版本不返回 puuid，退化为按 名字#编号 / 名字 匹配。
 */
function findIdentity(game, player) {
  const ids = game.participantIdentities ?? [];
  const puuid = typeof player === 'string' ? player : player.puuid;
  if (puuid) {
    const hit = ids.find((x) => x.player?.puuid === puuid);
    if (hit) return hit;
  }
  if (typeof player === 'string') return null;

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

function teamIdOf(game, player) {
  const identity = findIdentity(game, player);
  if (!identity) return null;
  const p = (game.participants ?? []).find((x) => x.participantId === identity.participantId);
  return p?.teamId ?? null;
}

function statLine(game, player) {
  const identity = findIdentity(game, player);
  if (!identity) return null;
  const p = (game.participants ?? []).find((x) => x.participantId === identity.participantId);
  if (!p?.stats) return null;
  const s = p.stats;
  return {
    championId: p.championId,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    win: s.win,
    damage: s.totalDamageDealtToChampions,
    gold: s.goldEarned,
    cs: s.totalMinionsKilled + (s.neutralMinionsKilled ?? 0),
    vision: s.visionScore,
  };
}

// ---------------------------------------------------------------- 自检

function selftest() {
  const failures = [];
  const check = (name, actual, expected) => {
    if (actual !== expected) failures.push(`${name}: 期望 ${expected}，实际 ${actual}`);
    else console.log(`  ✓ ${name}`);
  };

  // 2026-10-27 12:00 (+08) 所在自然日 = 2026-10-26T16:00:00Z（即北京时间 10-27 00:00）
  const noon = Date.parse('2026-10-27T12:00:00+08:00');
  check('dayStartCN 落在当天 00:00', new Date(dayStartCN(noon)).toISOString(), '2026-10-26T16:00:00.000Z');
  check('fmtCN(带日期)', fmtCN(noon), '10-27 12:00');

  const lf = parseLockfileContent('LeagueClient:1234:55555:abcDEF123:https');
  check('lockfile 端口', lf.port, 55555);
  check('lockfile 密码', lf.password, 'abcDEF123');

  const w = (() => {
    const old = OPT.date;
    OPT.date = '2026-10-27';
    const r = resolveWindow();
    OPT.date = old;
    return r;
  })();
  check('--date 窗口起点', new Date(w.start).toISOString(), '2026-10-26T16:00:00.000Z');
  check('--date 窗口长度', w.end - w.start, 86400_000);

  if (failures.length) {
    console.error('\n自检失败：');
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('\n自检通过。');
}

// ---------------------------------------------------------------- 主流程

async function main() {
  if (OPT.selftest) return selftest();

  const window = resolveWindow();
  console.log('==============================================');
  console.log(' P0 · 国服 LCU 验证');
  console.log(` 统计窗口：${fmtCN(window.start)} ~ ${fmtCN(window.end)}（北京时间）`);
  console.log('==============================================\n');

  const { get, me, conn } = await connect();
  console.log(`✓ 已连接客户端（${conn.source}，端口 ${conn.port}）`);

  let version = '';
  try {
    version = String(await get('/lol-patch/v1/game-version'));
  } catch {
    /* 非关键 */
  }
  console.log(`  当前账号：${me.gameName ?? me.displayName}#${me.tagLine ?? ''}  等级 ${me.summonerLevel ?? '?'}`);
  if (version) console.log(`  客户端版本：${version}`);

  if (OPT.probe) {
    console.log('\nprobe 完成，连通性正常。');
    return;
  }

  // ---- 解析玩家
  const configured = loadPlayers();
  const players = configured.length
    ? configured
    : [
        {
          nickname: me.gameName ?? me.displayName ?? '本人',
          summoner: `${me.gameName ?? me.displayName}#${me.tagLine ?? ''}`,
          puuid: me.puuid,
        },
      ];

  console.log(`\n--- 解析玩家（${players.length}） ---`);
  const resolved = [];
  for (const p of players) {
    if (p.puuid) {
      resolved.push(p);
      console.log(`  ✓ ${p.nickname} -> ${p.summoner}`);
      continue;
    }
    const r = await resolvePlayer(get, p);
    if (r.error) {
      console.log(`  ✗ ${p.nickname} (${p.summoner}) ${r.error}`);
    } else {
      resolved.push(r);
      console.log(`  ✓ ${p.nickname} -> ${r.gameName}#${r.tagLine ?? ''}  Lv.${r.level ?? '?'}`);
    }
  }
  if (!resolved.length) throw new Error('没有任何一个玩家解析成功，检查名字#编号格式');

  // ---- 拉战绩
  console.log(`\n--- 拉取最近 ${OPT.count} 场 ---`);
  const perPlayer = new Map();
  for (const p of resolved) {
    try {
      const games = await fetchMatches(get, p.puuid, OPT.count);
      perPlayer.set(p.nickname, games);
      console.log(`  ${p.nickname}: ${games.length} 场`);
    } catch (e) {
      console.log(`  ${p.nickname}: 拉取失败 ${e.message}`);
    }
  }

  // ---- 队列分布（用于确认海克斯大乱斗 queueId）
  const queueCount = new Map();
  for (const games of perPlayer.values()) {
    for (const g of games) queueCount.set(g.queueId, (queueCount.get(g.queueId) ?? 0) + 1);
  }
  console.log('\n--- 队列号分布（近期全部对局） ---');
  for (const [id, n] of [...queueCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${queueLabel(id).padEnd(22)} ${n} 场`);
  }

  // ---- 昨日对局（按 gameId 合并）
  const byGame = new Map();
  for (const p of resolved) {
    for (const g of perPlayer.get(p.nickname) ?? []) {
      if (g.gameCreation < window.start || g.gameCreation >= window.end) continue;
      if (!byGame.has(g.gameId)) {
        byGame.set(g.gameId, { game: g, entries: [] });
      }
      byGame.get(g.gameId).entries.push({ player: p, game: g });
    }
  }

  const games = [...byGame.values()].sort((a, b) => a.game.gameCreation - b.game.gameCreation);

  console.log(`\n--- 昨日对局（${games.length} 局） ---`);
  if (!games.length) {
    console.log('  昨天没有对局记录。');
  }

  for (const { game, entries } of games) {
    const teamCount = new Map();
    const rows = [];
    for (const { player, game: g } of entries) {
      const team = teamIdOf(g, player);
      teamCount.set(team, (teamCount.get(team) ?? 0) + 1);
      const st = statLine(g, player);
      rows.push({ player, team, st });
    }

    const maxTeam = Math.max(...teamCount.values());
    const stack = maxTeam >= 5 ? '满编五黑' : maxTeam >= 3 ? `开黑(${maxTeam}人)` : '单人/路人';
    const minutes = Math.floor((game.gameDuration ?? 0) / 60);
    const seconds = (game.gameDuration ?? 0) % 60;

    console.log(
      `\n[${fmtCN(game.gameCreation)}] ${queueLabel(game.queueId)}  ${minutes}:${String(seconds).padStart(2, '0')}  ${stack}`,
    );
    for (const { player, team, st } of rows) {
      if (!st) {
        console.log(`  ${player.nickname.padEnd(8)} 数据缺失`);
        continue;
      }
      const kda = `${st.kills}/${st.deaths}/${st.assists}`;
      console.log(
        `  ${player.nickname.padEnd(8)} 队伍${team}  ${st.win ? '胜' : '负'}  英雄#${st.championId}  ${kda.padEnd(10)} 伤害 ${(st.damage ?? 0).toLocaleString()}`,
      );
    }
  }

  // ---- 落盘
  const outDir = path.join(OPT.out, window.label);
  fs.mkdirSync(outDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    window: { start: window.start, end: window.end, label: window.label },
    client: { source: conn.source, port: conn.port, version },
    me: { gameName: me.gameName, tagLine: me.tagLine, puuid: me.puuid },
    players: resolved.map((p) => ({
      nickname: p.nickname,
      summoner: p.summoner,
      puuid: p.puuid,
      gameName: p.gameName,
      tagLine: p.tagLine,
    })),
    queueDistribution: Object.fromEntries([...queueCount.entries()].sort((a, b) => b[1] - a[1])),
    games: games.map(({ game, entries }) => ({
      gameId: game.gameId,
      queueId: game.queueId,
      gameMode: game.gameMode,
      gameCreation: game.gameCreation,
      duration: game.gameDuration,
      players: entries.map(({ player }) => {
        const st = statLine(game, player);
        return {
          nickname: player.nickname,
          teamId: teamIdOf(game, player),
          ...st,
        };
      }),
    })),
  };

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  for (const p of resolved) {
    const games = perPlayer.get(p.nickname) ?? [];
    fs.writeFileSync(path.join(outDir, `raw-${sanitize(p.nickname)}.json`), JSON.stringify(games, null, 2));
  }

  console.log(`\n✓ 结果已写入 ${outDir}`);
  console.log('  把 summary.json 发出来即可确认口径与海克斯大乱斗的 queueId。');
}

function sanitize(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_');
}

main().catch((e) => {
  console.error('\n✗ ' + (e?.message ?? e));
  process.exit(1);
});
