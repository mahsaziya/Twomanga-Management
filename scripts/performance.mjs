// A delivered stage counts once, even if its file was revised or uploaded again.
export function deliveryReports(db, reference = new Date()) {
  const day = date => new Date(date.getTime() + 210 * 60000).toISOString().slice(0, 10);
  const end = day(reference), start = day(new Date(reference.getTime() - 29 * 86400000));
  const rows = db.prepare(`SELECT user_id userId,chapter_id chapterId,stage,completed_at completedAt FROM stage_completions`).all();
  const members = new Map(), daily = new Map();
  for (let i = 29; i >= 0; i--) daily.set(day(new Date(reference.getTime() - i * 86400000)), 0);
  for (const row of rows) {
    if (!row.completedAt || !Number.isFinite(Date.parse(row.completedAt)) || Date.parse(row.completedAt) > reference.getTime()) continue;
    const date = day(new Date(row.completedAt));
    if (!members.has(row.userId)) members.set(row.userId, { total: 0, last30Days: 0, rank: 5 });
    const report = members.get(row.userId); report.total++;
    if (date >= start && date <= end) { report.last30Days++; daily.set(date, daily.get(date) + 1); }
    report.rank = Math.max(1, 5 - Math.floor(report.total / 5));
  }
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='historical_stage_credits'").get()){
    const historical=db.prepare(`SELECT h.user_id userId FROM historical_stage_credits h WHERE NOT EXISTS(SELECT 1 FROM stage_completions c WHERE c.chapter_id=h.chapter_id AND c.stage=h.stage)`).all();
    for(const row of historical){if(!members.has(row.userId))members.set(row.userId,{total:0,last30Days:0,rank:5});const report=members.get(row.userId);report.total++;report.rank=Math.max(1,5-Math.floor(report.total/5));}
  }
  return { members, daily: [...daily].map(([date, count]) => ({ date, count })) };
}
