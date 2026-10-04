# Starts the Unique Names card worker hidden every time you log in to Windows.
#   Install:  powershell -ExecutionPolicy Bypass -File install-autostart.ps1
#   Remove:   Unregister-ScheduledTask -TaskName "Unique Names card worker" -Confirm:$false
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = Join-Path (Split-Path -Parent (Get-Command python).Source) "pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "pythonw.exe not found next to python.exe" }
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $here "main.py") + '"') -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Unique Names card worker" -Action $action -Trigger $trigger -Settings $settings -Description "Makes Unique Names cards: Supabase queue -> ComfyUI -> upload" -Force | Out-Null
Start-ScheduledTask -TaskName "Unique Names card worker"
Write-Host "Installed and started. Log: $here\worker.log"
