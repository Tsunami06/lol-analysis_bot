param(
    [Parameter(Mandatory = $true)][string]$Group,
    [Parameter(Mandatory = $true)][string]$TextFile,
    [switch]$Mock,
    [int]$DelayMs = 600
)

$ErrorActionPreference = 'Stop'

function Find-WeChatWindow {
    $procs = Get-Process -Name Weixin, WeChat -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 }
    if ($procs) {
        return ($procs | Select-Object -First 1)
    }
    return $null
}

if ($Mock) {
    $preview = Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8
    if ($preview.Length -gt 40) { $preview = $preview.Substring(0, 40) }
    Write-Host "[mock] group=$Group preview=$preview"
    exit 0
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$target = Find-WeChatWindow
if (-not $target) {
    Write-Error "WeChat window not found. Make sure WeChat is running and logged in, and the main window is not hidden to tray."
    exit 1
}

$hwnd = $target.MainWindowHandle
[Win32]::ShowWindow($hwnd, 9) | Out-Null      # SW_RESTORE
[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

$shell = New-Object -ComObject WScript.Shell

# 1) open search, paste group name, enter
Set-Clipboard -Value $Group
$shell.SendKeys('^f')
Start-Sleep -Milliseconds 400
$shell.SendKeys('^v')
Start-Sleep -Milliseconds 900
$shell.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 800

# 2) paste message body, enter to send
$body = Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8
Set-Clipboard -Value $body
Start-Sleep -Milliseconds 200
$shell.SendKeys('^v')
Start-Sleep -Milliseconds $DelayMs
$shell.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 300

Write-Host "sent to group: $Group"
