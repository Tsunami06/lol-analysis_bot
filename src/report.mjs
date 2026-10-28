/**
 * 文本战报渲染（微信纯文本，不用 Markdown）
 */

function fmtDamage(n) {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function iconFor(score) {
  if (score >= 80) return '🔥';
  if (score >= 65) return '👍';
  if (score >= 45) return '😐';
  return '💀';
}

function fmtTime(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

function championName(champions, id) {
  return champions?.get?.(id) ?? `#${id}`;
}

function narrate(titles, tone) {
  if (!titles) return '';
  const mvp = titles.mvp?.nickname ?? '';
  const worst = titles.worst?.nickname;
  const feeder = titles.feeder;

  if (!worst) {
    return tone <= 2 ? `${mvp} 今天一个人在战斗，辛苦。` : `${mvp} 单排体验卡，队友呢？`;
  }

  if (tone <= 2) {
    return `今天 ${mvp} 状态最好，${worst} 也别灰心，明天继续。`;
  }
  if (tone === 3) {
    const base = `${mvp} 在 C，${worst} 在逛街。`;
    return feeder && feeder.deathsPerGame >= 6 ? `${base}${feeder.nickname} 的闪现大概用来赶路了。` : base;
  }
  const base = `${mvp} 打得像代练，${worst} 像代练接的单子。`;
  return feeder && feeder.deathsPerGame >= 6 ? `${base}${feeder.nickname} 这死亡率，建议改行当提款机。` : base;
}

export function renderReport({ dateLabel, analysis, champions, augments, tone = 3 }) {
  const { games, standings, titles, highlights } = analysis;

  if (!games.length) {
    return `【${dateLabel} 开黑战报】\n昨天群里没人开黑，战绩板空空如也。`;
  }

  const wins = games.filter((g) => g.win).length;
  const winRate = Math.round((wins / games.length) * 100);
  const lines = [];

  lines.push(`【${dateLabel} 开黑战报】`);
  lines.push(`昨日 ${games.length} 局 · ${wins} 胜 ${games.length - wins} 负 · 胜率 ${winRate}%`);
  lines.push('');

  const buckets = [
    { key: 'rift', title: '峡谷五黑' },
    { key: 'aram', title: '大乱斗' },
  ];

  for (const bucket of buckets) {
    const list = games.filter((g) => g.mode.bucket === bucket.key);
    if (!list.length) continue;
    const bWins = list.filter((g) => g.win).length;
    lines.push(`▍${bucket.title} · ${list.length} 局 ${bWins} 胜`);

    for (const g of list) {
      lines.push(`  ${fmtTime(g.creation)} · ${g.win ? '胜' : '负'} · ${fmtDuration(g.duration)}`);
      const rows = [...g.rows].sort((a, b) => b.score - a.score);
      rows.forEach((r, i) => {
        const icon = i === 0 ? '🔥' : i === rows.length - 1 ? '💀' : r.score >= 50 ? '👍' : '😐';
        const extra =
          bucket.key === 'aram'
            ? ` · 承伤 ${fmtDamage(r.damageTaken)}`
            : ` · 参团 ${pct(r.participation)}`;
        lines.push(
          `    ${icon} ${r.nickname} · ${championName(champions, r.championId)} · ` +
            `${r.kills}/${r.deaths}/${r.assists} · 伤害 ${fmtDamage(r.damage)}(${pct(r.damageShare)})${extra} · 评分 ${r.score}`,
        );

        if (bucket.key === 'aram' && r.augments?.length) {
          const names = r.augments.map((id) => augments?.get?.(id) ?? `#${id}`);
          const shown = names.slice(0, 3).join(' / ');
          const more = names.length > 3 ? ` +${names.length - 3}` : '';
          lines.push(`       强化：${shown}${more}`);
        }
      });
    }
    lines.push('');
  }

  if (standings.length) {
    if (titles.mvp) {
      lines.push(
        `🏅 今日大腿：${titles.mvp.nickname}（均分 ${Math.round(titles.mvp.avgScore)}，伤害占比 ${pct(titles.mvp.avgDamageShare)}）`,
      );
    }
    if (titles.worst) {
      lines.push(`💀 今日战犯：${titles.worst.nickname}（均分 ${Math.round(titles.worst.avgScore)}）`);
    }
    if (titles.feeder && titles.feeder.deathsPerGame >= 4) {
      lines.push(`🩸 送财童子：${titles.feeder.nickname}（场均 ${titles.feeder.deathsPerGame.toFixed(1)} 死）`);
    }
    if (highlights?.length) {
      lines.push(`✨ 名场面：${highlights.map((h) => `${h.nickname} ${h.text}`).join(' · ')}`);
    }
    lines.push('');
    lines.push(`一句话：${narrate(titles, tone)}`);
  }

  return lines.join('\n');
}
