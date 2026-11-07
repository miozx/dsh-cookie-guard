# 打开 DSH Cookie Guard 面板
# DSH 每次启动端口都会变，所以这里自动找：
#   枚举本机 127.0.0.1 上正在监听的端口，逐个试 /cookie-guard/，第一个 200 的就是它。
$ErrorActionPreference = 'SilentlyContinue'

$ports = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 |
  Select-Object -ExpandProperty LocalPort -Unique | Sort-Object

$found = $null
foreach ($p in $ports) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/cookie-guard/api/status" -TimeoutSec 2 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $found = $p; break }
  } catch { }
}

if ($found) {
  $url = "http://127.0.0.1:$found/cookie-guard/"
  Write-Host ""
  Write-Host "  找到面板: $url" -ForegroundColor Green
  Write-Host ""
  Start-Process $url
} else {
  Write-Host ""
  Write-Host "  没找到面板。" -ForegroundColor Yellow
  Write-Host "  可能的原因：" -ForegroundColor Yellow
  Write-Host "   1) DSH 没在运行（先双击桌面「DSH（带体检启动）」）"
  Write-Host "   2) 插件没加载（看 C:\Users\$env:USERNAME\.dsh\cookie-guard\state\mount.log）"
  Write-Host ""
  Read-Host "  按回车关闭"
}
