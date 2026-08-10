@echo off
cd /d %~dp0
set PYTHONIOENCODING=utf-8
if not exist .venv\Scripts\activate.exe (
  echo venv がありません。Task 1 の手順で構築してください。
  exit /b 1
)
call .venv\Scripts\activate
python main.py
