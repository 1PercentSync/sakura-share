class Node {
    constructor(url, status = {}) {
        this.url = url;
        this.weight = status.slotsIdle || 1;
        this.activeConnections = status.slotsProcessing || 0;
        this.avgResponseTime = status.avgResponseTime || 0;
        this.lastCheckTime = status.lastCheckTime || Date.now();
        this.totalRequests = status.totalRequests || 0;
        this.successfulRequests = status.successfulRequests || 0;
        this.consecutiveFailures = status.consecutiveFailures || 0;
        this.isAvailable = status.isAvailable !== undefined ? status.isAvailable : true;
    }

    get score() {
        if (!this.isAvailable) return -Infinity;
        const successRate = this.totalRequests > 0 ? this.successfulRequests / this.totalRequests : 1;
        const loadFactor = Math.max(1, this.activeConnections);
        return (this.weight * successRate) / (this.avgResponseTime * loadFactor);
    }

    updateStatus(status) {
        this.weight = status.slotsIdle || 1;
        this.activeConnections = status.slotsProcessing || 0;
        this.isAvailable = status.status === "ok" || status.status === "no slot available";
        this.lastCheckTime = Date.now();
    }

    recordRequest(success, responseTime) {
        this.totalRequests++;
        if (success) {
            this.successfulRequests++;
            this.consecutiveFailures = 0;
            this.avgResponseTime = (this.avgResponseTime * (this.totalRequests - 1) + responseTime) / this.totalRequests;
        } else {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= 5) {
                this.isAvailable = false;
            }
        }
    }

    toJSON() {
        return {
            url: this.url,
            weight: this.weight,
            activeConnections: this.activeConnections,
            avgResponseTime: this.avgResponseTime,
            lastCheckTime: this.lastCheckTime,
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            consecutiveFailures: this.consecutiveFailures,
            isAvailable: this.isAvailable
        };
    }
}

class LoadBalancer {
    constructor(env) {
        this.env = env;
        this.nodes = new Map();
        this.requestQueue = [];
        this.ipNodeAffinity = new Map();
        this.userRequestLimits = new Map(); // 用于跟踪用户请求限制
        this.requestLimitPerSecond = 5; // 每个用户每秒最多允许的请求数
    }

    async init() {
        const storedNodes = await this.getNodesFromDB();
        for (const [url, status] of Object.entries(storedNodes)) {
            this.nodes.set(url, new Node(url, status));
        }
    }

    async getNodesFromDB() {
        const { results } = await this.env.DB.prepare("SELECT * FROM node_status").all();
        return results.reduce((acc, row) => {
            acc[row.url] = JSON.parse(row.status);
            return acc;
        }, {});
    }

    async saveState() {
        const nodeStatus = Array.from(this.nodes.entries()).map(([url, node]) => ({
            url,
            status: JSON.stringify(node.toJSON())
        }));

        const db = this.env.DB;
        await db.prepare("DELETE FROM node_status").run();
        for (const node of nodeStatus) {
            await db.prepare("INSERT INTO node_status (url, status) VALUES (?, ?)").bind(node.url, node.status).run();
        }
    }

    addNode(url) {
        if (!this.nodes.has(url)) {
            this.nodes.set(url, new Node(url));
        }
    }

    updateNodeStatus(url, status) {
        const node = this.nodes.get(url);
        if (node) {
            node.updateStatus(status);
        }
    }

    selectNode() {
        let bestNode = null;
        let bestScore = -Infinity;

        for (const node of this.nodes.values()) {
            if (node.score > bestScore) {
                bestScore = node.score;
                bestNode = node;
            }
        }

        return bestNode;
    }

    async handleRequest(request) {
        const clientIP = request.headers.get('CF-Connecting-IP');
        const url = new URL(request.url);
        const segmentNumber = parseInt(url.searchParams.get('segment') || '1');
        const requiredSlots = parseInt(url.searchParams.get('slots') || '1');
        
        // 检查用户请求限制
        if (!this.checkAndUpdateUserRequestLimit(clientIP)) {
            return new Response('Rate limit exceeded', { status: 429 });
        }

        let allocatedNode = this.selectNodeWithSufficientSlots(requiredSlots);

        if (!allocatedNode) {
            // 如果没有足够的slot，将请求加入队列
            return new Promise((resolve, reject) => {
                this.requestQueue.push({ request, resolve, reject, priority: Math.sqrt(segmentNumber), requiredSlots });
                this.processQueue();
            });
        }

        return this.processRequestWithAllocatedSlots(allocatedNode, requiredSlots, request);
    }

