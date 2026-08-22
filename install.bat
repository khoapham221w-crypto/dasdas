@echo off
chcp 65001 >nul
title Cai Fast Code OCR
echo.
echo === CÀI FAST CODE OCR ===
echo.
where python >nul 2>nul
if errorlevel 1 (
    echo Chưa có Python.
    echo Hãy cài Python 3.11 hoặc 3.12 từ python.org, nhớ tick "Add Python to PATH".
    pause
    exit /b 1
)

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo.
echo Cài xong. Chạy run.bat
pause
