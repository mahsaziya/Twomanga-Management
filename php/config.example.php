<?php
// Copy to config.local.php on the server. Keep this file outside the public document root.
return [
 'environment'=>'production',
 'public_origin'=>'https://team.example.com',
 'database'=>dirname(__DIR__).'/data/team.sqlite',
 'local_files'=>dirname(__DIR__).'/data/uploads',
 'storage'=>'ftp', // ftp on hosting; local for offline use on your own computer
 'max_upload_mb'=>100,
 'ftp'=>[
   'host'=>'ftp.files.example.net', // FTP server, independent of the website domain
   'port'=>21,
   'tls'=>true,
   'username'=>'',
   'password'=>'',
   'root'=>'/team-files', // fixed path as seen by this FTP account
   'public_base_url'=>'https://files.example.net/team-files', // separate HTTP domain; never used for authentication
   'timeout'=>90,
 ],
];
