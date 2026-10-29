import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const normalizeTitle=value=>String(value).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]/gu,'');
export function sourceUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['mangaplus.shueisha.co.jp','mangafire.to'].includes(url.hostname))throw new Error('Only the two approved HTTPS sources are allowed.');
  return url.href;
}
export function chapterNumber(value){
  const text=String(value).trim().replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if(!/^\d{1,6}(?:\.\d{1,4})?$/.test(text))throw new Error(`Invalid chapter number: ${text}`);
  return String(Number(text));
}
export function initWatch(db){
  db.exec(`PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS chapter_watch_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chapter_watch_sources(series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,url TEXT NOT NULL,title TEXT NOT NULL,PRIMARY KEY(series_id,url));
    CREATE TABLE IF NOT EXISTS chapter_watch_events(id INTEGER PRIMARY KEY,series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,number TEXT NOT NULL,source_url TEXT NOT NULL,chapter_url TEXT,observed_at TEXT NOT NULL,notified_at TEXT,recipient TEXT,message_id TEXT,UNIQUE(series_id,number));
    CREATE TABLE IF NOT EXISTS chapter_watch_runs(id INTEGER PRIMARY KEY,checked_at TEXT NOT NULL,report_json TEXT NOT NULL);`);
}
export function watchList(db){
  return {recipient:db.prepare("SELECT value FROM chapter_watch_config WHERE key='recipient'").get()?.value||null,
    sources:['https://mangaplus.shueisha.co.jp/updates','https://mangafire.to/'],
    series:db.prepare('SELECT s.id,s.title,s.is_ongo isOngoing,MAX(CAST(c.number AS REAL)) maxChapter FROM series s LEFT JOIN chapters c ON c.series_id=s.id GROUP BY s.id ORDER BY s.title').all().map(s=>({...s,mappedSources:db.prepare('SELECT url,title FROM chapter_watch_sources WHERE series_id=?').all(s.id)})),
    lastRun:db.prepare('SELECT checked_at,report_json FROM chapter_watch_runs ORDER BY id DESC LIMIT 1').get()||null};
}
export function ingest(db,observations,at=new Date().toISOString()){
  if(!Array.isArray(observations)||observations.length>500)throw new Error('Expected at most 500 observed title records.');
  const catalog=watchList(db).series;
  // Validate the entire batch before making any changes. Matching is exact after punctuation/case normalization.
  const records=observations.map(item=>{
    const work=catalog.find(s=>s.id===Number(item.seriesId));if(!work)throw new Error('Unknown local series.');
    const url=sourceUrl(item.sourceUrl),title=String(item.title||'');
    const aliases=[work.title,...work.mappedSources.filter(s=>new URL(s.url).hostname===new URL(url).hostname).map(s=>s.title)];
    if(!aliases.some(alias=>normalizeTitle(alias)===normalizeTitle(title)))throw new Error(`Title is not a verified match: ${title}`);
    if(!Array.isArray(item.chapters)||!item.chapters.length||item.chapters.length>500)throw new Error('An explicit list of observed published chapters is required.');
    const chapters=item.chapters.map(c=>({number:chapterNumber(c.number),url:c.url?sourceUrl(c.url):null}));
    if(chapters.some(c=>c.url&&new URL(c.url).hostname!==new URL(url).hostname))throw new Error('Chapter and title must belong to the same source.');
    return {work,url,title,chapters};
  });
  const inserted=[];
  const local=new Date(Date.parse(at)+210*60_000);
  const endOfMonth=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0,20,29,59,999)).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const {work,url,title,chapters} of records){
      db.prepare('INSERT OR IGNORE INTO chapter_watch_sources(series_id,url,title) VALUES(?,?,?)').run(work.id,url,title);
      for(const chapter of chapters){
        // Do not invent skipped numbers, import back-catalog chapters, or duplicate another source's release.
        if(work.maxChapter!==null&&Number(chapter.number)<=work.maxChapter)continue;
        if(db.prepare('SELECT id FROM chapters WHERE series_id=? AND CAST(number AS REAL)=?').get(work.id,Number(chapter.number)))continue;
        const result=db.prepare('INSERT INTO chapters(series_id,number,is_ongo,created_at) VALUES(?,?,?,?)').run(work.id,chapter.number,work.isOngoing?1:0,at);
        const id=Number(result.lastInsertRowid);
        for(const stage of ['translation','clean','typing'])db.prepare("INSERT INTO stages(chapter_id,stage,status) VALUES(?,?,'waiting')").run(id,stage);
        const defaults=db.prepare('SELECT d.stage,d.user_id,d.fee_cents FROM series_defaults d JOIN users u ON u.id=d.user_id WHERE d.series_id=? AND u.active=1 AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role=CASE d.stage WHEN \'translation\' THEN \'translator\' WHEN \'clean\' THEN \'cleaner\' ELSE \'typesetter\' END)').all(work.id);
        for(const owner of defaults){
          const due=work.isOngoing?new Date(Date.parse(at)+24*60*60_000).toISOString():endOfMonth;
          db.prepare('INSERT OR IGNORE INTO work_access(user_id,series_id) VALUES(?,?)').run(owner.user_id,work.id);
          db.prepare("INSERT INTO assignments(chapter_id,user_id,stage,assignment_type,fee_cents,due_at,created_at,active) VALUES(?,?,?,'fixed',?,?,?,1)").run(id,owner.user_id,owner.stage,owner.fee_cents,due,at);
          if(owner.stage!=='typing')db.prepare("UPDATE stages SET status='in_progress' WHERE chapter_id=? AND stage=?").run(id,owner.stage);
        }
        const event=db.prepare('INSERT INTO chapter_watch_events(series_id,chapter_id,number,source_url,chapter_url,observed_at) VALUES(?,?,?,?,?,?)').run(work.id,id,chapter.number,url,chapter.url,at);
        db.prepare('INSERT INTO notices(message,created_at) VALUES(?,?)').run(`چپتر ${chapter.number} از «${work.title}» در سایت مرجع پیدا و به کارها اضافه شد.`,at);
        inserted.push({eventId:Number(event.lastInsertRowid),seriesId:work.id,title:work.title,number:chapter.number,sourceUrl:url,chapterUrl:chapter.url});
      }
    }
    db.exec('COMMIT');return {added:inserted.length,chapters:inserted};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function pendingMail(db){
  return {recipient:watchList(db).recipient,events:db.prepare('SELECT e.id,e.number,e.source_url sourceUrl,e.chapter_url chapterUrl,e.observed_at observedAt,s.title FROM chapter_watch_events e JOIN series s ON s.id=e.series_id WHERE e.notified_at IS NULL ORDER BY e.id').all().map(e=>({...e,notificationKey:`two-manga-release-${e.id}`}))};
}
async function main(){
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
  const file=path.join(path.resolve(process.env.DATA_DIR||path.join(root,'data')),'team.sqlite');
  if(!existsSync(file))throw new Error('The team database does not exist.');
  const db=new DatabaseSync(file);initWatch(db);
  try{
    const [command,arg]=process.argv.slice(2);
    if(command==='list')return console.log(JSON.stringify(watchList(db),null,2));
    if(command==='ingest')return console.log(JSON.stringify(ingest(db,JSON.parse(await readFile(arg,'utf8'))),null,2));
    if(command==='pending')return console.log(JSON.stringify(pendingMail(db),null,2));
    if(command==='map'){
      const mapping=JSON.parse(await readFile(arg,'utf8'));
      if(!db.prepare('SELECT id FROM series WHERE id=?').get(Number(mapping.seriesId))||!String(mapping.title||'').trim()||String(mapping.verification||'').length<20)throw new Error('A known series and a written verification of the alternate title are required.');
      const url=sourceUrl(mapping.url);
      if(!/^\/titles\/\d+$/.test(new URL(url).pathname)&&!/^\/title\/[^/]+\/?$/.test(new URL(url).pathname))throw new Error('Mapping must use the actual title detail page, not a search or homepage.');
      db.prepare('INSERT INTO chapter_watch_sources(series_id,url,title) VALUES(?,?,?) ON CONFLICT(series_id,url) DO UPDATE SET title=excluded.title').run(Number(mapping.seriesId),url,String(mapping.title).trim());
      db.prepare('INSERT INTO chapter_watch_runs(checked_at,report_json) VALUES(?,?)').run(new Date().toISOString(),JSON.stringify({mappingVerified:mapping}));
      return console.log('Verified title mapping saved.');
    }
    if(command==='recipient'){
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(arg||''))throw new Error('A valid explicitly user-supplied destination email is required.');
      db.prepare("INSERT INTO chapter_watch_config(key,value) VALUES('recipient',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(arg);return console.log('Notification recipient saved.');
    }
    if(command==='sent'){
      const receipt=JSON.parse(await readFile(arg,'utf8')),recipient=watchList(db).recipient;
      if(!recipient||receipt.recipient!==recipient||!receipt.messageId||!Array.isArray(receipt.eventIds)||!receipt.eventIds.length)throw new Error('A verified mail delivery receipt matching the configured recipient is required.');
      db.exec('BEGIN IMMEDIATE');try{for(const id of receipt.eventIds)db.prepare('UPDATE chapter_watch_events SET notified_at=?,recipient=?,message_id=? WHERE id=? AND notified_at IS NULL').run(new Date().toISOString(),recipient,String(receipt.messageId),Number(id));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      return console.log('Delivery receipt saved.');
    }
    if(command==='record-run'){
      const report=JSON.parse(await readFile(arg,'utf8'));db.prepare('INSERT INTO chapter_watch_runs(checked_at,report_json) VALUES(?,?)').run(new Date().toISOString(),JSON.stringify(report));return console.log('Run recorded.');
    }
    throw new Error('Usage: node scripts/chapter-watch.mjs list|pending|ingest FILE|recipient EMAIL|sent RECEIPT_FILE|record-run FILE');
  }finally{db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
