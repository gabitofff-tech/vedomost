$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Ошибка установки зависимостей. Нужен Node.js 24.' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Проверки расчётов не пройдены.' }
npm run build:windows
if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки Windows.' }
Write-Host 'Готово: release\Vedomost-win32-x64. Переносите всю папку.'
