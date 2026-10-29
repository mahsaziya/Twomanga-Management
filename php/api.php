<?php
declare(strict_types=1);
require_once __DIR__.'/reports.php';
function route_api(string $path,string $method):never{
 global $db,$config;
 if($path==='/healthz'){q('SELECT 1');json_response(['ok'=>true,'backend'=>'php']);}
 if($path==='/api/login'&&$method==='POST'){
  $ip=$_SERVER['REMOTE_ADDR']??'local';$attempt=one('SELECT * FROM login_attempts WHERE ip=?',[$ip]);if($attempt&&$attempt['until_at']>time()&&$attempt['count']>=20)fail(429,'۱۵ دقیقه دیگر برای ورود تلاش کنید.');
  q('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN until_at<? THEN 1 ELSE count+1 END,until_at=CASE WHEN until_at<? THEN excluded.until_at ELSE until_at END',[$ip,time()+900,time(),time()]);
  $d=input_json();$u=one('SELECT * FROM users WHERE username=? AND active=1',[trim((string)($d['username']??''))]);$password=(string)($d['password']??'');
  $valid=$u&&(str_starts_with($u['password_hash'],'$')?password_verify($password,$u['password_hash']):verify_legacy_password($password,$u['salt'],$u['password_hash']));if(!$valid)fail(401,'نام کاربری یا رمز عبور درست نیست.');
  if(!str_starts_with($u['password_hash'],'$')||password_needs_rehash($u['password_hash'],PASSWORD_DEFAULT))q('UPDATE users SET password_hash=?,salt=? WHERE id=?',[password_hash($password,PASSWORD_DEFAULT),'php',$u['id']]);
  q('DELETE FROM login_attempts WHERE ip=?',[$ip]);$token=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');q('INSERT INTO sessions VALUES(?,?,?)',[hash('sha256',$token),$u['id'],(new DateTimeImmutable('+12 hours'))->format('Y-m-d\TH:i:s.v\Z')]);setcookie('manga_session',$token,['expires'=>time()+43200,'path'=>'/','secure'=>$config['environment']==='production','httponly'=>true,'samesite'=>'Strict']);json_response(['user'=>public_user($u)]);
 }
 if($path==='/api/logout'&&$method==='POST'){q('DELETE FROM sessions WHERE token_hash=?',[hash('sha256',$_COOKIE['manga_session']??'')]);setcookie('manga_session','',['expires'=>1,'path'=>'/','httponly'=>true,'samesite'=>'Strict','secure'=>$config['environment']==='production']);json_response(['ok'=>true]);}
 if($path==='/api/me'){json_response(['user'=>public_user(require_user())]);}
 if($path==='/api/admin/overview'&&$method==='GET'){require_user(true);json_response(overview());}
 if($path==='/api/member/dashboard'&&$method==='GET'){json_response(member_dashboard(require_user()));}
 if($path==='/api/settlements'||$path==='/api/admin/penalties')fail(503,'بخش تسویه فعلاً غیرفعال است.');
 if($path==='/api/admin/members'){
  require_user(true);if($method==='GET')json_response(['members'=>members_list()]);
  if($method==='POST'){$d=input_json();$name=trim((string)($d['displayName']??''));$username=trim((string)($d['username']??''));$pass=(string)($d['password']??'');$roles=normalize_roles($d['roles']??[]);if(!$name||!$username||mb_strlen($pass)<8||!$roles)fail(400,'نام عضو، نام کاربری، نقش و رمز حداقل ۸ کاراکتری لازم است.');if(one('SELECT 1 FROM users WHERE username=?',[$username]))fail(409,'نام کاربری قبلاً ثبت شده است.');$id=transaction(function()use($username,$name,$pass,$roles,$db){$base=array_values(array_intersect($roles,array_values(STAGE_ROLES)))[0]??'translator';q('INSERT INTO users(username,full_name,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',[$username,$name,$base,'php',password_hash($pass,PASSWORD_DEFAULT),now_iso()]);$id=(int)$db->lastInsertId();set_roles($id,$roles);return $id;});json_response(['id'=>$id],201);}
 }
 if(preg_match('~^/api/admin/members/(\d+)$~D',$path,$m)){
  require_user(true);$id=(int)$m[1];$member=one("SELECT * FROM users WHERE id=? AND role<>'admin'",[$id]);if(!$member)fail(404,'عضو پیدا نشد.');
  if($method==='GET'){$public=public_user($member);$public['active']=$member['active'];$public['performance']=performance()['members'][$id]??['total'=>0,'last30Days'=>0,'rank'=>5];$public['workAccess']=rows('SELECT s.id,s.title,CASE WHEN w.user_id IS NULL THEN 0 ELSE 1 END allowed FROM series s LEFT JOIN work_access w ON w.series_id=s.id AND w.user_id=? ORDER BY s.title',[$id]);json_response(['member'=>$public]);}
  if($method==='PUT'){
   $d=input_json();$name=trim((string)($d['displayName']??$member['full_name']));$username=trim((string)($d['username']??$member['username']));$pass=(string)($d['password']??'');$roles=normalize_roles($d['roles']??[]);if(!$name||!$username||!$roles||($pass&&mb_strlen($pass)<8))fail(400,'نام، نام کاربری، نقش و رمز معتبر وارد کنید.');if(one('SELECT 1 FROM users WHERE username=? AND id<>?',[$username,$id]))fail(409,'نام کاربری قبلاً ثبت شده است.');
   foreach(rows('SELECT stage FROM assignments WHERE user_id=? AND active=1 UNION SELECT stage FROM series_defaults WHERE user_id=?',[$id,$id]) as $r)if(!in_array(STAGE_ROLES[$r['stage']],$roles))fail(409,'ابتدا مسئولیت فعال این نقش را منتقل کنید.');
   transaction(function()use($id,$roles,$name,$username,$pass,$member){set_roles($id,$roles);$base=array_values(array_intersect($roles,array_values(STAGE_ROLES)))[0]??$member['role'];q('UPDATE users SET username=?,full_name=?,role=? WHERE id=?',[$username,$name,$base,$id]);if($pass)q('UPDATE users SET salt=?,password_hash=? WHERE id=?',['php',password_hash($pass,PASSWORD_DEFAULT),$id]);if($pass||$username!==$member['username'])q('DELETE FROM sessions WHERE user_id=?',[$id]);});json_response(['ok'=>true,'roles'=>$roles,'fullName'=>$name,'username'=>$username]);
  }
  if($method==='DELETE'){
   transaction(function()use($id){foreach(rows('SELECT up.stored_path FROM uploads up JOIN assignments a ON a.id=up.assignment_id WHERE a.user_id=?',[$id]) as $f)queue_cleanup($f['stored_path']);q('UPDATE stages SET uploaded_by=NULL WHERE uploaded_by=?',[$id]);q('DELETE FROM users WHERE id=?',[$id]);});json_response(['ok'=>true]);
  }
 }
 if($path==='/api/admin/series'){
  require_user(true);if($method==='GET')json_response(['series'=>rows('SELECT id,title,is_ongo isOngoing FROM series ORDER BY title')]);if($method==='POST'){$d=input_json();$title=trim((string)($d['title']??''));if(!$title)fail(400,'نام اثر را وارد کنید.');q('INSERT INTO series(title,is_ongo,created_at) VALUES(?,?,?)',[$title,!empty($d['isOngoing'])?1:0,now_iso()]);json_response(['id'=>(int)$db->lastInsertId()],201);}
 }
 if(preg_match('~^/api/admin/series/(\d+)$~D',$path,$m)){
  require_user(true);$id=(int)$m[1];if(!one('SELECT 1 FROM series WHERE id=?',[$id]))fail(404,'اثر پیدا نشد.');if($method==='PUT'){$d=input_json();q('UPDATE series SET is_ongo=? WHERE id=?',[!empty($d['isOngoing'])?1:0,$id]);json_response(['ok'=>true]);}if($method==='DELETE'){transaction(function()use($id){foreach(rows('SELECT up.stored_path FROM uploads up JOIN assignments a ON a.id=up.assignment_id JOIN chapters c ON c.id=a.chapter_id WHERE c.series_id=?',[$id]) as $f)queue_cleanup($f['stored_path']);q('DELETE FROM series WHERE id=?',[$id]);});json_response(['ok'=>true]);}
 }
 if($path==='/api/admin/chapters'&&$method==='POST'){
  require_user(true);$d=input_json();$work=one('SELECT * FROM series WHERE id=?',[(int)($d['seriesId']??0)]);if(!$work)fail(400,'اثر معتبر انتخاب کنید.');$numbers=chapter_numbers($d['numbers']??$d['number']??'');$ongo=$d['isOngoing']??(bool)$work['is_ongo'];$defaults=rows('SELECT * FROM series_defaults WHERE series_id=?',[$work['id']]);
  $created=transaction(function()use($work,$numbers,$ongo,$defaults,$db){$created=0;foreach($numbers as $number){if(one('SELECT 1 FROM chapters WHERE series_id=? AND CAST(number AS REAL)=?',[$work['id'],(float)$number]))continue;q('INSERT INTO chapters(series_id,number,is_ongo,created_at) VALUES(?,?,?,?)',[$work['id'],$number,$ongo?1:0,now_iso()]);$id=(int)$db->lastInsertId();$created++;foreach(STAGES as $stage)q("INSERT INTO stages(chapter_id,stage,status) VALUES(?,?,'waiting')",[$id,$stage]);foreach($defaults as $a)assign_stage(['id'=>$id,'series_id'=>$work['id'],'is_ongo'=>$ongo],$a['user_id'],$a['stage'],'fixed',$a['fee_cents']);}return $created;});json_response(['created'=>$created,'requested'=>count($numbers)],201);
 }
 if($path==='/api/admin/access'&&$method==='POST'){require_user(true);$d=input_json();$uid=(int)($d['userId']??0);$sid=(int)($d['seriesId']??0);if(!one("SELECT 1 FROM users WHERE id=? AND role<>'admin'",[$uid])||!one('SELECT 1 FROM series WHERE id=?',[$sid]))fail(400,'عضو یا اثر معتبر نیست.');if(!empty($d['allowed']))q('INSERT OR IGNORE INTO work_access VALUES(?,?)',[$uid,$sid]);else q('DELETE FROM work_access WHERE user_id=? AND series_id=?',[$uid,$sid]);json_response(['ok'=>true]);}
 if($path==='/api/admin/series-defaults'&&$method==='POST'){
  require_user(true);$d=input_json();$sid=(int)($d['seriesId']??0);$uid=(int)($d['userId']??0);$stage=(string)($d['stage']??'');if(!one('SELECT 1 FROM series WHERE id=?',[$sid])||!isset(STAGE_ROLES[$stage]))fail(400,'اثر یا بخش کار معتبر نیست.');if($uid)validate_member($uid,$stage);$fee=max(0,(int)round((float)($d['fee']??0)*100));
  transaction(function()use($sid,$uid,$stage,$fee){if(!$uid){q('DELETE FROM series_defaults WHERE series_id=? AND stage=?',[$sid,$stage]);q("UPDATE assignments SET active=0 WHERE stage=? AND assignment_type='fixed' AND chapter_id IN(SELECT id FROM chapters WHERE series_id=?)",[$stage,$sid]);return;}q('INSERT OR IGNORE INTO work_access VALUES(?,?)',[$uid,$sid]);q('INSERT INTO series_defaults VALUES(?,?,?,?,?) ON CONFLICT(series_id,stage) DO UPDATE SET user_id=excluded.user_id,fee_cents=excluded.fee_cents,created_at=excluded.created_at',[$sid,$stage,$uid,$fee,now_iso()]);foreach(rows('SELECT * FROM chapters WHERE series_id=?',[$sid]) as $c){$st=one('SELECT status FROM stages WHERE chapter_id=? AND stage=?',[$c['id'],$stage]);$a=one('SELECT * FROM assignments WHERE chapter_id=? AND stage=? AND active=1',[$c['id'],$stage]);if($st['status']==='completed'||($a&&$a['assignment_type']==='assistant'))continue;assign_stage($c,$uid,$stage,'fixed',$fee);}});json_response(['ok'=>true],$uid?201:200);
 }
 if($path==='/api/admin/assignments'&&$method==='POST'){
  require_user(true);$d=input_json();$uid=(int)($d['userId']??0);$stage=(string)($d['stage']??'');validate_member($uid,$stage);$ids=[];
  if(isset($d['numbers'])){foreach(chapter_numbers($d['numbers']) as $number){$c=one('SELECT id FROM chapters WHERE series_id=? AND CAST(number AS REAL)=?',[(int)($d['seriesId']??0),(float)$number]);if(!$c)fail(400,'این چپتر در اثر ثبت نشده است: '.$number);$ids[]=$c['id'];}}else $ids=array_values(array_unique(array_map('intval',$d['chapterIds']??[$d['chapterId']??0])));
  if(!$ids||count($ids)>1000)fail(400,'چپتر معتبر انتخاب کنید.');transaction(function()use($ids,$uid,$stage){foreach($ids as $id){$c=one('SELECT * FROM chapters WHERE id=?',[$id]);if(!$c)fail(400,'چپتر معتبر نیست.');if(one('SELECT status FROM stages WHERE chapter_id=? AND stage=?',[$id,$stage])['status']==='completed')fail(409,'مسئول مرحلهٔ تکمیل‌شده را نمی‌توان عوض کرد.');assign_stage($c,$uid,$stage,'assistant');}});json_response(['ok'=>true,'exclusive'=>true,'scope'=>'chapter','count'=>count($ids)],201);
 }
 if($path==='/api/admin/stage-status'&&$method==='POST'){
  require_user(true);$d=input_json();$id=(int)($d['chapterId']??0);$stage=(string)($d['stage']??'');$status=(string)($d['status']??'');if(!isset(STAGE_ROLES[$stage])||!in_array($status,['waiting','in_progress','completed']))fail(400,'وضعیت معتبر نیست.');$previous=one('SELECT * FROM stages WHERE chapter_id=? AND stage=?',[$id,$stage]);if(!$previous)fail(404,'چپتر پیدا نشد.');transaction(function()use($id,$stage,$status,$previous){q('UPDATE stages SET status=? WHERE chapter_id=? AND stage=?',[$status,$id,$stage]);if($status==='completed'&&$previous['status']!=='completed'){$owner=one('SELECT user_id FROM assignments WHERE chapter_id=? AND stage=? AND active=1',[$id,$stage])['user_id']??$previous['uploaded_by'];if($owner)q('INSERT INTO stage_completions VALUES(?,?,?,?) ON CONFLICT(chapter_id,stage) DO UPDATE SET user_id=excluded.user_id,completed_at=excluded.completed_at',[$id,$stage,$owner,now_iso()]);}});json_response(['ok'=>true]);
 }
 if($path==='/api/admin/reviews'&&$method==='POST'){
  require_user(true);$d=input_json();$id=(int)($d['uploadId']??0);$status=(string)($d['status']??'');$upload=one('SELECT up.*,a.chapter_id,a.stage FROM uploads up JOIN assignments a ON a.id=up.assignment_id WHERE up.id=?',[$id]);if(!$upload||$upload['stage']!=='typing'||!in_array($status,['approved','revision']))fail(400,'بازبینی معتبر نیست.');transaction(function()use($id,$status,$d,$upload){q('UPDATE reviews SET status=?,note=?,updated_at=? WHERE upload_id=?',[$status,(string)($d['note']??''),now_iso(),$id]);q("UPDATE stages SET status=? WHERE chapter_id=? AND stage='typing'",[$status==='approved'?'completed':'in_progress',$upload['chapter_id']]);});json_response(['ok'=>true]);
 }
 if($path==='/api/member/files'&&$method==='GET'){
  $u=require_user();$stage=(string)($_GET['stage']??'');$permission=['translation'=>'senior_translator','clean'=>'senior_cleaner'][$stage]??null;if(!$permission)fail(400,'بخش معتبر نیست.');if(!has_permission($u['id'],$permission))fail(403,'دسترسی ندارید.');json_response(['files'=>rows('SELECT up.id,up.file_name fileName,up.uploaded_at uploadedAt,c.number chapter,s.title seriesTitle,u.full_name uploadedBy FROM uploads up JOIN assignments a ON a.id=up.assignment_id JOIN chapters c ON c.id=a.chapter_id JOIN series s ON s.id=c.series_id JOIN users u ON u.id=a.user_id WHERE a.stage=? ORDER BY up.id DESC',[$stage])]);
 }
 if(preg_match('~^/api/(admin|member)/uploads/(\d+)$~D',$path,$m)&&$method==='GET'){
  $u=require_user($m[1]==='admin');$item=one('SELECT up.*,a.stage FROM uploads up JOIN assignments a ON a.id=up.assignment_id WHERE up.id=?',[(int)$m[2]]);if(!$item)fail(404,'فایل پیدا نشد.');if($m[1]==='member'){$permission=['translation'=>'senior_translator','clean'=>'senior_cleaner'][$item['stage']]??'';if(!$permission||!has_permission($u['id'],$permission))fail(403,'دسترسی ندارید.');}download_file($item);
 }
 if($path==='/api/upload'&&$method==='POST'){require __DIR__.'/upload.php';upload_request();}
 fail(404,'مسیر API پیدا نشد.');
}
