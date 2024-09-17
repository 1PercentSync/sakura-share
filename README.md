# sakura-share
sakura-share是一个运行在cloudflare workers的sakura节点负载均衡器，注册节点数据存储在d1数据库，每一个发向它的请求会被导向到已注册且可用的节点，失效的节点会被自动清除。

## 使用方法：

### 公共端点：
1. `https://sakura-share.1percentsync.games/` ，可在任何调用sakura llm的地方使用，支持/completion /completions /v1/chat/completions。

### 提供算力（Windows）（临时隧道）：
0. 从 [cloudflared](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe) 下载cloudflared并安装
1. 下载脚本：[cloudflared.ps1](https://github.com/1PercentSync/sakura-share/raw/main/cloudflared.ps1)。
2. 在启动一键包后,等待模型加载后，启动该脚本，会自动注册节点，按回车下线。

**目前仅限模型：**  
`sakura-14b-qwen2beta-v0.9.2-iq4xs`

## API 接口：

- `/register-node` —— 注册节点  
- `/verify-node` —— 验证节点是否存活  
- `/delete-node` —— 删除节点  

### 传入参数：

```json
{
  "url": "https://www.pocketpair.jp/"
}
```