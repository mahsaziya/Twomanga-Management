import {test} from 'node:test';
import {scryptSync} from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,readdir,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initWatch,ingest,pendingMail} from '../scripts/chapter-watch.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture=await mkdtemp(path.join(tmpdir(),'two-manga-test-'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`;
const testEnv={...process.env,TEAM_DATABASE:path.join(fixture,'team.sqlite'),TEAM_LOCAL_FILES:path.join(fixture,'uploads'),TEAM_STORAGE:'local',APP_ENV:'local',TEAM_ADMIN_USER:'admin',TEAM_ADMIN_PASSWORD:'temporary-test-password',PUBLIC_ORIGIN:''};
let ftpChild=null;
if(process.env.TEST_FTP==='1'){
 const remote=path.join(fixture,'remote');await mkdir(remote);
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const ftpPort=probe.address().port;await new Promise(r=>probe.close(r));
 ftpChild=spawn(process.env.PYTHON_BINARY,['tests/ftp-fixture.py',remote,String(ftpPort)],{cwd:root,env:{...process.env,PYTHONPATH:process.env.FTP_TEST_PYTHONPATH}});
 ftpChild.stdout.on('data',()=>{});ftpChild.stderr.on('data',()=>{});
 for(let i=0;i<100;i++){try{await new Promise((resolve,reject)=>{const c=net.connect(ftpPort,'127.0.0.1',()=>{c.destroy();resolve()});c.on('error',reject)});break;}catch{}await new Promise(r=>setTimeout(r,100));}
 Object.assign(testEnv,{TEAM_STORAGE:'ftp',FTP_HOST:'127.0.0.1',FTP_PORT:String(ftpPort),FTP_TLS:'0',FTP_USER:'fixture',FTP_PASSWORD:'temporary-ftp-test-password',FTP_ROOT:'/team-files'});
}
const php=process.env.PHP_BINARY||'php';
const setup=spawnSync(php,['scripts/setup.php'],{cwd:root,env:testEnv,encoding:'utf8'});if(setup.status!==0)throw new Error(setup.stderr||setup.error?.message||'PHP setup failed');
const child=spawn(php,['-S',`127.0.0.1:${port}`,'-t','public','public/index.php'],{cwd:root,env:testEnv});
let output='';child.stderr.on('data',c=>{output+=c});
for(let attempt=0;attempt<100;attempt++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(attempt===99)throw new Error(output||'PHP server timeout');await new Promise(r=>setTimeout(r,100));}
async function call(url,{cookie='',method='GET',data,body,headers={}}={}){
 const response=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{}),...headers},body:body??(data?JSON.stringify(data):undefined)});
 const text=await response.text();let value;try{value=JSON.parse(text)}catch{value=text}return {status:response.status,value,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
try {
 await test('web app shell, account permissions, workflow, replay protection and portable downloads',async()=>{
  assert.equal((await call('/healthz')).status,200);
  for(const file of ['/team','/sw.js','/assets/app/offline.js','/assets/app/responsive.css','/assets/icons/app-192.png'])assert.equal((await call(file)).status,200,file);
  const manifest=await call('/manifest.webmanifest');assert.equal(manifest.status,200);assert.equal(manifest.value.display,'standalone');
  assert.equal((await call('/data/team.sqlite')).status,404);
  assert.equal((await call('/.env')).status,404);
  assert.equal((await call('/api/admin/overview')).status,401);
  assert.equal((await call('/api/login',{method:'POST',data:{},headers:{origin:'https://other.example'}})).status,403);
  const admin=await call('/api/login',{method:'POST',data:{username:'admin',password:'temporary-test-password'}});assert.equal(admin.status,200);const ac=admin.cookie;
  const member=await call('/api/admin/members',{cookie:ac,method:'POST',data:{displayName:'عضو آزمایش',username:'member',password:'temporary-member-password',roles:['translator','cleaner','typesetter']}});assert.equal(member.status,201);
  const memberId=member.value.id;
  const series=await call('/api/admin/series',{cookie:ac,method:'POST',data:{title:'اثر آزمایش وب‌اپ'}});assert.equal(series.status,201);const seriesId=series.value.id;
  for(const stage of ['translation','clean','typing'])assert.equal((await call('/api/admin/series-defaults',{cookie:ac,method:'POST',data:{seriesId,stage,userId:memberId}})).status,201);
  assert.equal((await call('/api/admin/chapters',{cookie:ac,method:'POST',data:{seriesId,numbers:'1-2'}})).status,201);
  const login=await call('/api/login',{method:'POST',data:{username:'member',password:'temporary-member-password'}});const mc=login.cookie;assert.equal(login.status,200);
  assert.equal((await call('/api/admin/overview',{cookie:mc})).status,403);
  let dashboard=await call('/api/member/dashboard',{cookie:mc});assert.equal(dashboard.status,200);
  const chapter=dashboard.value.works[0].chapters[0];assert.equal(chapter.stages.find(s=>s.stage==='typing').canUpload,false);
  const stages=Object.fromEntries(chapter.stages.map(s=>[s.stage,s.assignmentId]));
  const zip=Buffer.from('504b0506000000000000000000000000000000000000','hex');
  const send=(stage,key,ext='zip',cookie=mc)=>call(`/api/upload?assignmentId=${stages[stage]}&filename=chapter.${ext}`,{cookie,method:'POST',body:zip,headers:{'content-type':'application/octet-stream','x-upload-key':key}});
  assert.equal((await send('typing','typing-before-ready')).status,409);
  assert.equal((await send('translation','translation-unique-key','docx')).status,201);
  assert.equal((await send('translation','translation-unique-key','docx')).status,200);
  assert.equal((await send('translation','another-translation-key','docx')).status,409);
  assert.equal((await send('clean','clean-upload-unique-key')).status,201);
  dashboard=await call('/api/member/dashboard',{cookie:mc});assert.equal(dashboard.value.works[0].chapters[0].stages.find(s=>s.stage==='typing').canUpload,true);
  assert.equal((await send('typing','typing-upload-unique-key')).status,201);
  assert.equal((await send('typing','typing-upload-unique-key')).status,200);
  const overview=await call('/api/admin/overview',{cookie:ac});const row=overview.value.chapters.find(c=>c.stage==='typing'&&c.id===chapter.id);assert.equal(row.reviewStatus,'awaiting');
  const download=await call(`/api/admin/uploads/${row.latestUploadId}`,{cookie:ac});assert.equal(download.status,200);assert.equal(Number(download.headers.get('content-length')),zip.length);
  assert.equal((await call('/api/admin/reviews',{cookie:ac,method:'POST',data:{uploadId:row.latestUploadId,status:'revision',note:'اصلاح آزمایش'}})).status,200);
  // A new revision gets a new key; retrying the older successful request cannot create a second upload.
  assert.equal((await send('typing','typing-revision-key')).status,201);
  assert.equal((await send('typing','typing-upload-unique-key')).status,200);
  const scored=await call('/api/admin/overview',{cookie:ac});
  assert.equal(scored.value.leaderboard[0].userId,memberId);
  assert.equal(scored.value.leaderboard[0].total,3,'A revision must not create a fourth score');
  assert.deepEqual([scored.value.leaderboard[0].translation,scored.value.leaderboard[0].clean,scored.value.leaderboard[0].typing],[1,1,1]);
  const db=new DatabaseSync(path.join(fixture,'team.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM uploads').get().n,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM upload_receipts').get().n,4);const paths=db.prepare('SELECT stored_path FROM uploads').all();assert.ok(paths.every(p=>process.env.TEST_FTP==='1'?/^ftp:work-\d+\/chapter-/.test(p.stored_path):!p.stored_path.includes('/')&&!p.stored_path.includes('\\')));db.close();
  if(process.env.TEST_FTP!=='1')assert.equal((await readdir(path.join(fixture,'uploads'))).length,4);else assert.equal((await readdir(path.join(fixture,'remote'),{recursive:true})).filter(p=>p.endsWith('.zip')||p.endsWith('.docx')).length,4);
  assert.equal((await call('/api/logout',{cookie:mc,method:'POST',data:{}})).status,200);
  assert.equal((await call('/api/member/dashboard',{cookie:mc})).status,401);
 });
 await test('monthly top five counts manual completions, excludes old work and ignores repeated completion',async()=>{
  const login=await call('/api/login',{method:'POST',data:{username:'admin',password:'temporary-test-password'}}),cookie=login.cookie;
  const expected=[];
  for(let i=0;i<6;i++){
   const score=7-i;
   const member=await call('/api/admin/members',{cookie,method:'POST',data:{displayName:`رتبه ${i+1}`,username:`rank-${i}`,password:'temporary-rank-password',roles:['translator']}});assert.equal(member.status,201);
   const work=await call('/api/admin/series',{cookie,method:'POST',data:{title:`کار رتبه ${i+1}`}});assert.equal(work.status,201);
   assert.equal((await call('/api/admin/series-defaults',{cookie,method:'POST',data:{seriesId:work.value.id,stage:'translation',userId:member.value.id}})).status,201);
   assert.equal((await call('/api/admin/chapters',{cookie,method:'POST',data:{seriesId:work.value.id,numbers:`1-${score+1}`}})).status,201);
   const overview=await call('/api/admin/overview',{cookie});
   const chapters=overview.value.chapters.filter(c=>c.seriesId===work.value.id&&c.stage==='translation');
   for(const ch of chapters)assert.equal((await call('/api/admin/stage-status',{cookie,method:'POST',data:{chapterId:ch.id,stage:'translation',status:'completed'}})).status,200);
   const db=new DatabaseSync(path.join(fixture,'team.sqlite'));
   db.prepare("UPDATE stage_completions SET completed_at='2000-01-01T00:00:00.000Z' WHERE chapter_id=? AND stage='translation'").run(chapters.at(-1).id);
   const before=db.prepare("SELECT completed_at FROM stage_completions WHERE chapter_id=? AND stage='translation'").get(chapters[0].id).completed_at;db.close();
   assert.equal((await call('/api/admin/stage-status',{cookie,method:'POST',data:{chapterId:chapters[0].id,stage:'translation',status:'completed'}})).status,200);
   const check=new DatabaseSync(path.join(fixture,'team.sqlite'),{readOnly:true});assert.equal(check.prepare("SELECT completed_at FROM stage_completions WHERE chapter_id=? AND stage='translation'").get(chapters[0].id).completed_at,before);check.close();
   expected.push({id:member.value.id,score});
  }
  let overview=await call('/api/admin/overview',{cookie});
  assert.equal(overview.value.leaderboard.length,5);
  assert.deepEqual(overview.value.leaderboard.map(m=>m.userId),expected.slice(0,5).map(m=>m.id));
  assert.deepEqual(overview.value.leaderboard.map(m=>m.total),[7,6,5,4,3]);
  const db=new DatabaseSync(path.join(fixture,'team.sqlite'));db.prepare("UPDATE stage_completions SET completed_at='2000-01-01T00:00:00.000Z'").run();db.close();
  overview=await call('/api/admin/overview',{cookie});assert.deepEqual(overview.value.leaderboard,[],'A new month must start with an empty ranking');
 });
 await test('chapter watch adds only verified new numbers, deduplicates sources and inherits fixed assignments',async()=>{
  const login=await call('/api/login',{method:'POST',data:{username:'admin',password:'temporary-test-password'}}),cookie=login.cookie;
  const work=await call('/api/admin/series',{cookie,method:'POST',data:{title:'Monitor Test',isOngoing:true}});assert.equal(work.status,201);
  for(const stage of ['translation','clean','typing'])assert.equal((await call('/api/admin/series-defaults',{cookie,method:'POST',data:{seriesId:work.value.id,stage,userId:2}})).status,201);
  assert.equal((await call('/api/admin/chapters',{cookie,method:'POST',data:{seriesId:work.value.id,numbers:'1-2'}})).status,201);
  const db=new DatabaseSync(path.join(fixture,'team.sqlite'));initWatch(db);
  const observation={seriesId:work.value.id,title:'Monitor Test!',sourceUrl:'https://mangaplus.shueisha.co.jp/titles/999999',chapters:[{number:'004'},{number:'3.5'},{number:'۳'},{number:'1'}]};
  const result=ingest(db,[observation], '2026-10-27T12:00:00.000Z');assert.equal(result.added,3);
  assert.equal(ingest(db,[observation]).added,0);
  assert.equal(ingest(db,[{...observation,sourceUrl:'https://mangafire.to/title/test-monitor'}]).added,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chapters WHERE series_id=?').get(work.value.id).n,5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chapter_watch_events').get().n,3);
  for(const chapter of result.chapters){
   const row=db.prepare('SELECT id FROM chapters WHERE series_id=? AND number=?').get(work.value.id,chapter.number);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM assignments WHERE chapter_id=? AND active=1').get(row.id).n,3);
   assert.equal(db.prepare("SELECT status FROM stages WHERE chapter_id=? AND stage='typing'").get(row.id).status,'waiting');
   assert.equal(db.prepare('SELECT due_at FROM assignments WHERE chapter_id=? LIMIT 1').get(row.id).due_at,'2026-10-28T12:00:00.000Z');
  }
  assert.throws(()=>ingest(db,[{...observation,title:'Some other work',chapters:[{number:'5'}]}]),/verified match/);
  assert.throws(()=>ingest(db,[{...observation,sourceUrl:'https://unapproved.example/'}]),/approved/);
  assert.throws(()=>ingest(db,[{...observation,chapters:[{number:'Chapter 5'}]}]),/Invalid chapter/);
  const pending=pendingMail(db);assert.equal(pending.recipient,null);assert.equal(pending.events.length,3);assert.ok(pending.events.every(e=>e.notificationKey));
  db.close();
 });
 if(process.env.RUN_LOAD_TEST==='1')await test('100 distinct accounts read 300 chapters concurrently (local smoke benchmark)',async()=>{
  const login=await call('/api/login',{method:'POST',data:{username:'admin',password:'temporary-test-password'}}),adminCookie=login.cookie;
  const work=await call('/api/admin/series',{cookie:adminCookie,method:'POST',data:{title:'کار آزمایش ۱۰۰ عضو'}});assert.equal(work.status,201);
  assert.equal((await call('/api/admin/chapters',{cookie:adminCookie,method:'POST',data:{seriesId:work.value.id,numbers:'1-300'}})).status,201);
  const cookies=[];
  for(let i=0;i<100;i++){
   const username=`load-member-${i}`;
   const member=await call('/api/admin/members',{cookie:adminCookie,method:'POST',data:{displayName:`عضو موقت ${i}`,username,password:'temporary-load-password',roles:['translator']}});assert.equal(member.status,201);
   assert.equal((await call('/api/admin/access',{cookie:adminCookie,method:'POST',data:{userId:member.value.id,seriesId:work.value.id,allowed:true}})).status,200);
   const session=await call('/api/login',{method:'POST',data:{username,password:'temporary-load-password'}});assert.equal(session.status,200);cookies.push(session.cookie);
  }
  const begin=performance.now();
  const durations=await Promise.all(cookies.map(async cookie=>{
   const start=performance.now(),result=await call('/api/member/dashboard',{cookie});
   assert.equal(result.status,200);assert.equal(result.value.works[0].chapters.length,300);
   return performance.now()-start;
  }));
  durations.sort((a,b)=>a-b);
  const result={environment:'local development computer; not a VPS capacity guarantee',users:100,chaptersPerResponse:300,simultaneousRequests:100,successfulResponses:durations.length,totalMs:Math.round(performance.now()-begin),p50Ms:Math.round(durations[49]),p95Ms:Math.round(durations[94]),maxMs:Math.round(durations[99]),createdAt:new Date().toISOString()};
  await mkdir(path.join(root,'release'),{recursive:true});await writeFile(path.join(root,'release','qa-load.json'),JSON.stringify(result,null,2));
  console.log('LOAD_RESULT',JSON.stringify(result));
 });
 await test('multiple helpers keep exclusive chapter ownership and roll back a rejected batch',async()=>{
 const admin=await call('/api/login',{method:'POST',data:{username:'admin',password:'temporary-test-password'}}),cookie=admin.cookie;
 const ids=[];for(let i=0;i<3;i++){const m=await call('/api/admin/members',{cookie,method:'POST',data:{displayName:'کمکی '+i,username:'batch-helper-'+i,password:'temporary-password',roles:['cleaner']}});ids.push(m.value.id);}
 const work=await call('/api/admin/series',{cookie,method:'POST',data:{title:'تخصیص کمکی چند نفر'}}),seriesId=work.value.id;
 await call('/api/admin/series-defaults',{cookie,method:'POST',data:{seriesId,stage:'clean',userId:ids[0]}});
 await call('/api/admin/chapters',{cookie,method:'POST',data:{seriesId,numbers:'1-4'}});
 let view=(await call('/api/admin/overview',{cookie})).value,chapters=view.chapters.filter(c=>c.seriesId===seriesId&&c.stage==='clean');
 assert.equal((await call('/api/admin/assignments',{cookie,method:'POST',data:{chapterIds:chapters.slice(0,2).map(c=>c.id),stage:'clean',userId:ids[1]}})).status,201);
 assert.equal((await call('/api/admin/assignments',{cookie,method:'POST',data:{chapterIds:[chapters[2].id],stage:'clean',userId:ids[2]}})).status,201);
 view=(await call('/api/admin/overview',{cookie})).value;assert.deepEqual(view.chapters.filter(c=>c.seriesId===seriesId&&c.stage==='clean').map(c=>c.userId),[ids[1],ids[1],ids[2],ids[0]]);
 assert.equal((await call('/api/admin/assignments',{cookie,method:'POST',data:{chapterIds:[chapters[3].id,9999999],stage:'clean',userId:ids[2]}})).status,400);
 view=(await call('/api/admin/overview',{cookie})).value;assert.equal(view.chapters.find(c=>c.id===chapters[3].id&&c.stage==='clean').userId,ids[0]);assert.equal(view.deliveries.length,30);
 assert.equal((await call('/api/admin/assignments',{cookie,method:'POST',data:{seriesId,numbers:'۳/۴/',stage:'clean',userId:ids[2]}})).status,201);
 assert.equal((await call('/api/admin/assignments',{cookie,method:'POST',data:{seriesId,numbers:'1/99/',stage:'clean',userId:ids[2]}})).status,400);
 view=(await call('/api/admin/overview',{cookie})).value;assert.equal(view.chapters.find(c=>c.id===chapters[0].id&&c.stage==='clean').userId,ids[1]);
 assert.equal((await call('/api/admin/chapters',{cookie,method:'POST',data:{seriesId,numbers:'5/ 8/ 21/'}})).value.created,3);

 const member=(await call('/api/admin/members/'+ids[1],{cookie})).value.member;assert.deepEqual(member.performance,{total:0,last30Days:0,rank:5});
 });
 await test('PHP preserves legacy Node password login and upgrades it without resetting the account',async()=>{
 const db=new DatabaseSync(path.join(fixture,'team.sqlite'));const salt='00112233445566778899aabbccddeeff',password='legacy-password-test';
 db.prepare("INSERT INTO users(username,full_name,role,salt,password_hash,created_at) VALUES('legacy','Legacy','translator',?,?,?)").run(salt,scryptSync(password,salt,64).toString('hex'),new Date().toISOString());db.close();
 const login=await call('/api/login',{method:'POST',data:{username:'legacy',password}});assert.equal(login.status,200);
 const check=new DatabaseSync(path.join(fixture,'team.sqlite'),{readOnly:true});assert.ok(check.prepare("SELECT password_hash FROM users WHERE username='legacy'").get().password_hash.startsWith('$'));check.close();
 assert.equal((await call('/api/login',{method:'POST',data:{username:'legacy',password}})).status,200);
 });
 await test('PHP chapter watcher validates and deduplicates observations on the same SQLite database',async()=>{
 const db=new DatabaseSync(path.join(fixture,'team.sqlite'));const work=db.prepare("INSERT INTO series(title,is_ongo,created_at) VALUES('PHP Watch',1,?)").run(new Date().toISOString());db.close();
 const observation=path.join(fixture,'php-watch.json');await writeFile(observation,JSON.stringify([{seriesId:Number(work.lastInsertRowid),title:'PHP Watch',sourceUrl:'https://mangaplus.shueisha.co.jp/titles/999998',chapters:[{number:'1'}]}]));
 const run=()=>spawnSync(php,['scripts/chapter-watch.php','ingest',observation],{cwd:root,env:testEnv,encoding:'utf8'});
 let result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).added,1);result=run();assert.equal(JSON.parse(result.stdout).added,0);
 });
 if(ftpChild)await test('FTP outage must not mark a chapter delivered',async()=>{
 const login=await call('/api/login',{method:'POST',data:{username:'admin',password:'temporary-test-password'}}),ac=login.cookie;
 const work=await call('/api/admin/series',{cookie:ac,method:'POST',data:{title:'FTP failure'}});
 await call('/api/admin/series-defaults',{cookie:ac,method:'POST',data:{seriesId:work.value.id,stage:'clean',userId:2}});
 await call('/api/admin/chapters',{cookie:ac,method:'POST',data:{seriesId:work.value.id,numbers:'1'}});
 const member=await call('/api/login',{method:'POST',data:{username:'member',password:'temporary-member-password'}});
 const db=new DatabaseSync(path.join(fixture,'team.sqlite'));const a=db.prepare("SELECT a.* FROM assignments a JOIN chapters c ON c.id=a.chapter_id WHERE c.series_id=? AND a.stage='clean'").get(work.value.id);const before=db.prepare('SELECT COUNT(*) n FROM uploads').get().n;
 const stopped=new Promise(resolve=>ftpChild.once('exit',resolve));ftpChild.kill();await stopped;ftpChild=null;
 const upload=await call(`/api/upload?assignmentId=${a.id}&filename=test.zip`,{cookie:member.cookie,method:'POST',body:Buffer.from('504b0506000000000000000000000000000000000000','hex')});assert.equal(upload.status,502);assert.equal(db.prepare('SELECT COUNT(*) n FROM uploads').get().n,before);assert.notEqual(db.prepare("SELECT status FROM stages WHERE chapter_id=? AND stage='clean'").get(a.chapter_id).status,'completed');db.close();
 });
} finally {
 if(ftpChild){const stopped=new Promise(resolve=>ftpChild.once('exit',resolve));ftpChild.kill();await stopped;}
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
 assert.ok(path.resolve(fixture).startsWith(path.join(path.resolve(tmpdir()),'two-manga-test-')));
 await rm(fixture,{recursive:true,force:true});
}
