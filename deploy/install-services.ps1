#Requires -RunAsAdministrator
<#
    以 NSSM 把三個應用服務 + 排程器註冊成 Windows 服務（開機自動啟動）。
    以「系統管理員」開 PowerShell，然後：
        powershell -ExecutionPolicy Bypass -File deploy\install-services.ps1
    移除：deploy\uninstall-services.ps1
#>
$ErrorActionPreference = 'Stop'

$Root    = Split-Path -Parent $PSScriptRoot
$Python  = Join-Path $Root 'backend\env\Scripts\python.exe'
$Node    = (Get-Command node).Source
$NextBin = Join-Path $Root 'frontend\topictest\node_modules\next\dist\bin\next'
$LogDir  = Join-Path $Root 'deploy\logs'

foreach ($p in @($Python, $NextBin)) {
    if (-not (Test-Path $p)) { throw "找不到 $p，先確認 venv 與 npm install 都做過" }
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host '安裝 nssm...'
    choco install nssm -y
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path','User')
}
$nssm = (Get-Command nssm).Source

# 服務定義：名稱、執行檔、參數、工作目錄、額外環境變數
$services = @(
    @{ Name='stock-backend';   Exe=$Python; Args='-m uvicorn main:app --host 0.0.0.0 --port 8000';
       Dir=(Join-Path $Root 'backend');            Env=@('PYTHONIOENCODING=utf-8') }

    @{ Name='stock-rag';       Exe=$Python; Args='-m uvicorn api_server:app --host 0.0.0.0 --port 8001';
       Dir=(Join-Path $Root 'rag_deploy');         Env=@('PYTHONIOENCODING=utf-8') }

    @{ Name='stock-frontend';  Exe=$Node;   Args="`"$NextBin`" start -H 0.0.0.0 -p 3000";
       Dir=(Join-Path $Root 'frontend\topictest'); Env=@('NODE_ENV=production') }

    # 爬蟲＋向量管線排程：cnyes/LTN 每 30 分、FinMind 每日 17:00、抓完 10 分鐘後跑向量化。
    # QDRANT_HOST 不設的話向量會寫到本機 ./qdrant_db 而不是 docker 上的 Qdrant。
    @{ Name='stock-scheduler'; Exe=$Python; Args=(Join-Path $Root 'backend\crawler\scheduler_utils.py');
       Dir=$Root;                                  Env=@('PYTHONIOENCODING=utf-8','QDRANT_HOST=localhost') }
)

foreach ($s in $services) {
    $n = $s.Name
    if (Get-Service -Name $n -ErrorAction SilentlyContinue) {
        Write-Host "移除既有服務 $n"
        & $nssm stop $n confirm | Out-Null
        & $nssm remove $n confirm | Out-Null
        Start-Sleep -Seconds 1
    }

    Write-Host "安裝 $n"
    & $nssm install $n $s.Exe $s.Args
    & $nssm set $n AppDirectory       $s.Dir
    & $nssm set $n DisplayName        "Stock Lighthouse - $n"
    & $nssm set $n Start              SERVICE_AUTO_START
    & $nssm set $n AppEnvironmentExtra $s.Env
    & $nssm set $n AppStdout          (Join-Path $LogDir "$n.log")
    & $nssm set $n AppStderr          (Join-Path $LogDir "$n.log")
    & $nssm set $n AppRotateFiles     1
    & $nssm set $n AppRotateBytes     10485760      # 10MB 輪替，免得硬碟被 log 塞爆
    # 掛掉後重啟，但連續失敗時退避，避免設定錯誤時瘋狂重啟
    & $nssm set $n AppExit Default    Restart
    & $nssm set $n AppRestartDelay    5000
    & $nssm set $n AppThrottle        10000
}

foreach ($s in $services) { & $nssm start $s.Name }

Start-Sleep -Seconds 5
Get-Service stock-* | Format-Table Name, Status, StartType -AutoSize
Write-Host "`nlog 在 $LogDir"
Write-Host '反代（nginx + cloudflared）由 Docker 自己 restart:unless-stopped 顧，不用進 NSSM。'
