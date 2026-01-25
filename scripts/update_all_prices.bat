@echo off
REM Israeli Supermarket Price Updater - Runs every 2 days
REM Updates prices from all available chains

cd /d "C:\Users\Shai\web-projects\budget-manager"

echo ========================================
echo Israeli Supermarket Price Update
echo %date% %time%
echo ========================================

REM Update Shufersal (Node.js script)
echo.
echo [1/2] Updating Shufersal...
call node scripts/local_price_updater.js --chains=shufersal

REM Update other chains (Python script)
echo.
echo [2/2] Updating Victory, Rami Levy, Osher Ad, Tiv Taam...
call py scripts/scrape_simple.py victory rami_levy osher_ad tiv_taam

echo.
echo ========================================
echo Update Complete: %date% %time%
echo ========================================

REM Log completion
echo %date% %time% - Price update completed >> scripts\update_log.txt
