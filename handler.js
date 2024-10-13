import { getNodes, removeNode } from "./database";


// 处理 /completion /completions 和 /v1/chat/completions 请求
export async function handleOtherRequests(request, env) {
    const { pathname } = new URL(request.url);

    try {
        const nodes = await getNodes(env);

        if (!nodes.length) {
            return new Response('No available nodes', { status: 503 });
        }

        // 修改tryProxyRequest函数，每次调用都重新选择节点
        async function tryProxyRequest(excludeNode = null) {
            const nodeUrl = await selectNode(nodes, env, excludeNode);

            if (!nodeUrl) {
                return new Response('No nodes available with "ok" status', { status: 503 });
            }

            const proxyRequest = new Request(nodeUrl + pathname, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: 'follow'
            });

            // Return both the response and the selected nodeUrl
            const response = await fetch(proxyRequest);
            return { response, nodeUrl };
        }

        // 第一次尝试
        let { response: proxyResponse, nodeUrl: firstNodeUrl } = await tryProxyRequest();

        // 如果第一次请求失败（状态码不是200），再尝试一次
        if (proxyResponse.status !== 200) {
            console.log(`First attempt failed with node ${firstNodeUrl}. Retrying with a new node.`);
            let secondAttempt = await tryProxyRequest(firstNodeUrl);
            proxyResponse = secondAttempt.response;
        }

        return proxyResponse;

    } catch (error) {
        return new Response('Error processing request', { status: 500 });
    }
}

async function selectNode(nodes, env, excludeNode = null) {
    const triedNodes = new Set();

    while (triedNodes.size < nodes.length) {
        const nodeUrl = nodes[Math.floor(Math.random() * nodes.length)];
        if (nodeUrl === excludeNode || triedNodes.has(nodeUrl)) {
            continue; // Skip already tried nodes
        }
        triedNodes.add(nodeUrl);

        const healthUrl = `${nodeUrl}/health`;

        try {
            const response = await fetch(healthUrl);
            const result = await response.json();

            if (result.status === "ok") {
                return nodeUrl;
            } else if (result.status === "no slot available") {
                continue;
            } else {
                // Remove node if status is not ok or no slot available
                await removeNode(nodeUrl, env);
            }
        } catch (error) {
            // Remove node if it's unreachable
            await removeNode(nodeUrl, env);
        }
    }

    return null; // No suitable node found
}