# sakura-share
sakura-share是一个运行在cloudflare workers的sakura节点负载均衡器，注册节点数据存储在d1数据库，每一个发向它的请求会被导向到已注册且可用的节点，失效的节点会被自动清除。

## 使用方法：

### 公共端点：
1. `https://sakura-share.one/` ，可在任何调用sakura llm的地方使用，支持/completion /completions /v1/chat/completions /v1/models。

### 提供算力（Windows）（临时隧道）：

#### GUI方案
1. 从 [Sakura_Launcher_GUI](https://github.com/PiDanShouRouZhouXD/Sakura_Launcher_GUI/tags) 下载 Sakura GUI 启动器（0.0.5以上版本）。
2. 在GUI启动器中，`运行server`页面勾选`启动后自动共享`，或启动后在`共享`页面点击`上线`，即可一键共享你的Sakura给网友使用。

**目前仅限模型：**  
`sakura-14b-qwen2.5-v1.0-iq4xs`

## API 接口：

- `/register-node` —— 注册节点  
- `/verify-node` —— 验证节点是否存活  
- `/delete-node` —— 删除节点  
- `/health` —— 匹配旧版本llama.cpp的/health端点，访问可查看目前的槽位情况。

### 传入参数：

```json
{
  "url": "https://www.pocketpair.jp/"
}
```

<details>
<summary>Worker部署文档</summary>

## Worker部署文档

### 前置条件

1. 拥有一个Cloudflare账户
2. 安装了Node.js和npm
3. 安装了Wrangler CLI工具：`npm install -g wrangler`

### 步骤

1. 克隆项目仓库：
   ```
   git clone https://github.com/1PercentSync/sakura-share.git
   cd sakura-share
   ```

2. 登录到你的Cloudflare账户：
   ```
   wrangler login
   ```

3. 创建D1数据库：
   ```
   wrangler d1 create sakura-share
   ```
   记下输出中的数据库ID。

4. 修改`wrangler.toml`文件，将数据库ID替换为你刚刚创建的ID：
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "sakura-share"
   database_id = "你的数据库ID"
   ```

5. 创建数据库表nodes,列url

6. 部署Worker：
   ```
   wrangler deploy
   ```

7. （可选）如果你想在本地测试，可以运行：
   ```
   wrangler dev
   ```

### 注意事项

- 确保你的Cloudflare账户有足够的权限来创建和管理Workers和D1数据库。
- 部署后，记得更新你的DNS设置，将域名指向新部署的Worker。
- 定期检查和更新你的Worker代码，以确保安全性和性能。

</details>
