param([string]$TesseractDirectory = "C:\Program Files\Tesseract-OCR")
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
foreach ($file in @('tesseract.exe', 'tessdata\rus.traineddata', 'tessdata\eng.traineddata')) {
    if (-not (Test-Path (Join-Path $TesseractDirectory $file))) {
        throw "Не найден $file в $TesseractDirectory. Нужен Tesseract OCR с русским и английским языками."
    }
}
py -3.12 -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Установите Python 3.12 x64.' }
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller==6.16.0
if ($LASTEXITCODE -ne 0) { throw 'Ошибка установки зависимостей.' }
& .\.venv\Scripts\python.exe -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw 'Проверки расчётов не пройдены.' }
& .\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --windowed --onedir --name Vedomost --add-data "$TesseractDirectory;ocr" run.py
if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки.' }
Write-Host 'Готово: dist\Vedomost\Vedomost.exe. Переносите всю папку Vedomost, включая _internal.'
Write-Host 'Проверьте импорт обоих видов PDF и выгрузку Word на Windows с отключённым интернетом.'