    checkAndUpdateUserRequestLimit(clientIP) {
        const now = Date.now();
        const userLimit = this.userRequestLimits.get(clientIP) || { count: 0, lastReset: now };
        
        if (now - userLimit.lastReset > 1000) {
            // 重置计数器
            userLimit.count = 1;
            userLimit.lastReset = now;
        } else {
            userLimit.count++;
        }

        this.userRequestLimits.set(clientIP, userLimit);

        return userLimit.count <= this.requestLimitPerSecond;
    }

    selectNodeWithSufficientSlots(requiredSlots) {
        let bestNode = null;
        let bestScore = -Infinity;

        for (const node of this.nodes.values()) {
            if (!node.isAvailable) continue;
            const availableSlots = node.weight - node.activeConnections;
            if (availableSlots >= requiredSlots) {
                const score = node.score;
                if (score > bestScore) {
                    bestScore = score;
                    bestNode = node;
                }
            }
        }

        return bestNode;
    }

    async processRequestWithAllocatedSlots(node, requiredSlots, request) {
        node.activeConnections += requiredSlots;
        const startTime = Date.now();

        try {
            const modifiedRequest = new Request(request);
            modifiedRequest.headers.set('X-Allocated-Slots', requiredSlots.toString());

            const response = await fetch(node.url + new URL(request.url).pathname, {
                method: modifiedRequest.method,
                headers: modifiedRequest.headers,
                body: modifiedRequest.body,
                redirect: 'follow'
            });

            const endTime = Date.now();
            node.recordRequest(response.ok, endTime - startTime);

            return response;
        } catch (error) {
            console.error(`Error proxying to node ${node.url}:`, error);
            node.recordRequest(false, 0);
            return new Response('Error processing request', { status: 500 });
        } finally {
            node.activeConnections -= requiredSlots;
            this.processQueue();
        }
    }

    selectNodeWithAffinity(clientIP, segmentNumber) {
        const now = Date.now();
        const affinityNode = this.ipNodeAffinity.get(clientIP);
        
        if (affinityNode && this.nodes.has(affinityNode) && now - this.nodes.get(affinityNode).lastUsed < 3600000) {
            return this.nodes.get(affinityNode);
        }

        let bestNode = null;
        let bestScore = -Infinity;

        for (const node of this.nodes.values()) {
            if (!node.isAvailable) continue;
            const score = node.score + Math.sqrt(segmentNumber);
            if (score > bestScore) {
                bestScore = score;
                bestNode = node;
            }

        }

        if (bestNode) {
            this.ipNodeAffinity.set(clientIP, bestNode.url);
            bestNode.lastUsed = now;
        }

        return bestNode;
    }

    async processQueue() {
        if (this.requestQueue.length === 0) return;

        const availableNode = this.selectNode();
        if (!availableNode) return;

        this.requestQueue.sort((a, b) => b.priority - a.priority);
        const { request, resolve, reject, requiredSlots } = this.requestQueue.shift();
        
        try {
            const response = await this.processRequestWithAllocatedSlots(availableNode, requiredSlots, request);
            resolve(response);
        } catch (error) {
            reject(error);
        }
    }

    async performHealthCheck() {
        const now = Date.now();
        const checkPromises = Array.from(this.nodes.entries()).map(async ([url, node]) => {
            if (now - node.lastCheckTime >= 5000) {  // 5 seconds
                try {
                    const status = await getNodeStatus(url);
                    if (status) {
                        this.updateNodeStatus(url, status);
                    } else {
                        await this.removeNode(url);
                    }
                } catch (error) {
                    console.error(`Health check failed for node ${url}:`, error);
                    node.isAvailable = false;
                    if (node.consecutiveFailures >= 3) {
                        await this.removeNode(url);
                    }
                }
            }
        });

        await Promise.all(checkPromises);
        await this.saveState();
    }

    async removeNode(url) {
        this.nodes.delete(url);
        await removeNode(url, this.env);
        await this.saveState();
    }
}

let loadBalancer;

// 注册节点端点
async function registerNode(request, env) {
    let { url } = await request.json();
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠
    const healthUrl = `${url}/health`;

    try {
        const response = await fetch(healthUrl, { method: 'GET' });
        const result = await response.json();

        if ((result.status === "ok" || result.status === "no slot available") && await verifyModelFingerprint(url)) {
            await addNode(url, env);
            return new Response('Node registered successfully', { status: 200 });
        } else {
            return new Response('Node not available', { status: 400 });
        }
    } catch (error) {
        return new Response('Error checking node availability', { status: 500 });
    }
}

