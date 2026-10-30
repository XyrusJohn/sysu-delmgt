$env:JAVA_HOME = 'C:\Program Files\JetBrains\IntelliJ IDEA 2025.3\jbr'
$env:Path = 'C:\Program Files\JetBrains\IntelliJ IDEA 2025.3\jbr\bin;' + $env:Path
$output = & 'C:\Users\xyver\StudioProjects\sysu-go\gradlew.bat' '-p' 'C:\Users\xyver\StudioProjects\sysu-go' ':app:assembleDebug' '--no-daemon' 2>&1
$output | Select-Object -Last 60