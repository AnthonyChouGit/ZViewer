param([ValidateSet('inspect','stop')][string]$Action, [int]$ProcessId, [int]$Port, [string]$ExpectedPath, [int]$UdpPort = 0, [int]$MediaTcpPort = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
if (-not $process -or $process.ExecutablePath -ine $ExpectedPath) { throw 'Managed process exited or executable path does not match' }
if ($Action -eq 'stop') {
    & taskkill.exe /PID $ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { throw 'Failed to stop the owned process tree' }
} else {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $children = @()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($ProcessId)
    while ($queue.Count -gt 0) {
        $parentId = $queue.Dequeue()
        foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentId")) {
            $children += @{ ProcessId = $child.ProcessId; Name = $child.Name }
            $queue.Enqueue([int]$child.ProcessId)
        }
    }
    $udpOwners = @()
    $udpAddresses = @()
    $tcpOwners = @()
    if ($UdpPort -gt 0) { $udpEndpoints = @(Get-NetUDPEndpoint -LocalPort $UdpPort -ErrorAction SilentlyContinue); $udpOwners = @($udpEndpoints | ForEach-Object { $_.OwningProcess }); $udpAddresses = @($udpEndpoints | ForEach-Object { $_.LocalAddress }) }
    if ($MediaTcpPort -gt 0) { $tcpOwners = @(Get-NetTCPConnection -LocalPort $MediaTcpPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }) }
    @{ owner = @($listeners | ForEach-Object { $_.OwningProcess }); udpOwner = $udpOwners; udpAddresses = $udpAddresses; rtcOwner = $tcpOwners; members = @($ProcessId) + @($children | ForEach-Object { $_.ProcessId }); children = $children } | ConvertTo-Json -Compress -Depth 4
}
