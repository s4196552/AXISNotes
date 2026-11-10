param([Parameter(Mandatory=$true)][string]$Application)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AxisIconProbe {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr hwnd, int index);
}
'@
$appProcess = Get-Process axisnotes | Where-Object { $_.Path -eq $Application -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $appProcess) { throw 'Test app window not found.' }
$handle = [AxisIconProbe]::SendMessage($appProcess.MainWindowHandle, 0x7f, [IntPtr]1, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::Zero) { $handle = [AxisIconProbe]::GetClassLongPtr($appProcess.MainWindowHandle, -14) }
if ($handle -eq [IntPtr]::Zero) { $handle = [AxisIconProbe]::SendMessage($appProcess.MainWindowHandle, 0x7f, [IntPtr]::Zero, [IntPtr]::Zero) }
if ($handle -eq [IntPtr]::Zero) { $handle = [AxisIconProbe]::GetClassLongPtr($appProcess.MainWindowHandle, -34) }
if ($handle -eq [IntPtr]::Zero) { throw 'Window has no icon.' }
$icon = [System.Drawing.Icon]::FromHandle($handle)
$bitmap = $icon.ToBitmap()
$stream = [IO.MemoryStream]::new()
try {
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { [Convert]::ToBase64String($sha.ComputeHash($stream.ToArray())) } finally { $sha.Dispose() }
} finally { $stream.Dispose(); $bitmap.Dispose() }
# The HICON is owned by the app: never destroy it in this read-only probe.
