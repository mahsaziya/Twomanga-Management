<?php
if(PHP_SAPI!=='cli')exit(1);
require __DIR__.'/../php/bootstrap.php';
// Run from cron. Failed deletes stay queued; no silent loss of file-cleanup tasks.
foreach(rows('SELECT * FROM pending_file_cleanup ORDER BY id LIMIT 100') as $r){
 try{if(str_starts_with($r['stored_path'],'ftp:')){$key=substr($r['stored_path'],4);$url=ftp_url($key);$path=parse_url($url,PHP_URL_PATH);$c=ftp_handle();curl_setopt_array($c,[CURLOPT_URL=>'ftp://'.$config['ftp']['host'].':'.$config['ftp']['port'].'/',CURLOPT_QUOTE=>['DELE '.$path],CURLOPT_NOBODY=>true]);$ok=curl_exec($c);$code=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);if($ok===false&&$code!==550)continue;}else discard_file($r['stored_path']);q('DELETE FROM pending_file_cleanup WHERE id=?',[$r['id']]);}catch(Throwable $e){fwrite(STDERR,"File cleanup will retry.\n");}
}
