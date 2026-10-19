param([ValidateSet('inspect','stop')][string]$Action, [int]$ProcessId, [int]$Port, [string]$ExpectedPath, [int]$UdpPort = 0, [int]$MediaTcpPort = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Get-NetTCPConnection reports an empty State on some Windows builds, and netstat can
# miss loopback listeners there, so try both and treat a bound socket without a peer
# as a listener when the state is unavailable.
function Get-ListenerPids([int]$localPort) {
    $pids = @()
    foreach ($line in @(netstat.exe -ano -p TCP 2>$null)) {
        if ($line -match ('^\s*TCP\s+\S+:' + $localPort + '\s+\S+\s+LISTENING\s+(\d+)\s*$')) { $pids += [int]$Matches[1] }
    }
    if ($pids.Count -eq 0) {
        $pids = @(Get-NetTCPConnection -LocalPort $localPort -ErrorAction SilentlyContinue |
            Where-Object { ($_.State -eq 'Listen') -or ($null -eq $_.State -and $_.RemotePort -eq 0) } |
            ForEach-Object { $_.OwningProcess } | Select-Object -Unique)
    }
    return @($pids)
}
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
if (-not $process -or $process.ExecutablePath -ine $ExpectedPath) { throw 'Managed process exited or executable path does not match' }
if ($Action -eq 'stop') {
    & taskkill.exe /PID $ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { throw 'Failed to stop the owned process tree' }
} else {
    $listenerPids = @(Get-ListenerPids $Port)
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
    if ($MediaTcpPort -gt 0) { $tcpOwners = @(Get-ListenerPids $MediaTcpPort) }
    @{ owner = @($listenerPids); udpOwner = $udpOwners; udpAddresses = $udpAddresses; rtcOwner = $tcpOwners; members = @($ProcessId) + @($children | ForEach-Object { $_.ProcessId }); children = $children } | ConvertTo-Json -Compress -Depth 4
}
