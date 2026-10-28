/**
 * LCU 客户端：发现、连接、常用接口
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

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

export function parseLockfile(raw) {
  const parts = String(raw).trim().split(':');
  if (parts.length < 5) throw new Error('lockfile 格式异常');
  const [, pid, port, password, protocol] = parts;
  return { port: Number(port), password, protocol: protocol || 'https', pid: Number(pid) };
}

function readLockfile(p) {
  return { ...parseLockfile(String(fs.readFileSync(p, 'utf8'))), source: `lockfile: ${p}` };
}

function fromProcess() {
  if (process.platform !== 'win32') return null;
  try {
    const cmd =
      '-NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \\"Name=\'LeagueClientUx.exe\'\\" | Select-Object -First 1; if ($p) { $p.CommandLine }"';
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

function scanKnown() {
  for (const dir of CANDIDATE_DIRS) {
    try {
      const p = path.join(dir, 'lockfile');
      if (fs.existsSync(p)) return readLockfile(p);
    } catch {
      /* 跳过 */
    }
  }
  return null;
}

function deepScan() {
  const skip = new Set([
    'windows', 'program files', 'program files (x86)', '$recycle.bin',
    'system volume information', 'programdata', 'appdata', 'node_modules',
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
          /* 不是 */
        }
      } else if (e.isDirectory() && depth < 4 && !skip.has(e.name.toLowerCase())) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

function httpClient({ port, password, protocol = 'https' }) {
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  const auth = 'Basic ' + Buffer.from(`riot:${password}`).toString('base64');
  return (pathname) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1', port, path: pathname, method: 'GET',
          protocol: `${protocol}:`,
          headers: { Authorization: auth, Accept: 'application/json' },
          agent, timeout: 15_000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              const err = new Error(`HTTP ${res.statusCode} ${pathname} :: ${body.slice(0, 160)}`);
              err.status = res.statusCode;
              return reject(err);
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
}

export async function connect({ lockfile, port, token, deep = false } = {}) {
  const candidates = [];
  const seen = new Set();
  const push = (c) => {
    if (!c?.port || !c?.password || seen.has(c.port)) return;
    seen.add(c.port);
    candidates.push(c);
  };

  if (port && token) push({ port: Number(port), password: token, protocol: 'https', source: '命令行参数' });
  if (lockfile) push(readLockfile(lockfile));
  push(fromProcess());
  push(scanKnown());
  if (deep) push(deepScan());

  if (!candidates.length) {
    throw new Error(
      '没有找到英雄联盟客户端：确认已登录；或用 --lockfile 指定；或加 --deep 全盘扫描',
    );
  }

  let lastError;
  for (const c of candidates) {
    const get = httpClient(c);
    try {
      const me = await get('/lol-summoner/v1/current-summoner');
      return { get, me, source: c.source, port: c.port };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`候选端口都连不上：${lastError?.message ?? '未知错误'}`);
}

export async function findSummoner(get, name) {
  const tries = [name];
  if (name.includes('#')) tries.push(name.split('#')[0]);
  for (const n of tries) {
    try {
      const s = await get(`/lol-summoner/v1/summoners?name=${encodeURIComponent(n)}`);
      if (s?.puuid) return s;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  return null;
}

export async function fetchMatches(get, puuid, count = 100) {
  const res = await get(
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=${count}`,
  );
  return Array.isArray(res?.games) ? res.games : (res?.games?.games ?? []);
}

/** 英雄 id -> 中文名（取客户端本地化数据，国服即中文） */
export async function championMap(get) {
  try {
    const list = await get('/lol-game-data/assets/v1/champion-summary.json');
    const map = new Map();
    for (const c of list ?? []) {
      if (c?.id && c.id > 0) map.set(c.id, c.name);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** 海克斯强化 id -> 名称 */
export async function augmentMap(get) {
  try {
    const list = await get('/lol-game-data/assets/v1/cherry-augments.json');
    const map = new Map();
    for (const a of list ?? []) {
      if (a?.id) map.set(a.id, a.name ?? a.nameTRA ?? `#${a.id}`);
    }
    return map;
  } catch {
    return new Map();
  }
}
