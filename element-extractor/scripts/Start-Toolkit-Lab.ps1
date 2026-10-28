# Standalone Windows launcher. Existing checkouts and running servers are untouched.
# Uses only Git, Node/npm, and the toolkit's local Workers runtime. No deployment.
$ErrorActionPreference = 'Stop'
$server = $null
$ready = $false
try {
    foreach ($tool in @('git.exe', 'node.exe', 'npm.cmd')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Missing $tool. Install Git and Node.js LTS, then reopen PowerShell."
        }
    }
    $nodeVersion = & node.exe --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
        throw 'Node.js 22 or newer is required. Install current Node.js LTS.'
    }

    $documents = [Environment]::GetFolderPath('MyDocuments')
    if (-not $documents) { $documents = Join-Path $HOME 'Documents' }
    $folder = Join-Path $documents ('Toolkit-Lab-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
    Write-Host "Creating a separate project copy: $folder"
    & git.exe clone --depth 1 --single-branch --branch codex/general-table-extraction https://github.com/AmericanElegy/GenericScraperToolkitt.git $folder
    if ($LASTEXITCODE -ne 0) { throw 'Git clone failed. The existing project has not been changed.' }
    $app = Join-Path $folder 'element-extractor'
    Push-Location $app
    try {
        Write-Host 'Project revision:'
        & git.exe log -1 --oneline
        if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the downloaded revision.' }
        if (-not (Test-Path 'src/interpretation/lab-api.js')) { throw 'Downloaded revision does not contain Interpretation Lab.' }
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Worker build failed.' }
    } finally { Pop-Location }

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $outLog = Join-Path $folder 'server-output.log'
    $errLog = Join-Path $folder 'server-errors.log'
    $oldPort = [Environment]::GetEnvironmentVariable('PORT', 'Process')
    try {
        $env:PORT = [string]$port
        $node = (Get-Command node.exe).Source
        $server = Start-Process -FilePath $node -ArgumentList 'scripts/dev.mjs' -WorkingDirectory $app -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    } finally {
        [Environment]::SetEnvironmentVariable('PORT', $oldPort, 'Process')
    }

    $url = "http://127.0.0.1:$port/interpretation"
    $workspaceUrl = "http://127.0.0.1:$port/workspace"
    Write-Host "Checking the page and offline backend at $url ..."
    $lastProblem = 'Server did not become ready.'
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $server.Refresh()
        if ($server.HasExited) { throw 'The local Workers server stopped during startup.' }
        try {
            $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<h1>Interpretation Lab</h1>') {
                throw 'Server returned an unexpected page.'
            }
            $body = @{ example_id = 'scores-and-correction' } | ConvertTo-Json -Compress
            $check = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/interpretation/start" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3
            if (-not $check.job -or -not $check.validation) { throw 'Offline backend response is incomplete.' }
            $storageBody = @{ action = 'status' } | ConvertTo-Json -Compress
            $feedbackStorage = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/interpretation/storage" -Method Post -ContentType 'application/json' -Body $storageBody -TimeoutSec 3
            if ($feedbackStorage.PSObject.Properties.Name -notcontains 'enabled') { throw 'Feedback storage endpoint is missing.' }
            $workspacePage = Invoke-WebRequest -Uri $workspaceUrl -UseBasicParsing -TimeoutSec 3
            if ($workspacePage.StatusCode -ne 200 -or $workspacePage.Content -notmatch '<h1>Your scraping workspace</h1>') { throw 'Workspace page is missing.' }


            $ready = $true
            break
        } catch { $lastProblem = $_.Exception.Message }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Readiness check failed: $lastProblem" }
    Write-Host "PASS: Interpretation Lab page and offline backend verified."
    Write-Host "Project saved at: $folder"
    Write-Host "Open batch workspace: $workspaceUrl"
    Write-Host "Single-page lab: $url"
    Write-Host "To stop this server only: Stop-Process -Id $($server.Id)"
    Write-Host "Server logs: $outLog and $errLog"
    if ($feedbackStorage.enabled) { Write-Host ("Feedback folder: " + $feedbackStorage.directory) }
    else { Write-Host ("Feedback setup: " + $feedbackStorage.message) }
    Write-Host 'Feedback autosave: the app detects a single Google Drive My Drive mount, or asks for its folder once.'
    Write-Host 'Feedback files stay in the dedicated Drive folder across launcher updates. Check the Feedback autosave panel.'
    Write-Host 'This server runs locally. Nothing was deployed or enabled in Cloudflare.'
    Start-Process $workspaceUrl
} catch {
    if ($server -and -not $ready) {
        Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    }
    Write-Host ("FAILED: " + $_.Exception.Message) -ForegroundColor Red
    if ($errLog -and (Test-Path $errLog)) { Get-Content $errLog -Tail 30 }
    Write-Host 'Copy this output back to the chat. Existing projects and servers were left alone.'
    exit 1
}
