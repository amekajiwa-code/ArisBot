@echo off
REM Authorize the CURRENT folder for the Discord bridge (run from a project terminal).
REM Add C:\ClaudeNoritur to PATH and you can just type:  link
node "%~dp0bin\link.js" %*
