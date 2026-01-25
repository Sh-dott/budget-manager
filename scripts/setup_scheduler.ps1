# Setup Windows Scheduled Task for Price Updates
# Run this script as Administrator to create the scheduled task

$taskName = "IsraeliSupermarketPriceUpdate"
$scriptPath = "C:\Users\Shai\web-projects\budget-manager\scripts\update_all_prices.bat"

# Remove existing task if exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create action
$action = New-ScheduledTaskAction -Execute $scriptPath

# Create trigger - every 2 days at 3:00 AM
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval 2 -At 3:00AM

# Create settings
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

# Register the task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Updates Israeli supermarket prices every 2 days"

Write-Host "Scheduled task '$taskName' created successfully!"
Write-Host "The task will run every 2 days at 3:00 AM"
