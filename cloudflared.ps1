function TakeNodeOffline($tunnelUrl) {
    try {
        $offlineResponse = Invoke-RestMethod -Uri "https://sakura-share.1percentsync.games/delete-node" `
                                             -Method Post `
                                             -Body (@{ url = $tunnelUrl } | ConvertTo-Json) `
                                             -ContentType "application/json"
        Write-Host "Offline Response: $offlineResponse"
    } catch {
        Write-Host "Error taking node offline: $_"
    }
}

function CheckLocalHealthStatus {
    $healthUrl = "http://localhost:8080/health"
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -Method Get
        if ($response.status -eq "ok" -or $response.status -eq "no slot available") {
            return $true
        } else {
            Write-Host "Local health status: Not healthy - $($response.status)"
            return $false
        }
    } catch {
        Write-Host "Error checking local health status: $_"
        return $false
    }
}

# 启动 Cloudflared 隧道
Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://localhost:8080", "--metrics", "localhost:8081"

# 等待 10 秒
Start-Sleep -Seconds 10

# 检查本地服务的健康状态
if (-not (CheckLocalHealthStatus)) {
    Write-Host "Local service is not healthy. Exiting script."
    exit
}

# 获取隧道 URL
$responseData = Invoke-WebRequest -Uri "http://localhost:8081/metrics" -Method Get
$tunnelUrl = ($responseData.Content | Select-String -Pattern "https://.*?\.trycloudflare\.com").Matches[0].Value

# 输出隧道 URL
Write-Host "Tunnel URL: $tunnelUrl"

# 注册到 API
try {
    $apiResponse = Invoke-RestMethod -Uri "https://sakura-share.1percentsync.games/register-node" -Method Post -Body (@{ url = $tunnelUrl } | ConvertTo-Json) -ContentType "application/json"
    Write-Host "API Response: $apiResponse"
} catch {
    Write-Host "Error registering node: $_"
}

# 开始每5秒检查健康状态
$healthCheckTimer = New-Object Timers.Timer
$healthCheckTimer.Interval = 5000 # 5秒
$healthCheckTimer.AutoReset = $true
Register-ObjectEvent -InputObject $healthCheckTimer -EventName Elapsed -Action {
    if (-not (CheckLocalHealthStatus)) {
        Write-Host "Local service is not healthy. Taking node offline."
        $healthCheckTimer.Stop()
        TakeNodeOffline $tunnelUrl
        exit
    }
}
$healthCheckTimer.Start()

# 等待用户回车
Read-Host -Prompt "Press Enter to close the tunnel"

# 停止定时器
$healthCheckTimer.Stop()

# 调用下线函数
TakeNodeOffline $tunnelUrl

# 结束 Cloudflared 进程
Stop-Process -Name "cloudflared" -Force
