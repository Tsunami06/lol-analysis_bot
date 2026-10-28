/**
 * 假的 LCU 服务，仅用于本地验证 p0-lcu-spike.mjs 的请求路径、鉴权与合并逻辑。
 * 启动：node tests/mock-lcu-server.mjs
 * 固定端口 18234，token 为 test-token。
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(HERE, '..', '.tmp', 'certs');

const TOKEN = 'test-token';
const PORT = 18234;

const NAMES = ['老王#11111', '阿伟#22222', '小张#33333', '阿杰#44444', '大刘#55555'];
const PUUIDS = NAMES.map((_, i) => `puuid-${i + 1}`);

const me = {
  puuid: PUUIDS[0],
  gameName: '老王',
  tagLine: '11111',
  displayName: NAMES[0],
  summonerLevel: 312,
  summonerId: 1001,
};

function buildGame({ id, queueId, mode, creation, duration, winnerTeam }) {
  const participants = [];
  const identities = [];

  // 队伍 100 全是我们的五个人；队伍 200 是路人
  const teams = [
    { teamId: 100, puuids: PUUIDS },
    { teamId: 200, puuids: [1, 2, 3, 4, 5].map((n) => `enemy-${id}-${n}`) },
  ];

  let participantId = 1;
  for (const team of teams) {
    team.puuids.forEach((puuid, idx) => {
      const win = team.teamId === winnerTeam;
      participants.push({
        participantId,
        teamId: team.teamId,
        championId: 100 + idx + (team.teamId === 200 ? 50 : 0),
        spell1Id: 4,
        spell2Id: 14,
        stats: {
          kills: 5 + idx,
          deaths: 2 + (idx % 3),
          assists: 8 + idx,
          win,
          totalDamageDealtToChampions: 20000 + idx * 1500,
          goldEarned: 12000 + idx * 500,
          totalMinionsKilled: 150 + idx * 10,
          neutralMinionsKilled: 20,
          visionScore: 25 + idx,
        },
      });
      identities.push({
        participantId,
        player: {
          puuid,
          summonerName: team.teamId === 100 ? NAMES[idx] : `路人${participantId}`,
          gameName: team.teamId === 100 ? NAMES[idx].split('#')[0] : `路人${participantId}`,
        },
      });
      participantId += 1;
    });
  }

  return {
    gameId: id,
    gameCreation: creation,
    gameDuration: duration,
    queueId,
    gameMode: mode,
    gameType: 'MATCHED_GAME',
    mapId: 11,
    participants,
    participantIdentities: identities,
  };
}

// 时间均按 +08 计算
const GAMES = [
  // 昨天下午：五个人的灵活排位，赢了
  buildGame({
    id: 1001,
    queueId: 440,
    mode: 'CLASSIC',
    creation: Date.parse('2026-10-27T13:05:00+08:00'),
    duration: 1900,
    winnerTeam: 100,
  }),
  // 昨天晚上：海克斯大乱斗（先用 2400 占位，真实 id 由用户数据确认）
  buildGame({
    id: 1002,
    queueId: 2400,
    mode: 'ARAM',
    creation: Date.parse('2026-10-27T22:10:00+08:00'),
    duration: 1300,
    winnerTeam: 200,
  }),
  // 前天：应当被窗口过滤掉
  buildGame({
    id: 1003,
    queueId: 420,
    mode: 'CLASSIC',
    creation: Date.parse('2026-10-26T20:00:00+08:00'),
    duration: 2100,
    winnerTeam: 100,
  }),
];

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
  },
  (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1');
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload);
    };

    const expected = 'Basic ' + Buffer.from(`riot:${TOKEN}`).toString('base64');
    if (req.headers.authorization !== expected) {
      return send(401, { errorCode: 'UNAUTHORIZED' });
    }

    if (url.pathname === '/lol-summoner/v1/current-summoner') return send(200, me);

    if (url.pathname === '/lol-patch/v1/game-version') return send(200, '26.20.1');

    if (url.pathname === '/lol-game-data/assets/v1/champion-summary.json') {
      return send(200, [
        { id: -1, name: '无' },
        { id: 100, name: '阿狸' },
        { id: 101, name: '亚索' },
        { id: 102, name: '锐雯' },
        { id: 103, name: '劫' },
        { id: 104, name: '阿卡丽' },
      ]);
    }

    if (url.pathname === '/lol-summoner/v1/summoners') {
      const name = url.searchParams.get('name') ?? '';
      const idx = NAMES.indexOf(name);
      if (idx === -1) return send(404, { errorCode: 'NOT_FOUND' });
      return send(200, {
        puuid: PUUIDS[idx],
        gameName: NAMES[idx].split('#')[0],
        tagLine: NAMES[idx].split('#')[1],
        displayName: NAMES[idx],
        summonerLevel: 300 + idx,
      });
    }

    const match = /^\/lol-match-history\/v1\/products\/lol\/([^/]+)\/matches$/.exec(url.pathname);
    if (match) {
      const puuid = decodeURIComponent(match[1]);
      if (!PUUIDS.includes(puuid)) return send(404, { errorCode: 'NOT_FOUND' });
      return send(200, { games: GAMES });
    }

    send(404, { errorCode: 'NOT_FOUND', path: url.pathname });
  },
);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock LCU listening on https://127.0.0.1:${PORT} (token: ${TOKEN})`);
});
