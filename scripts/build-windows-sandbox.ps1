$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (!(Test-Path $vswhere)) { throw 'Visual Studio C++ Build Tools are required to build studio-sandbox.exe.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'MSVC C++ build tools not found.' }
$vcvars = Join-Path $installation 'VC/Auxiliary/Build/vcvars64.bat'
New-Item -ItemType Directory -Force 'dist/services' | Out-Null
$command = '"' + $vcvars + '" && cl.exe /nologo /std:c++17 /EHsc /W4 /D_WIN32_WINNT=0x0A00 native\windows\sandbox.cpp /Fe:dist\services\studio-sandbox.exe /Fo:dist\services\sandbox.obj userenv.lib advapi32.lib'
& cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'Native Windows sandbox build failed.' }
$command = '"' + $vcvars + '" && cl.exe /nologo /std:c++17 /EHsc /W4 /MD /LD /I node_modules\node-api-headers\include native\files\descriptor.cpp /Fo:dist\services\descriptor.obj /link /OUT:dist\services\studio-files.node'
& cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'Native descriptor verifier build failed.' }