// 抽离出模型指纹校验函数
async function verifyModelFingerprint(nodeUrl) {
    const completionUrl = `${nodeUrl}/completion`;
    const requestBody = JSON.stringify({
        prompt: "<|im_start|>system\n你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文 ，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。<|im_end|>\n<|im_start|>user\n将下面的日文文本翻译成中文：国境の長いトンネルを抜けると雪国であった<|im_end|>\n<|im_start|>assistant\n",
        temperature: 1,
        top_p: 1,
        n_predict: 1,
        n_probs: 10,
        min_keep: 10,
        seed: 0
    });

    try {
        const response = await fetch(completionUrl, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                authorization: 'Bearer no-key',
                'content-type': 'application/json'
            },
            body: requestBody
        });

        const result = await response.json();

        // 确保提取出正确的指纹信息
        const fingerprintProbs = result.completion_probabilities[0].probs.map(item => item.prob);

        if (!verifyModelNameAndFingerprint(result.model, fingerprintProbs)) {
            console.log('模型名称或指纹不匹配');
            return false;
        }

        return true; // 校验成功

    } catch (error) {
        console.error('Error verifying model fingerprint:', error);
        return false;
    }
}

// 校验模型名称和指纹
async function verifyModelNameAndFingerprint(model, fingerprintProbs) {
    const allowedModels = [
        'sakura-14b-qwen2beta-v0.9.2-iq4xs',
        'sakura-14b-qwen2beta-v0.9.2-q4km'
    ];
    const allowedFingerprints = [
        [
            0.5601178407669067, 0.10090667009353638, 0.07124997675418854,
            0.050760358572006226, 0.048443447798490524, 0.04311312735080719,
            0.034672778099775314, 0.03223879635334015, 0.03134223446249962,
            0.027154725044965744,
        ],
        [
            0.5544909238815308, 0.09134039282798767, 0.0702454224228859,
            0.055606868118047714, 0.05284511670470238, 0.04588409513235092,
            0.039813119918107986, 0.0325898602604866, 0.030937371775507927,
            0.026246793568134308,
        ],
        [
            0.5889551043510437, 0.08219610154628754, 0.06368642300367355,
            0.05597573518753052, 0.04624505341053009, 0.044758766889572144,
            0.03576425090432167, 0.030524807050824165, 0.029894692823290825,
            0.021998988464474678,
        ],
        [
            0.6689561605453491, 0.07981256395578384, 0.052107073366642,
            0.04577327147126198, 0.04422539845108986, 0.030705934390425682,
            0.020494865253567696, 0.020072637125849724, 0.019512630999088287,
            0.018339477479457855,
        ],
    ];

    const calculateDistance = (a, b) => {
        return a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] || 0)) ** 2, 0);
    };

    if (!allowedModels.includes(model)) {
        return false;
    }

    // 校验指纹信息
    return allowedFingerprints.some(allowedFingerprint => {
        const distance = calculateDistance(fingerprintProbs, allowedFingerprint);
        return distance < 0.001; // 指纹校验成功的临界值
    });
}

// 验证节点是否存在于 DB 中的端点
async function verifyNode(request, env) {
    let { url } = await request.json();
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠
    const nodes = await getNodes(env);

    if (nodes.includes(url)) {
        return new Response('Node exists', { status: 200 });
    } else {
        return new Response('Node not found', { status: 404 });
    }
}

// 删除节点的端点
async function deleteNode(request, env) {
    let { url } = await request.json();
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠
    await removeNode(url, env);
    return new Response('Node deleted', { status: 200 });
}

// D1操作
async function getNodes(env) {
    const { results } = await env.DB.prepare("SELECT url FROM nodes").all();
    return results.map(row => row.url);
}

async function addNode(url, env) {
    await env.DB.prepare("INSERT OR IGNORE INTO nodes (url) VALUES (?)").bind(url).run();
}

async function removeNode(url, env) {
    await env.DB.prepare("DELETE FROM nodes WHERE url = ?").bind(url).run();
}

