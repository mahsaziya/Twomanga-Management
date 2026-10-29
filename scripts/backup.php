<?php
if(PHP_SAPI!=='cli')exit(1);
require __DIR__.'/../php/bootstrap.php';
$folder=ROOT.'/data/backups';if(!is_dir($folder))mkdir($folder,0700,true);$file=$folder.'/team-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(3)).'.sqlite';q('VACUUM INTO ?',[$file]);echo $file.PHP_EOL;
