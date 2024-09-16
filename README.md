# Sakura-Share

### 食用方法：

#### 玩家：
1. 把 `https://sakura-share.1percentsync.games/` 填进绿站。

#### 帕鲁：
1. 下载脚本：[cloudflared.ps1](https://github.com/1PercentSync/sakura-share/raw/main/cloudflared.ps1)。
2. 在启动一键包后，启动该脚本，会自动注册节点，按回车下线。

**目前仅限模型：**  
`sakura-14b-qwen2beta-v0.9.2-iq4xs`

#### 服主：
1. 建立一个 Cloudflare Worker。
2. 复制粘贴 [worker.js](https://github.com/1PercentSync/sakura-share/raw/main/worker.js) 文件里的内容。

---

### API 接口：

- `/register-node` —— 注册节点  
- `/verify-node` —— 验证节点是否存活  
- `/delete-node` —— 删除节点  

#### 传入参数：

```json
{
  "url": "https://www.pocketpair.jp/"
}
```