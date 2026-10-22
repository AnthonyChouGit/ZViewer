# 下载并校验构建分发包需要的第三方工具：FRP 与 EasyTier（内嵌组网）。
# 缓存位于 desktop/.runtime/tools，重复构建命中缓存时仍校验 SHA-256。
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
        throw "Existing archive checksum mismatch: $File"
    }
    $temp = "$File.download"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = New-Object Net.WebClient
    $client.Headers['User-Agent'] = 'ZViewer-Desktop-Build'
    try { $client.DownloadFile($Url,$temp) } finally { $client.Dispose() }
    if ((File-Sha256 $temp) -ine $Sha256) { throw "Downloaded archive checksum mismatch: $Url" }
    Move-Item -LiteralPath $temp -Destination $File
}
$frpArchive = Join-Path $toolsDir 'frp_0.71.1_windows_amd64.zip'
Fetch-Verified 'https://github.com/fatedier/frp/releases/download/v0.71.1/frp_0.71.1_windows_amd64.zip' $frpArchive 'b90074b2b6a1d792a7a40f085ac6d276bcab2d1bc60201f8a86ca53ce65ce821'
if (-not (Test-Path -LiteralPath (Join-Path $toolsDir 'frp_0.71.1_windows_amd64\frpc.exe'))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($frpArchive,$toolsDir)
}
# 分发包只带客户端：缓存里也删掉服务端，避免误把 frps 打进包里。
foreach ($name in 'frps.exe','frps.toml') {
    Remove-Item -LiteralPath (Join-Path $toolsDir "frp_0.71.1_windows_amd64\$name") -Force -ErrorAction SilentlyContinue
}
Write-Output 'Pinned FRP archive verified'

# EasyTier：内嵌组网用免 TUN 模式，只要有 core + cli，另带 Packet.dll / WinDivert64.sys
# （缺了 core 启动会报 packet.dll 找不到）与 wintun.dll（TUN 兜底时才会用到）。
$etVersion = '2.6.4'
$etArchive = Join-Path $toolsDir "easytier-windows-x86_64-v$etVersion.zip"
Fetch-Verified "https://github.com/EasyTier/EasyTier/releases/download/v$etVersion/easytier-windows-x86_64-v$etVersion.zip" $etArchive '27af91e270e554709b048bd32327fefd2dfce5062ae1e8701af7550c6f525f84'
$etDir = Join-Path $toolsDir 'easytier'
$etSource = Join-Path $toolsDir 'easytier-windows-x86_64'
# 只挑这几个文件：发布包里的 easytier-web*.exe 是官方网页控制台，用不到。
$etFiles = 'easytier-core.exe','easytier-cli.exe','Packet.dll','WinDivert64.sys','wintun.dll'
if (-not (Test-Path -LiteralPath (Join-Path $etDir 'easytier-core.exe'))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (-not (Test-Path -LiteralPath $etSource)) { [IO.Compression.ZipFile]::ExtractToDirectory($etArchive,$toolsDir) }
    New-Item -ItemType Directory -Path $etDir -Force | Out-Null
    foreach ($name in $etFiles) {
        Copy-Item -LiteralPath (Join-Path $etSource $name) -Destination (Join-Path $etDir $name) -Force
    }
}
# LGPL-3.0 要求随二进制一起分发许可证全文，且二进制未做任何修改。
Fetch-Verified "https://raw.githubusercontent.com/EasyTier/EasyTier/v$etVersion/LICENSE" (Join-Path $etDir 'LICENSE-EasyTier.txt') 'e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118'
Write-Output 'Pinned EasyTier archive verified'
