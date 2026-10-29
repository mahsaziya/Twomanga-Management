<?php
declare(strict_types=1);
const STAGES=['translation','clean','typing'];
const STAGE_ROLES=['translation'=>'translator','clean'=>'cleaner','typing'=>'typesetter'];
const PERMISSIONS=['manager','senior_cleaner','senior_translator'];
const ROOT=__DIR__.'/..';
date_default_timezone_set('UTC');
$config=['environment'=>getenv('APP_ENV')?:'local','public_origin'=>getenv('PUBLIC_ORIGIN')?:'', 'database'=>getenv('TEAM_DATABASE')?:ROOT.'/data/team.sqlite','local_files'=>getenv('TEAM_LOCAL_FILES')?:ROOT.'/data/uploads','storage'=>getenv('TEAM_STORAGE')?:'local','max_upload_mb'=>100,'ftp'=>['host'=>'','port'=>21,'tls'=>true,'username'=>'','password'=>'','root'=>'/team-files','public_base_url'=>'','timeout'=>90]];
if(is_file(__DIR__.'/config.local.php'))$config=array_replace_recursive($config,require __DIR__.'/config.local.php');
foreach(['host'=>'FTP_HOST','port'=>'FTP_PORT','username'=>'FTP_USER','password'=>'FTP_PASSWORD','root'=>'FTP_ROOT','public_base_url'=>'FILES_BASE_URL'] as $key=>$env)if(getenv($env)!==false)$config['ftp'][$key]=getenv($env);
if(getenv('FTP_TLS')!==false)$config['ftp']['tls']=getenv('FTP_TLS')!=='0';
if($config['environment']==='production'&&!str_starts_with($config['public_origin'],'https://'))throw new RuntimeException('Set HTTPS public_origin in php/config.local.php.');
if(!is_dir(dirname($config['database'])))mkdir(dirname($config['database']),0700,true);
if(!is_dir($config['local_files']))mkdir($config['local_files'],0700,true);
$db=new PDO('sqlite:'.$config['database'],null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec(file_get_contents(__DIR__.'/schema.sql'));
function q(string $sql,array $args=[]):PDOStatement{global $db;$s=$db->prepare($sql);$s->execute($args);return $s;}
function one(string $sql,array $args=[]):?array{return q($sql,$args)->fetch()?:null;}
function rows(string $sql,array $args=[]):array{return q($sql,$args)->fetchAll();}
function now_iso():string{return (new DateTimeImmutable())->format('Y-m-d\TH:i:s.v\Z');}
function fail(int $status,string $message):never{throw new HttpError($message,$status);}
class HttpError extends RuntimeException{}
function json_response(array $value,int $status=200):never{http_response_code($status);header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');echo json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);exit;}
function transaction(callable $fn):mixed{global $db;$db->exec('BEGIN IMMEDIATE');try{$result=$fn();$db->exec('COMMIT');return $result;}catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}}
function input_json():array{$raw=file_get_contents('php://input',false,null,0,1000001);if(strlen($raw)>1000000)fail(413,'حجم درخواست بیش از حد مجاز است.');$d=json_decode($raw?:'{}',true,512,JSON_THROW_ON_ERROR);if(!is_array($d))fail(400,'درخواست معتبر نیست.');return $d;}
function roles_for(int $id):array{return array_column(rows('SELECT role FROM user_roles WHERE user_id=? UNION SELECT permission AS role FROM user_permissions WHERE user_id=?',[$id,$id]),'role');}
function has_role(int $id,string $role):bool{return (bool)one('SELECT 1 FROM user_roles WHERE user_id=? AND role=?',[$id,$role]);}
function has_permission(int $id,string $role):bool{return (bool)one('SELECT 1 FROM user_permissions WHERE user_id=? AND permission=?',[$id,$role]);}
function public_user(array $u):array{return ['id'=>$u['id'],'username'=>$u['username'],'fullName'=>$u['full_name'],'role'=>$u['role'],'roles'=>$u['role']==='admin'?['admin']:roles_for($u['id'])];}
function user_for():?array{$token=$_COOKIE['manga_session']??'';if(!$token)return null;return one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',[hash('sha256',$token),now_iso()]);}
function require_user(bool $admin=false):array{$u=user_for();if(!$u)fail(401,'برای ادامه وارد حساب شوید.');if($admin&&$u['role']!=='admin'&&!has_permission($u['id'],'manager'))fail(403,'اجازهٔ انجام این کار را ندارید.');return $u;}
function normalize_roles(mixed $list):array{return array_values(array_unique(array_intersect(is_array($list)?$list:[],array_merge(array_values(STAGE_ROLES),PERMISSIONS))));}
function set_roles(int $id,array $list):void{q('DELETE FROM user_roles WHERE user_id=?',[$id]);q('DELETE FROM user_permissions WHERE user_id=?',[$id]);foreach($list as $role){if(in_array($role,PERMISSIONS,true))q('INSERT INTO user_permissions VALUES(?,?)',[$id,$role]);else q('INSERT INTO user_roles VALUES(?,?)',[$id,$role]);}}
function chapter_numbers(mixed $value):array{
 $raw=trim(strtr((string)$value,['۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9','٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9','٫'=>'.']));$parts=explode('/',preg_replace('~/+\s*$~','',$raw));$numbers=[];
 foreach($parts as $part){$part=trim($part);if(preg_match('/^(\d+)\s*-\s*(\d+)$/D',$part,$m)){[$start,$end]=[(int)$m[1],(int)$m[2]];if($end<$start||$end-$start>=500||$end>9007199254740991)fail(400,'بازه نامعتبر است؛ حداکثر ۵۰۰ چپتر.');for($n=$start;$n<=$end;$n++)$numbers[(string)$n]=true;}elseif(preg_match('/^\d+(?:\.\d+)?$/D',$part)&&is_finite((float)$part)&&(float)$part<=9007199254740991)$numbers[(string)(0+$part)]=true;else fail(400,'شماره چپتر را مثل 1، 1-10 یا 1/2/8/21/ وارد کنید.');if(count($numbers)>500)fail(400,'حداکثر ۵۰۰ چپتر انتخاب کنید.');}return array_map('strval',array_keys($numbers));
}
function month_period(?DateTimeImmutable $reference=null):array{
 $date=($reference??new DateTimeImmutable())->setTimezone(new DateTimeZone('Asia/Tehran'));
 $f=new IntlDateFormatter('en_US@calendar=persian',IntlDateFormatter::NONE,IntlDateFormatter::NONE,'Asia/Tehran',IntlDateFormatter::TRADITIONAL,'yyyy-MM-dd');$parts=explode('-',$f->format($date));$start=$date->setTime(0,0)->modify('-'.((int)$parts[2]-1).' days');$end=$start->modify('+28 days');while(substr($f->format($end),0,7)===substr($f->format($start),0,7))$end=$end->modify('+1 day');$label=new IntlDateFormatter('fa_IR@calendar=persian',0,0,'Asia/Tehran',IntlDateFormatter::TRADITIONAL,'MMMM yyyy');return ['start'=>$start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),'end'=>$end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),'label'=>$label->format($date)];
}
function due_for(bool $ongo):string{return $ongo?(new DateTimeImmutable('+24 hours'))->format('Y-m-d\TH:i:s.v\Z'):(new DateTimeImmutable(month_period()['end']))->modify('-1 second')->format('Y-m-d\TH:i:s.v\Z');}
function typing_ready(int $chapter):bool{return (int)q("SELECT COUNT(*) FROM stages WHERE chapter_id=? AND stage IN ('translation','clean') AND status='completed'",[$chapter])->fetchColumn()===2;}
function activate_stage(int $chapter,string $stage):void{if($stage!=='typing'||typing_ready($chapter))q("UPDATE stages SET status='in_progress' WHERE chapter_id=? AND stage=? AND status='waiting'",[$chapter,$stage]);}
function assign_stage(array $chapter,int $uid,string $stage,string $type,int $fee=0):void{
 $old=one('SELECT * FROM assignments WHERE chapter_id=? AND stage=? AND active=1',[$chapter['id'],$stage]);
 if($old&&$old['user_id']!==$uid&&one('SELECT 1 FROM uploads WHERE assignment_id=?',[$old['id']]))fail(409,'برای این مرحله فایل ثبت شده؛ ابتدا فایل را تعیین تکلیف کنید.');
 q('INSERT OR IGNORE INTO work_access VALUES(?,?)',[$uid,$chapter['series_id']]);
 if($old)q('UPDATE assignments SET active=0 WHERE id=?',[$old['id']]);
 q('INSERT INTO assignments(chapter_id,user_id,stage,assignment_type,fee_cents,due_at,created_at,active) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(chapter_id,stage,user_id) DO UPDATE SET assignment_type=excluded.assignment_type,fee_cents=excluded.fee_cents,due_at=excluded.due_at,active=1',[$chapter['id'],$uid,$stage,$type,$fee,due_for((bool)$chapter['is_ongo']),now_iso()]);activate_stage($chapter['id'],$stage);
}
function validate_member(int $uid,string $stage):void{if(!isset(STAGE_ROLES[$stage])||!one("SELECT 1 FROM users WHERE id=? AND active=1 AND role<>'admin'",[$uid])||!has_role($uid,STAGE_ROLES[$stage]))fail(400,'عضو یا نقش انتخاب‌شده معتبر نیست.');}
require_once __DIR__.'/legacy-password.php';require_once __DIR__.'/storage.php';
