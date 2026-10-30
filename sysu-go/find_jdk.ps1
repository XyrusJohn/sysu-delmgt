# Find JDK in Android Studio
$paths = @(
    'C:\Program Files\Android\Android Studio\jbr',
    'C:\Program Files\Android\Android Studio\jre',
    'C:\Program Files\JetBrains\Toolbox\apps\*\**\jbr',
    'C:\Program Files\JetBrains\*\jbr'
)
foreach ($p in $paths) {
    $resolved = Resolve-Path $p -ErrorAction SilentlyContinue
    if ($resolved) {
        Write-Host "Found: $($resolved.Path)"
        $javaExe = Get-ChildItem "$($resolved.Path)\bin\java.exe" -ErrorAction SilentlyContinue
        if ($javaExe) {
            Write-Host "java.exe: $($javaExe.FullName)"
            Write-Host "JAVA_HOME candidate: $($resolved.Path)"
        }
    }
}
# Try to find jvm.cfg
$jvmcfg = Get-ChildItem -Path 'C:\Program Files\Android\Android Studio' -Filter 'jvm.cfg' -Recurse -Depth 8 -ErrorAction SilentlyContinue
Write-Host "jvm.cfg locations: $($jvmcfg.FullName -join ', ')"