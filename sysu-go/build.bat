@echo off
echo ============================================
echo   SYSU-GO Android Build (Debug APK)
echo ============================================
echo.

set JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr
set PATH=%JAVA_HOME%\bin;%PATH%

cd /d "%~dp0"
call gradlew.bat :app:assembleDebug --no-daemon

if %ERRORLEVEL% == 0 (
    echo.
    echo ============================================
    echo   BUILD SUCCESSFUL!
    echo   APK: app\build\outputs\apk\debug\app-debug.apk
    echo ============================================
) else (
    echo.
    echo ============================================
    echo   BUILD FAILED! Check errors above.
    echo ============================================
)

echo.
pause
