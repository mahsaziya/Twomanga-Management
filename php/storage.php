<?php
declare(strict_types=1);
// Fixed layout: /team-files/work-12/chapter-8/typing/<random>.zip
// Files remain private. The application checks access and streams downloads via FTP.
function ftp_handle() {
 global $config;
 $f=$config['ftp'];
 if(!$f['host']||!$f['username']||!$f['password'])fail(503,'اطلاعات اتصال FTP هنوز تنظیم نشده است.');
 $root=$f['root'];
 if(!preg_match('~^/[A-Za-z0-9_/-]+$~D',$root)||str_contains($root,'..'))fail(503,'مسیر ثابت FTP معتبر نیست.');
 $c=curl_init();
 if(!$c)fail(503,'افزونه cURL برای FTP فعال نیست.');
 curl_setopt_array($c,[CURLOPT_USERNAME=>$f['username'],CURLOPT_PASSWORD=>$f['password'],CURLOPT_CONNECTTIMEOUT=>15,CURLOPT_TIMEOUT=>(int)$f['timeout'],CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_FTP_USE_EPSV=>true,CURLOPT_PROTOCOLS=>CURLPROTO_FTP|CURLPROTO_FTPS,CURLOPT_RETURNTRANSFER=>true]);
 if($f['tls'])curl_setopt($c,CURLOPT_USE_SSL,CURLUSESSL_ALL);
 return $c;
}
function ftp_url(string $key):string {
 global $config;$f=$config['ftp'];
 if(!preg_match('~^[A-Za-z0-9_./-]+$~D',$key)||str_contains($key,'..'))fail(500,'مسیر فایل معتبر نیست.');
 return 'ftp://'.$f['host'].':'.(int)$f['port'].rtrim($f['root'],'/').'/'.$key;
}
function store_file(string $temp,array $assignment,string $ext):string {
 global $config;
 if($config['storage']==='local'){
  $key=$assignment['id'].'-'.bin2hex(random_bytes(16)).'.'.$ext;
  if(!rename($temp,$config['local_files'].'/'.$key))fail(500,'ذخیره فایل انجام نشد.');return $key;
 }
 $number=str_replace('.','-',(string)$assignment['number']);
 if(!preg_match('/^\d+(?:-\d+)?$/D',$number))fail(400,'شماره چپتر معتبر نیست.');
 $key='work-'.$assignment['series_id'].'/chapter-'.$number.'/'.$assignment['stage'].'/'.bin2hex(random_bytes(16)).'.'.$ext;
 $c=ftp_handle();$stream=fopen($temp,'rb');
 curl_setopt_array($c,[CURLOPT_URL=>ftp_url($key),CURLOPT_UPLOAD=>true,CURLOPT_INFILE=>$stream,CURLOPT_INFILESIZE=>filesize($temp),CURLOPT_FTP_CREATE_MISSING_DIRS=>CURLFTP_CREATE_DIR_RETRY]);
 $ok=curl_exec($c);$error=curl_errno($c);fclose($stream);curl_close($c);
 if($ok===false||$error){queue_cleanup('ftp:'.$key);fail(502,'ارسال به FTP ناموفق بود؛ وضعیت تحویل تغییر نکرد. دوباره تلاش کنید.');}
 return 'ftp:'.$key;
}
function queue_cleanup(string $key):void {q('INSERT INTO pending_file_cleanup(stored_path,created_at) VALUES(?,?)',[$key,now_iso()]);}
function discard_file(string $key):void {
 global $config;
 if(str_starts_with($key,'ftp:')){queue_cleanup($key);return;}
 $file=$config['local_files'].'/'.basename(str_replace('\\','/',$key));if(is_file($file))@unlink($file);
}
function download_file(array $item):never {
 global $config;$key=$item['stored_path'];$stream=tmpfile();
 if(str_starts_with($key,'ftp:')){
  $c=ftp_handle();curl_setopt_array($c,[CURLOPT_URL=>ftp_url(substr($key,4)),CURLOPT_RETURNTRANSFER=>false,CURLOPT_FILE=>$stream]);
  $ok=curl_exec($c);$error=curl_errno($c);curl_close($c);if($ok===false||$error){fclose($stream);fail(502,'دریافت فایل از FTP انجام نشد.');}
 }else{
  $local=$config['local_files'].'/'.basename(str_replace('\\','/',$key));if(!is_file($local))fail(404,'فایل موجود نیست.');$source=fopen($local,'rb');stream_copy_to_stream($source,$stream);fclose($source);
 }
 $info=fstat($stream);rewind($stream);header('Content-Type: application/octet-stream');header('Content-Length: '.$info['size']);header("Content-Disposition: attachment; filename*=UTF-8''".rawurlencode($item['file_name']));header('Cache-Control: no-store');fpassthru($stream);fclose($stream);exit;
}
