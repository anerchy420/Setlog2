@echo off
rem setlog2 をこのウィンドウで起動します（閉じると止まります。常時起動は README の pm2 を参照）
cd /d %~dp0..
node --disable-warning=ExperimentalWarning server\server.mjs
pause
