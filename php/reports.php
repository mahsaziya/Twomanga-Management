<?php
declare(strict_types=1);
function performance():array{
 $members=[];$daily=[];$today=new DateTimeImmutable('today',new DateTimeZone('Asia/Tehran'));
 for($i=29;$i>=0;$i--)$daily[$today->modify("-$i days")->format('Y-m-d')]=0;
 foreach(rows('SELECT user_id,completed_at FROM stage_completions') as $r){if(!$r['completed_at']||strtotime($r['completed_at'])>time())continue;$id=$r['user_id'];$members[$id]??=['total'=>0,'last30Days'=>0,'rank'=>5];$members[$id]['total']++;$day=(new DateTimeImmutable($r['completed_at']))->setTimezone(new DateTimeZone('Asia/Tehran'))->format('Y-m-d');if(isset($daily[$day])){$members[$id]['last30Days']++;$daily[$day]++;}}
 if(one("SELECT 1 FROM sqlite_master WHERE name='historical_stage_credits'"))foreach(rows('SELECT h.user_id FROM historical_stage_credits h WHERE NOT EXISTS(SELECT 1 FROM stage_completions c WHERE c.chapter_id=h.chapter_id AND c.stage=h.stage)') as $r){$id=$r['user_id'];$members[$id]??=['total'=>0,'last30Days'=>0,'rank'=>5];$members[$id]['total']++;}
 foreach($members as &$m)$m['rank']=max(1,5-intdiv($m['total'],5));unset($m);
 return ['members'=>$members,'daily'=>array_map(fn($date,$count)=>compact('date','count'),array_keys($daily),array_values($daily))];
}
function members_list():array{$members=rows("SELECT id,username,full_name fullName,role,active FROM users WHERE role<>'admin' ORDER BY username");foreach($members as &$m)$m['roles']=roles_for($m['id']);return $members;}
function overview():array{
 $series=rows('SELECT id,title,is_ongo isOngoing FROM series ORDER BY title');foreach($series as &$s){$defaults=[];foreach(rows('SELECT stage,user_id userId,fee_cents feeCents FROM series_defaults WHERE series_id=?',[$s['id']]) as $r)$defaults[$r['stage']]=$r;$s['defaults']=(object)$defaults;}unset($s);
 $period=month_period();$counts=rows("SELECT stage,COUNT(*) count FROM stages WHERE status='completed' AND uploaded_at>=? AND uploaded_at<? GROUP BY stage",[$period['start'],$period['end']]);$stats=['translation'=>0,'clean'=>0,'typing'=>0];foreach($counts as $r)$stats[$r['stage']]=$r['count'];
 $stats['awaiting']=(int)q("SELECT COUNT(*) FROM reviews r JOIN uploads u ON u.id=r.upload_id WHERE r.status='awaiting' AND u.uploaded_at>=? AND u.uploaded_at<?",[$period['start'],$period['end']])->fetchColumn();
 return ['members'=>members_list(),'series'=>$series,'chapters'=>rows(file_get_contents(__DIR__.'/overview_chapters.sql')),'month'=>gmdate('Y-m'),'monthLabel'=>$period['label'],'leaderboard'=>rows(file_get_contents(__DIR__.'/leaderboard.sql'),[$period['start'],$period['end']]),'deliveries'=>performance()['daily'],'stats'=>$stats];
}
function member_dashboard(array $user):array{
 $uid=$user['id'];$public=public_user($user);$works=rows('SELECT s.* FROM series s JOIN work_access w ON w.series_id=s.id WHERE w.user_id=? ORDER BY s.title',[$uid]);
 $chapters=rows('SELECT c.* FROM chapters c JOIN work_access w ON w.series_id=c.series_id WHERE w.user_id=? ORDER BY CAST(c.number AS REAL),c.number',[$uid]);
 $stages=rows('SELECT st.* FROM stages st JOIN chapters c ON c.id=st.chapter_id JOIN work_access w ON w.series_id=c.series_id WHERE w.user_id=?',[$uid]);$stageMap=[];foreach($stages as $st)$stageMap[$st['chapter_id']][$st['stage']]=$st;
 $assignments=rows(file_get_contents(__DIR__.'/member_assignments.sql'),[$uid]);$byChapter=[];foreach($assignments as $a)$byChapter[$a['chapter_id']][]=$a;
 $result=[];foreach($works as $w){$work=['id'=>$w['id'],'title'=>$w['title'],'isOngoing'=>(bool)$w['is_ongo'],'chapters'=>[]];foreach($chapters as $ch){if($ch['series_id']!==$w['id'])continue;$list=[];$assigned=$byChapter[$ch['id']]??[];foreach(STAGES as $stage){$mine=null;$holders=[];foreach($assigned as $a)if($a['stage']===$stage){$holders[]=['name'=>$a['full_name'],'role'=>STAGE_ROLES[$stage],'type'=>$a['assignment_type']];if($a['user_id']===$uid)$mine=$a;}$current=$stageMap[$ch['id']][$stage];$list[]=['stage'=>$stage,'status'=>$current['status'],'uploadedAt'=>$current['uploaded_at'],'assignmentId'=>$mine['id']??null,'assignmentType'=>$mine['assignment_type']??null,'dueAt'=>$mine['due_at']??null,'fileName'=>$mine['file_name']??null,'reviewStatus'=>$mine['review_status']??null,'reviewNote'=>$mine['review_note']??'','feeCents'=>$mine['fee_cents']??0,'canUpload'=>(bool)($mine&&in_array(STAGE_ROLES[$stage],$public['roles'])&&$current['status']!=='completed'&&($stage!=='typing'||(($stageMap[$ch['id']]['translation']['status']??'')==='completed'&&($stageMap[$ch['id']]['clean']['status']??'')==='completed'))),'assignees'=>$holders];}$work['chapters'][]=['id'=>$ch['id'],'number'=>$ch['number'],'isOngoing'=>(bool)$ch['is_ongo'],'stages'=>$list];}$result[]=$work;}
 return ['user'=>$public,'works'=>$result];
}