// 获取单个节点的状态信息
async function getNodeStatus(nodeUrl) {
    const healthUrl = `${nodeUrl}/health`;
    const slotsUrl = `${nodeUrl}/slots`;
    
    try {
        // 首先尝试获取健康状态
        const healthResponse = await fetch(healthUrl, { method: 'GET' });
        const healthResult = await healthResponse.json();
        
        let slotsIdle = 0;
        let slotsProcessing = 0;
        let detailedSlots = null;

        // 检查是否是旧版本的健康状态信息（直接包含slots信息）
        if ('slots_idle' in healthResult && 'slots_processing' in healthResult) {
            slotsIdle = healthResult.slots_idle || 0;
            slotsProcessing = healthResult.slots_processing || 0;
        } else {
            // 如果是新版本，尝试从/slots接口获取详细信息
            try {
                const slotsResponse = await fetch(slotsUrl, { method: 'GET' });
                const slotsResult = await slotsResponse.json();
                
                if (Array.isArray(slotsResult)) {
                    detailedSlots = slotsResult;
                    // 计算空闲和忙碌的槽位数量
                    slotsIdle = slotsResult.filter(slot => slot.state === 0).length;
                    slotsProcessing = slotsResult.filter(slot => slot.state !== 0).length;
                }
            } catch (error) {
                console.error(`Error fetching slots from node: ${nodeUrl}`, error);
                // 如果/slots接口不存在或出错，假设至少有一个可用槽位
                slotsIdle = 1;
            }
        }

        // 返回节点状态信息
        return {
            status: healthResult.status,
            slotsIdle,
            slotsProcessing,
            detailedSlots
        };
    } catch (error) {
        console.error(`Error fetching health from node: ${nodeUrl}`, error);
        return null;
    }
}

// 获取所有节点的健康状态
async function getHealthStatus(env) {
    const nodes = await getNodes(env);
    let totalSlotsIdle = 0;
    let totalSlotsProcessing = 0;
    const loadBalancer = new LoadBalancer(env);
    await loadBalancer.init();

    // 遍历所有节点，获取每个节点的状态
    for (const nodeUrl of nodes) {
        const nodeStatus = await getNodeStatus(nodeUrl);
        if (nodeStatus) {
            if (nodeStatus.status === "ok" || nodeStatus.status === "no slot available") {
                // 累加空闲和处理中的槽位数量
                totalSlotsIdle += nodeStatus.slotsIdle;
                totalSlotsProcessing += nodeStatus.slotsProcessing;
                loadBalancer.updateNodeStatus(nodeUrl, nodeStatus);
            } else {
                // 如果节点状态异常，从数据库中移除该节点
                await loadBalancer.removeNode(nodeUrl);
            }
        } else {
            // 如果无法获取节点状态，从数据库中移除该节点
            await loadBalancer.removeNode(nodeUrl);
        }
    }

    await loadBalancer.saveState();

    // 确定整体状态
    const status = (totalSlotsIdle > 0) ? "ok" : "no slot available";

    // 构造并返回响应，不包含节点信息
    return new Response(JSON.stringify({
        status,
        slots_idle: totalSlotsIdle,
        slots_processing: totalSlotsProcessing
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

export default {
    async fetch(request, env, ctx) {
        if (!loadBalancer) {
            loadBalancer = new LoadBalancer(env);
            await loadBalancer.init();
        }

        const { pathname } = new URL(request.url);

        // 处理特殊端点
        if (pathname === '/register-node') {
            return await registerNode(request, env);
        } else if (pathname === '/verify-node') {
            return await verifyNode(request, env);
        } else if (pathname === '/delete-node') {
            return await deleteNode(request, env);
        }

        // 初始化或更新负载均衡器
        const nodes = await getNodes(env);
        for (const nodeUrl of nodes) {
            loadBalancer.addNode(nodeUrl);
        }

        // 执行健康检查
        ctx.waitUntil(loadBalancer.performHealthCheck());

        // 处理常规请求
        if (pathname === '/completion' || pathname === '/completions' || pathname === '/v1/chat/completions') {
            return await loadBalancer.handleRequest(request);
        } else if (pathname === '/health') {
            return await getHealthStatus(env);
        }

        // 处理其他路径
        return new Response('Not found', { status: 404 });
    },
    async scheduled(event, env, ctx) {
        // 定期清理过期的节点状态
        const db = env.DB;
        const expirationTime = Date.now() - 24 * 60 * 60 * 1000; // 24小时前
        await db.prepare("DELETE FROM node_status WHERE json_extract(status, '$.lastCheckTime') < ?").bind(expirationTime).run();
    }
};