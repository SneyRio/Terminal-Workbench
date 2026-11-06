$ErrorActionPreference = 'Stop'
$fixtureDir = Join-Path $PWD '.test-data/windows-native-fixture'
New-Item -ItemType Directory -Force $fixtureDir | Out-Null
$source = Join-Path $PWD 'tests/fixtures/windows-cli.cs'
$exe = Join-Path $fixtureDir 'claude.exe'
if (Test-Path $exe) { Remove-Item $exe }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:exe /platform:x64 /reference:System.Web.Extensions.dll /out:$exe $source
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile Windows CLI fixture' }
Write-Output "Built fixture: $exe"
