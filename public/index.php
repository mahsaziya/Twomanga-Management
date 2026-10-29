<?php
declare(strict_types=1);
header('X-Content-Type-Options: nosniff');header('X-Frame-Options: DENY');header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
try{
 require dirname(__DIR__).'/php/bootstrap.php';
 $path=rawurldecode(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)?:'/');$method=$_SERVER['REQUEST_METHOD'];
 if($config['environment']==='production')header('Strict-Transport-Security: max-age=31536000');
 if(!in_array($method,['GET','HEAD'])&&isset($_SERVER['HTTP_ORIGIN'])){$expected=$config['public_origin']?:'http://'.$_SERVER['HTTP_HOST'];if($_SERVER['HTTP_ORIGIN']!==$expected)fail(403,'مبدأ درخواست مجاز نیست.');}
 if(str_starts_with($path,'/api/')||$path==='/healthz'){require dirname(__DIR__).'/php/api.php';route_api($path,$method);}
 if(!in_array($method,['GET','HEAD']))fail(405,'روش درخواست مجاز نیست.');
 $file=null;$root=realpath(dirname(__DIR__));
 if(in_array($path,['/','/team','/team.html']))$file=$root.'/team.html';
 elseif(in_array($path,['/sw.js','/manifest.webmanifest']))$file=$root.$path;
 elseif(str_starts_with($path,'/assets/')){$candidate=realpath($root.$path);if($candidate&&str_starts_with(str_replace('\\','/',$candidate),str_replace('\\','/',$root).'/assets/'))$file=$candidate;}
 if(!$file||!is_file($file))fail(404,'صفحه پیدا نشد.');
 $types=['html'=>'text/html; charset=utf-8','css'=>'text/css; charset=utf-8','js'=>'text/javascript; charset=utf-8','svg'=>'image/svg+xml','png'=>'image/png','ttf'=>'font/ttf','webmanifest'=>'application/manifest+json'];header('Content-Type: '.($types[pathinfo($file,PATHINFO_EXTENSION)]??'application/octet-stream'));header('Cache-Control: no-cache');if($path==='/sw.js')header('Service-Worker-Allowed: /');if($method!=='HEAD')readfile($file);
}catch(Throwable $error){
 if(isset($db)&&$db->inTransaction())$db->rollBack();
 $code=$error instanceof HttpError?$error->getCode():($error instanceof JsonException?400:500);
 if($code===500)error_log((string)$error);
 http_response_code($code);header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');echo json_encode(['error'=>$code===500?'خطای داخلی سرور.':$error->getMessage()],JSON_UNESCAPED_UNICODE);
}
