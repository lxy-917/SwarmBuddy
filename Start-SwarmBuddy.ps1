param([switch]$NoBrowser, [switch]$RestartBackend)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'SwarmBuddy'
$frontend = Join-Path $project 'web_ui\frontend'
$backend = Join-Path $project 'agent_service'
$python = Join-Path $project '.venv\Scripts\python.exe'
$vite = Join-Path $frontend 'node_modules\vite\bin\vite.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$page = 'http://localhost:5173/mission'

function Test-LocalPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.ConnectAsync('127.0.0.1', $port)
        return $connect.Wait(700) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-LocalPort([int]$port, [string]$name) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-LocalPort $port) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "$name did not start on port $port."
}

if (-not (Test-Path -LiteralPath $python)) { throw "Python environment missing: $python" }
if (-not (Test-Path -LiteralPath $vite)) { throw "Frontend dependencies missing: $vite" }

if ($RestartBackend -and (Test-LocalPort 8000)) {
    $listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop)
    $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($processIds.Count -ne 1) { throw 'Cannot identify a single backend process on port 8000.' }
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($processIds[0])"
    $expectedPython = (Resolve-Path -LiteralPath $python).Path
    $matchesLauncher = $serverProcess -and
        [string]::Equals($serverProcess.ExecutablePath, $expectedPython, [StringComparison]::OrdinalIgnoreCase) -and
        $serverProcess.CommandLine -match '(^|\s)"?main\.py"?(\s|$)'
    if (-not $matchesLauncher) {
        $processName = if ($serverProcess) { $serverProcess.Name } else { 'unknown' }
        Write-Host "Port 8000 owner: PID $($processIds[0]), $processName, $($serverProcess.ExecutablePath)"
        if ($processName -notmatch '^python(w)?\.exe$') {
            throw 'Port 8000 is not owned by a Python backend. Refusing to stop it.'
        }
        try {
            $api = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 3 -ErrorAction Stop
            $apiPaths = @($api.paths.PSObject.Properties.Name)
        } catch {
            throw 'Could not verify the service on port 8000 as SwarmBuddy. Refusing to stop it.'
        }
        if ($apiPaths -notcontains '/mission/scan/{session_id}' -or
            $apiPaths -notcontains '/project/skills/{agent_id}') {
            throw 'Port 8000 does not expose the SwarmBuddy API. Refusing to stop it.'
        }
        Write-Host 'Verified port 8000 as the SwarmBuddy API.'
    }
    Stop-Process -Id $processIds[0] -ErrorAction Stop
    for ($attempt = 0; $attempt -lt 20 -and (Test-LocalPort 8000); $attempt++) {
        Start-Sleep -Milliseconds 250
    }
    if (Test-LocalPort 8000) { throw 'Backend did not stop; port 8000 remains occupied.' }
}

# 某些受限终端会注入失效的本地代理；不要传给后端，
# 否则即使直连 HTTPS 可用，模型接口调用仍会失败。
foreach ($proxyName in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
    if ([Environment]::GetEnvironmentVariable($proxyName, 'Process') -eq 'http://127.0.0.1:9') {
        [Environment]::SetEnvironmentVariable($proxyName, $null, 'Process')
    }
}

if (-not (Test-LocalPort 6379)) {
    $memurai = 'D:\Memurai\memurai.exe'
    $config = 'D:\Memurai\memurai.conf'
    if (-not (Test-Path -LiteralPath $memurai) -or -not (Test-Path -LiteralPath $config)) {
        throw 'Memurai is not running and its installation was not found.'
    }
    Start-Process -FilePath $memurai -ArgumentList ('"' + $config + '"') -WorkingDirectory (Split-Path $memurai) -WindowStyle Hidden
    Wait-LocalPort 6379 'Memurai'
}

if (-not (Test-LocalPort 8000)) {
    Start-Process -FilePath $python -ArgumentList 'main.py' -WorkingDirectory $backend -WindowStyle Hidden
    Wait-LocalPort 8000 'Agent service'
}

if (-not (Test-LocalPort 5173)) {
    Start-Process -FilePath $node -ArgumentList @($vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $frontend -WindowStyle Hidden
    Wait-LocalPort 5173 'Web UI'
}

Write-Host "SwarmBuddy is ready: $page"
if (-not $NoBrowser) { Start-Process -FilePath $page }
