import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {deliveryReports} from '../scripts/performance.mjs';
import {persianMonth} from '../scripts/persian-month.mjs';
test('Aban starts at Tehran midnight and historical Mehr credit excludes monthly and daily counts',()=>{
 const period=persianMonth(new Date('2026-10-28T09:00:00Z'));
 assert.equal(period.start,'2026-10-22T20:30:00.000Z');
 assert.equal(period.end,'2026-11-21T20:30:00.000Z');
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE stage_completions(user_id INTEGER,chapter_id INTEGER,stage TEXT,completed_at TEXT);CREATE TABLE historical_stage_credits(user_id INTEGER,chapter_id INTEGER,stage TEXT)');
 db.exec("INSERT INTO historical_stage_credits VALUES(1,1,'typing'),(1,2,'typing');INSERT INTO stage_completions VALUES(1,2,'typing','2026-10-28T08:00:00Z')");
 const report=deliveryReports(db,new Date('2026-10-28T09:00:00Z'));
 assert.equal(report.members.get(1).total,2);assert.equal(report.members.get(1).last30Days,1);assert.equal(report.daily.reduce((n,d)=>n+d.count,0),1);db.close();
});
test('delivery ranks, Tehran calendar boundaries, zero days and unique revisions',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE stage_completions(user_id INTEGER,chapter_id INTEGER,stage TEXT,completed_at TEXT,PRIMARY KEY(chapter_id,stage))');
 const put=db.prepare('INSERT OR REPLACE INTO stage_completions VALUES(?,?,?,?)');
 const reference=new Date('2026-10-27T12:00:00Z');
 for(const [user,count] of [[1,4],[2,5],[3,10],[4,15],[5,20],[6,25]])for(let n=1;n<=count;n++)put.run(user,user*100+n,'clean','2026-10-26T22:00:00Z');
 put.run(2,201,'clean','2026-10-26T22:00:00Z');
 put.run(1,999,'translation','2026-09-27T20:29:59Z');
 const report=deliveryReports(db,reference);
 assert.deepEqual([1,2,3,4,5,6].map(id=>report.members.get(id).rank),[4,4,3,2,1,1]);
 assert.equal(report.members.get(1).total,5);assert.equal(report.members.get(1).last30Days,4);
 assert.equal(report.daily.length,30);assert.equal(report.daily[0].date,'2026-09-28');assert.equal(report.daily.at(-1).count,79);
 assert.equal(report.daily.filter(d=>d.count===0).length,29);db.close();
});
