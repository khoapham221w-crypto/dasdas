@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Build Fast Code OCR EXE
echo.
echo === BUILD FILE EXE PORTABLE ===
echo.
python -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --name FastCodeOCR ^
  --collect-all rapidocr_onnxruntime ^
  main.py

echo.
echo Nếu build thành công, file nằm ở:
echo dist\FastCodeOCR.exe
pause
