# 一键发布游戏厅：启动服务器 + 公网隧道（localhost.run），并打印网址
# 用法：双击或在 PowerShell 里运行   ./publish-arcade.ps1
# 停止：关闭这个窗口后，再运行  Get-Process ssh,node | Stop-Process
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$PORT = 8765
$URL  = "http://127.0.0.1:$PORT/"

Write-Host "== 1/3 清理占用端口 ==" -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400

Write-Host "== 2/3 启动游戏厅服务器 ==" -ForegroundColor Cyan
$srv = Start-Process node -ArgumentList 'gomoku-server.mjs' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $r = Invoke-WebRequest $URL -UseBasicParsing -TimeoutSec 5
  Write-Host ("   本地服务 OK（{0} KB）" -f [math]::Round($r.RawContentLength / 1KB, 1)) -ForegroundColor Green
} catch {
  Write-Host "   本地服务启动失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "== 3/3 建立公网隧道 ==" -ForegroundColor Cyan
$log = Join-Path $PSScriptRoot 'tunnel.log'
Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
$tunnel = Start-Process ssh -ArgumentList `
  '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=NUL', `
  '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', `
  '-R', "80:localhost:$PORT", 'nokey@localhost.run' `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden

$public = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 800
  foreach ($f in @($log, "$log.err")) {
    if (Test-Path $f) {
      $m = [regex]::Match((Get-Content $f -Raw), 'https://[a-zA-Z0-9.-]+\.lhr\.life')
      if ($m.Success) { $public = $m.Value + '/'; break }
    }
  }
  if ($public) { break }
}

Write-Host ""
if ($public) {
  Write-Host "==================================================" -ForegroundColor Green
  Write-Host "  手机打开这个网址就能玩：" -ForegroundColor Green
  Write-Host "  $public" -ForegroundColor Yellow
  Write-Host "==================================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "· 前提：这台电脑、服务器进程、隧道进程都得保持运行"
  Write-Host "· 关掉窗口或电脑睡眠后网址失效，重新运行本脚本会得到新网址"
  Write-Host "· 停止服务：Get-Process ssh,node | Stop-Process"
  Write-Host "· 想长期固定网址：用 cloudflared / frp，或部署到有 Node 的服务器"
} else {
  Write-Host "隧道没拿到网址，看看 tunnel.log 里的错误。" -ForegroundColor Red
  Write-Host "备用：ssh -R 80:localhost:$PORT serveo.net"
}

Write-Host ""
Write-Host "（本窗口可以关掉，进程会继续在后台跑；要停就执行上面的停止命令）"
Read-Host "按回车关闭此窗口"
