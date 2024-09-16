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

# ���� Cloudflared ���
Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://localhost:8080", "--metrics", "localhost:8081"

# �ȴ� 10 ��
Start-Sleep -Seconds 10

# ��鱾�ط���Ľ���״̬
if (-not (CheckLocalHealthStatus)) {
    Write-Host "Local service is not healthy. Exiting script."
    exit
}

# ��ȡ��� URL
$responseData = Invoke-WebRequest -Uri "http://localhost:8081/metrics" -Method Get
$tunnelUrl = ($responseData.Content | Select-String -Pattern "https://.*?\.trycloudflare\.com").Matches[0].Value

# ������ URL
Write-Host "Tunnel URL: $tunnelUrl"

# ע�ᵽ API
try {
    $apiResponse = Invoke-RestMethod -Uri "https://sakura-share.1percentsync.games/register-node" -Method Post -Body (@{ url = $tunnelUrl } | ConvertTo-Json) -ContentType "application/json"
    Write-Host "API Response: $apiResponse"
} catch {
    Write-Host "Error registering node: $_"
}

# ��ʼÿ5���齡��״̬
$healthCheckTimer = New-Object Timers.Timer
$healthCheckTimer.Interval = 5000 # 5��
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

# �ȴ��û��س�
Read-Host -Prompt "Press Enter to close the tunnel"

# ֹͣ��ʱ��
$healthCheckTimer.Stop()

# �������ߺ���
TakeNodeOffline $tunnelUrl

# ���� Cloudflared ����
Stop-Process -Name "cloudflared" -Force
