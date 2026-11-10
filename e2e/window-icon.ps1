param([Parameter(Mandatory=$true)][string]$Application, [ValidateSet('Big', 'Small')][string]$Kind = 'Big')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AxisIconProbe {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
$appProcess = Get-Process axisnotes | Where-Object { $_.Path -eq $Application -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $appProcess) { throw 'Test app window not found.' }
$size = if ($Kind -eq 'Big') { [IntPtr]1 } else { [IntPtr]::Zero }
$handle = [AxisIconProbe]::SendMessage($appProcess.MainWindowHandle, 0x7f, $size, [IntPtr]::Zero)
# Never fall back: a small/class icon cannot establish that ICON_BIG reached the taskbar.
if ($handle -eq [IntPtr]::Zero) { throw "Window has no explicit $Kind icon." }
$icon = [System.Drawing.Icon]::FromHandle($handle)
$bitmap = $icon.ToBitmap()
$stream = [IO.MemoryStream]::new()
try {
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { [Convert]::ToBase64String($sha.ComputeHash($stream.ToArray())) } finally { $sha.Dispose() }
} finally { $stream.Dispose(); $bitmap.Dispose() }
# The HICON is owned by the app: never destroy it in this read-only probe.
