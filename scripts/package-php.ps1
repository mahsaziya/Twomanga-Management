$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$release=Join-Path $projectRoot 'release'
$stage=Join-Path $release ('php-package-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach($entry in @('team.html','manifest.webmanifest','sw.js','Dockerfile','compose.yaml','.env.example','.dockerignore','start.bat','start-lan.bat','start-php.ps1','README.md','PHP-DEPLOY.md','VALIDATION.md','public','assets','deploy')){Copy-Item -LiteralPath (Join-Path $projectRoot $entry) -Destination $stage -Recurse}
foreach($folder in @('php','scripts')){New-Item -ItemType Directory -Path (Join-Path $stage $folder) | Out-Null}
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'php') -File | Where-Object Name -ne 'config.local.php' | Copy-Item -Destination (Join-Path $stage 'php')
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.php' | Copy-Item -Destination (Join-Path $stage 'scripts')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'CHAPTER-WATCH.md') -Destination (Join-Path $stage 'scripts')
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $release 'two-team-php.zip') -Force
Write-Output (Join-Path $release 'two-team-php.zip')
