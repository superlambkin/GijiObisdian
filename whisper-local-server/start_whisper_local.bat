@echo off
REM Whisper ローカルサーバ起動スクリプト（Windows）
REM 環境変数 WHISPER_MODEL / WHISPER_HOST / WHISPER_PORT / WHISPER_DOWNLOAD_ROOT は launcher から渡される

setlocal

cd /d "%~dp0"

REM 仮想環境があればアクティベート（任意）
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Python パス（環境に応じて調整）
set PYTHON_EXE=python
where %PYTHON_EXE% >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found in PATH
    exit /b 1
)

REM サーバ起動
%PYTHON_EXE% whisper_server.py
