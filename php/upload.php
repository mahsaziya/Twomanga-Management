<?php
declare(strict_types=1);
function upload_assignment(int $id,int $uid):array{
 $a=one('SELECT a.*,c.number,c.is_ongo,c.series_id FROM assignments a JOIN chapters c ON c.id=a.chapter_id WHERE a.id=? AND a.active=1',[$id]);
 if(!$a||$a['user_id']!==$uid||!has_role($uid,STAGE_ROLES[$a['stage']])||!one('SELECT 1 FROM work_access WHERE user_id=? AND series_id=?',[$uid,$a['series_id']]))fail(403,'این کار به شما تخصیص ندارد یا دسترسی لغو شده است.');return $a;
}
function check_upload_stage(array $a):void{
 if(one('SELECT status FROM stages WHERE chapter_id=? AND stage=?',[$a['chapter_id'],$a['stage']])['status']==='completed')fail(409,'این بخش قبلاً تحویل شده است.');if($a['stage']==='typing'&&!typing_ready($a['chapter_id']))fail(409,'تایپ پس از تحویل ترجمه و کلین فعال می‌شود.');
}
function upload_request():never{
 global $db,$config;
 $u=require_user();$aid=(int)($_GET['assignmentId']??0);$a=upload_assignment($aid,$u['id']);$key=(string)($_SERVER['HTTP_X_UPLOAD_KEY']??'');
 if($key&&!preg_match('/^[a-zA-Z0-9-]{16,80}$/D',$key))fail(400,'شناسه ارسال معتبر نیست.');
 if($key&&one('SELECT 1 FROM upload_receipts WHERE upload_key=? AND user_id=? AND assignment_id=?',[$key,$u['id'],$aid]))json_response(['ok'=>true,'replayed'=>true]);
 check_upload_stage($a);$filename=basename(str_replace('\\','/',(string)($_GET['filename']??'')));$ext=strtolower(pathinfo($filename,PATHINFO_EXTENSION));if(!in_array($ext,$a['stage']==='translation'?['doc','docx']:['zip'],true))fail(415,'برای ترجمه Word و برای کلین یا تایپ ZIP مجاز است.');
 $max=(int)$config['max_upload_mb']*1024*1024;if((int)($_SERVER['CONTENT_LENGTH']??0)>$max)fail(413,'حجم فایل بیش از حد مجاز است.');
 $temp=tempnam(sys_get_temp_dir(),'team-upload-');$stored=null;$committed=false;
 try{
  $in=fopen('php://input','rb');$out=fopen($temp,'wb');$size=0;try{while(!feof($in)){$chunk=fread($in,65536);if($chunk===false)fail(400,'دریافت فایل قطع شد.');$size+=strlen($chunk);if($size>$max)fail(413,'حجم فایل بیش از حد مجاز است.');if(fwrite($out,$chunk)!==strlen($chunk))fail(500,'فضای موقت کافی نیست.');}}finally{fclose($in);fclose($out);}
  if(isset($_SERVER['CONTENT_LENGTH'])&&(int)$_SERVER['CONTENT_LENGTH']!==$size)fail(400,'فایل ناقص دریافت شد.');
  $signature=bin2hex(file_get_contents($temp,false,null,0,8));$valid=$ext==='doc'?str_starts_with($signature,'d0cf11e0a1b11ae1'):(str_starts_with($signature,'504b0304')||str_starts_with($signature,'504b0506')||str_starts_with($signature,'504b0708'));if(!$valid)fail(415,'محتوای فایل با پسوند تطبیق ندارد.');
  $stored=store_file($temp,$a,$ext);
  $result=transaction(function()use($a,$u,$aid,$key,$filename,$stored,$db){
   $current=require_user();if($current['id']!==$u['id'])fail(403,'حساب تغییر کرده است.');upload_assignment($aid,$u['id']);
   if($key&&one('SELECT 1 FROM upload_receipts WHERE upload_key=? AND user_id=? AND assignment_id=?',[$key,$u['id'],$aid]))return ['replayed'=>true];
   check_upload_stage($a);$at=now_iso();q('INSERT INTO uploads(assignment_id,file_name,stored_path,uploaded_at) VALUES(?,?,?,?)',[$aid,$filename,$stored,$at]);$id=(int)$db->lastInsertId();q("UPDATE stages SET status='completed',uploaded_at=?,uploaded_by=? WHERE chapter_id=? AND stage=?",[$at,$u['id'],$a['chapter_id'],$a['stage']]);
   q('INSERT INTO stage_completions VALUES(?,?,?,?) ON CONFLICT(chapter_id,stage) DO UPDATE SET user_id=excluded.user_id,completed_at=excluded.completed_at',[$a['chapter_id'],$a['stage'],$u['id'],$at]);
   if($a['stage']==='typing')q("INSERT INTO reviews(upload_id,status,updated_at) VALUES(?,'awaiting',?)",[$id,$at]);
   if($a['stage']!=='typing'&&typing_ready($a['chapter_id'])&&one("SELECT 1 FROM assignments WHERE chapter_id=? AND stage='typing' AND active=1",[$a['chapter_id']]))activate_stage($a['chapter_id'],'typing');
   q('INSERT INTO notices(message,created_at) VALUES(?,?)',[$u['full_name'].' فایل چپتر '.$a['number'].' را تحویل داد.',$at]);
   if($key)q('INSERT INTO upload_receipts VALUES(?,?,?,?,?)',[$key,$u['id'],$aid,$id,$at]);return ['replayed'=>false];
  });
  if($result['replayed'])discard_file($stored);else $committed=true;
 }catch(Throwable $error){if($stored&&!$committed)discard_file($stored);throw $error;}finally{if(is_file($temp))unlink($temp);}
 json_response(['ok'=>true,'replayed'=>$result['replayed'],'late'=>time()>strtotime($a['due_at'])],$result['replayed']?200:201);
}
