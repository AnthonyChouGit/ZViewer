$ErrorActionPreference = 'Stop'
$desktopDir = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $desktopDir '.runtime'
$toolsDir = Join-Path $cacheDir 'tools'
New-Item -ItemType Directory -Path $cacheDir,$toolsDir -Force | Out-Null
function File-Sha256([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Fetch-Verified([string]$Url, [string]$File, [string]$Sha256) {
    if (Test-Path -LiteralPath $File) {
        if ((File-Sha256 $File) -ieq $Sha256) { return }
        throw "Existing runtime archive checksum mismatch: $File"
    }
    $temp = "$File.download"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = New-Object Net.WebClient
    $client.Headers['User-Agent'] = 'ZViewer-Desktop-Build'
    try { $client.DownloadFile($Url,$temp) } finally { $client.Dispose() }
    if ((File-Sha256 $temp) -ine $Sha256) { throw "Downloaded runtime checksum mismatch: $Url" }
    Move-Item -LiteralPath $temp -Destination $File
}
Fetch-Verified 'https://github.com/electron/electron/releases/download/v44.9.0/electron-v44.9.0-win32-x64.zip' (Join-Path $cacheDir 'electron-v44.9.0-win32-x64.zip') '88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931'
$frpArchive = Join-Path $toolsDir 'frp_0.71.1_windows_amd64.zip'
Fetch-Verified 'https://github.com/fatedier/frp/releases/download/v0.71.1/frp_0.71.1_windows_amd64.zip' $frpArchive 'b90074b2b6a1d792a7a40f085ac6d276bcab2d1bc60201f8a86ca53ce65ce821'
if (-not (Test-Path -LiteralPath (Join-Path $toolsDir 'frp_0.71.1_windows_amd64\frpc.exe'))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($frpArchive,$toolsDir)
}
Write-Output 'Pinned Electron and FRP archives verified'
