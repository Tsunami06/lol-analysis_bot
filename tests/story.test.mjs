import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData, loadAssets, buildFacts, carryScore, renderStory } from '../src/story.mjs';

const { game, timeline } = loadGameData('data/pull', 901121026061);
const assets = loadAssets('data/pull');
const facts = buildFacts(game, timeline, '急了就点一下赞', assets);

test('尽力局指数', () => {
  assert.equal(carryScore(facts), 95);
});

test('分路识别（LCU lane/role 不可靠时靠双招与位置兜底）', () => {
  assert.equal(facts.player.role, 'ADC');
  const roles = Object.fromEntries(facts.mates.map((m) => [m.name, m.role]));
  assert.equal(roles['成都夺冠'], '上单');
  assert.equal(roles['Bot'], '打野');
  assert.equal(roles['呆呆恶霸'], '中单');
  assert.equal(roles['蹦么儿'], '辅助');
});

test('高地连杀与拆塔', () => {
  assert.ok(facts.timeline.bestClutch, '应识别出少打多的连杀爆发');
  assert.equal(facts.timeline.bestClutch.kills.length, 3);
  assert.equal(facts.timeline.nexusTurrets, 2);
});

test('文案包含关键事实', () => {
  const text = renderStory(facts, { tone: 4 });
  assert.match(text, /23\/7\/14/);
  assert.match(text, /双子塔/);
  assert.match(text, /尽力局/);
  assert.doesNotMatch(text, /undefined/);
});
