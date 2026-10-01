@echo off
if /I "%1"=="test" (
  node scripts\nlo-chatgpt-plugin-runtime-probe.mjs
  exit /b %ERRORLEVEL%
)
echo Unsupported isolated npm shim invocation 1>&2
exit /b 2
