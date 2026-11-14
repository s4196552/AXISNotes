param([Parameter(Mandatory=$true)][string]$Application)
# Prints the main window's explicit AppUserModelID and relaunch icon ("|" separated, empty when
# unset). Read-only: Windows groups the taskbar button by this ID and draws the shortcut's icon
# for the installed one, so a custom logo needs its own (see src-tauri/src/taskbar_icon.rs).
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAxisPropertyStore { int GetCount(out uint c); int GetAt(uint i, out AxisKey k); int GetValue(ref AxisKey k, IntPtr v); int SetValue(ref AxisKey k, IntPtr v); int Commit(); }
[StructLayout(LayoutKind.Sequential, Pack=4)] public struct AxisKey { public Guid f; public uint p; }
public static class AxisIdentityProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid riid, out IAxisPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(IntPtr v);
  public static IntPtr MainWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var t = new StringBuilder(64); GetWindowText(h, t, 64);
      if (p == pid && t.ToString() == "AXISNotes") { found = h; return false; } return true; }, IntPtr.Zero);
    return found; }
  static string Read(IAxisPropertyStore ps, uint pid) {
    var k = new AxisKey { f = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), p = pid };
    IntPtr v = Marshal.AllocCoTaskMem(24); for (int i = 0; i < 24; i++) Marshal.WriteByte(v, i, 0);
    try { ps.GetValue(ref k, v); return Marshal.ReadInt16(v) == 31 ? Marshal.PtrToStringUni(Marshal.ReadIntPtr(v, 8)) : ""; }
    finally { PropVariantClear(v); Marshal.FreeCoTaskMem(v); } }
  public static string Identity(IntPtr h) {
    Guid g = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IAxisPropertyStore ps;
    int hr = SHGetPropertyStoreForWindow(h, ref g, out ps); if (hr != 0) throw new Exception("SHGetPropertyStoreForWindow " + hr);
    try { return Read(ps, 5) + "|" + Read(ps, 3); } finally { Marshal.ReleaseComObject(ps); } }
}
'@
$window = [IntPtr]::Zero
foreach ($appProcess in Get-Process axisnotes | Where-Object { $_.Path -eq $Application }) {
  $window = [AxisIdentityProbe]::MainWindow([uint32]$appProcess.Id)
  if ($window -ne [IntPtr]::Zero) { break }
}
if ($window -eq [IntPtr]::Zero) { throw 'Test app window not found.' }
[AxisIdentityProbe]::Identity($window)
