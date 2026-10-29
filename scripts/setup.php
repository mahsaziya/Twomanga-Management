<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
require __DIR__.'/../php/bootstrap.php';
if(one("SELECT id FROM users WHERE role='admin'")){echo "Database ready; existing accounts and data preserved.\n";exit;}
$name=getenv('TEAM_ADMIN_USER')?:'admin';$password=getenv('TEAM_ADMIN_PASSWORD')?:'';
if(strlen($password)<12)throw new RuntimeException('Set TEAM_ADMIN_PASSWORD (12+ characters) for first setup.');
q('INSERT INTO users(username,full_name,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',[$name,'مدیر تیم','admin','php',password_hash($password,PASSWORD_DEFAULT),now_iso()]);echo "Database and initial admin ready.\n";
