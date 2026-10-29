param([switch]$Lan)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$phpExe=Join-Path $env:USERPROFILE '.cache/two-team-php/php.exe'
if(!(Test-Path -LiteralPath $phpExe)){$phpExe=(Get-Command php -ErrorAction Stop).Source}
& $phpExe scripts/setup.php
if($LASTEXITCODE -ne 0){throw 'PHP database setup failed.'}
try{if((Invoke-RestMethod 'http://127.0.0.1:4173/healthz' -TimeoutSec 2).backend -eq 'php'){Start-Process 'http://localhost:4173/team';exit}}catch{}
$bindAddress=if($Lan){'0.0.0.0:4173'}else{'127.0.0.1:4173'}
Start-Process -FilePath $phpExe -ArgumentList '-S',$bindAddress,'-t','public','public/index.php' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'data/php.stdout.log' -RedirectStandardError 'data/php.stderr.log'
Start-Sleep -Seconds 1
if(!(Invoke-RestMethod 'http://127.0.0.1:4173/healthz' -TimeoutSec 5).ok){throw 'PHP server did not start.'}
Start-Process 'http://localhost:4173/team'
