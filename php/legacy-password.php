<?php
declare(strict_types=1);
// Compatibility with Node crypto.scryptSync(password, salt, 64), N=16384 r=8 p=1.
// After one successful login the account is upgraded to PHP password_hash.
function scrypt_rotate(int $x,int $bits):int{return (($x<<$bits)|($x>>(32-$bits)))&0xffffffff;}
function salsa8(string $block):string{
 $b=array_values(unpack('V16',$block));$x=$b;
 for($i=0;$i<8;$i+=2){
  foreach([[0,4,8,12],[5,9,13,1],[10,14,2,6],[15,3,7,11],[0,1,2,3],[5,6,7,4],[10,11,8,9],[15,12,13,14]] as [$a,$c,$d,$e]){
   $x[$c]^=scrypt_rotate(($x[$a]+$x[$e])&0xffffffff,7);$x[$d]^=scrypt_rotate(($x[$c]+$x[$a])&0xffffffff,9);$x[$e]^=scrypt_rotate(($x[$d]+$x[$c])&0xffffffff,13);$x[$a]^=scrypt_rotate(($x[$e]+$x[$d])&0xffffffff,18);
  }
 }
 for($i=0;$i<16;$i++)$x[$i]=($x[$i]+$b[$i])&0xffffffff;return pack('V*',...$x);
}
function scrypt_mix(string $block):string{
 $x=substr($block,-64);$even='';$odd='';for($i=0;$i<16;$i++){$x=salsa8($x^substr($block,$i*64,64));if($i%2)$odd.=$x;else $even.=$x;}return $even.$odd;
}
function verify_legacy_password(string $password,string $salt,string $expected):bool{
 if(!preg_match('/^[a-f0-9]{128}$/D',$expected))return false;
 $x=hash_pbkdf2('sha256',$password,$salt,1,1024,true);$v=[];
 for($i=0;$i<16384;$i++){$v[]=$x;$x=scrypt_mix($x);}
 for($i=0;$i<16384;$i++){$j=unpack('V',substr($x,960,4))[1]&16383;$x=scrypt_mix($x^$v[$j]);}
 return hash_equals($expected,bin2hex(hash_pbkdf2('sha256',$password,$x,1,64,true)));
}
