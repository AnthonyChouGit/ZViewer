param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZViewerIconCheck {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint PrivateExtractIconsW(string file, int index, int width, int height, IntPtr[] icons, uint[] ids, uint count, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
$resolved = (Resolve-Path -LiteralPath $Path).Path
foreach ($size in @(16,32,48,256)) {
    $icons = [IntPtr[]]::new(1)
    $ids = [uint32[]]::new(1)
    $count = [ZViewerIconCheck]::PrivateExtractIconsW($resolved,0,$size,$size,$icons,$ids,1,0)
    if ($count -ne 1 -or $icons[0] -eq [IntPtr]::Zero) { throw "Native icon extraction failed: $size" }
    [ZViewerIconCheck]::DestroyIcon($icons[0]) | Out-Null
    Write-Output "Native Windows icon extraction passed: ${size}px"
}
