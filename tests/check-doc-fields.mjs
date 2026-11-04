#!/usr/bin/env node
/**
 * 文档漂移检查：确认 docs/lcu-match-fields.md 覆盖了真实抓包里的全部 stats 字段，
 * 且分组计数加起来等于实际字段数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(ROOT, 'docs', 'lcu-match-fields.md');
const FIXTURE =
  process.env.AKARI_FIXTURES ||
  path.resolve(
    ROOT,
    '..',
    'akari',
    'src/shared/test-fixtures/api/snapshots/2026-05-16-tencent-hn10/lcu/match-history',
  );

const doc = fs.readFileSync(DOC, 'utf8');
const game = JSON.parse(
  fs.readFileSync(path.join(FIXTURE, 'games', 'q_420.json'), 'utf8'),
);

const keys = Object.keys(game.participants[0].stats);
const missing = keys.filter((k) => !doc.includes(k));

const counts = [...doc.matchAll(/### 6\.(\d+) [^（]*（(\d+)/g)]
  .filter((m) => Number(m[1]) <= 15)
  .map((m) => Number(m[2]));
const total = counts.reduce((a, b) => a + b, 0);

console.log(`stats 实际字段：${keys.length}`);
console.log(`文档分组：${counts.join(' + ')} = ${total}`);
console.log(`缺失字段：${missing.length}${missing.length ? ' → ' + missing.join(', ') : ''}`);

if (missing.length || total !== keys.length) {
  process.exitCode = 1;
}
