// 注册节点端点
async function registerNode(request) {
    let { url } = await request.json();
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠
    const healthUrl = `${url}/health`;

    try {
        const response = await fetch(healthUrl, { method: 'GET' });
        const result = await response.json();

        if ((result.status === "ok" || result.status === "no slot available") && await verifyModelFingerprint(url)) {
            const existingNodes = await NODES_KV.get('nodes', { type: 'json' }) || [];
            if (!existingNodes.includes(url)) {
                existingNodes.push(url);
                await NODES_KV.put('nodes', JSON.stringify(existingNodes));
            }
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
    const allowedModel = 'sakura-14b-qwen2beta-v0.9.2-iq4xs';
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
    ];

    const calculateDistance = (a, b) => {
        return a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] || 0)) ** 2, 0);
    };

    if (model !== allowedModel) {
        return false;
    }

    // 校验指纹信息
    return allowedFingerprints.some(allowedFingerprint => {
        const distance = calculateDistance(fingerprintProbs, allowedFingerprint);
        return distance < 0.001; // 指纹校验成功的临界值
    });
}

// 验证节点是否存在于 KV 中的端点
async function verifyNode(request) {
    let { url } = await request.json();
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠
    const existingNodes = await NODES_KV.get('nodes', { type: 'json' }) || [];

    if (existingNodes.includes(url)) {
        return new Response('Node exists', { status: 200 });
    } else {
        return new Response('Node not found', { status: 404 });
    }
}

// 删除节点的端点
async function deleteNode(request) {
    let { url } = await request.json();
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠
    await removeNodeFromKV(url);
    return new Response('Node deleted', { status: 200 });
}

// 从 KV 中删除节点
async function removeNodeFromKV(nodeUrl) {
    const existingNodes = await NODES_KV.get('nodes', { type: 'json' }) || [];
    const updatedNodes = existingNodes.filter(url => url !== nodeUrl);
    await NODES_KV.put('nodes', JSON.stringify(updatedNodes));
}

// 添加 fetch 事件监听器
addEventListener('fetch', event => {
    const { request } = event;
    const { pathname } = new URL(request.url);

    if (pathname === '/register-node') {
        event.respondWith(registerNode(request));
    } else if (pathname === '/verify-node') {
        event.respondWith(verifyNode(request));
    } else if (pathname === '/delete-node') {
        event.respondWith(deleteNode(request));
    } else if (pathname === '/completion' || pathname === '/completions' || pathname === '/v1/chat/completions') {
        event.respondWith(handleOtherRequests(request));
    }
});

// 处理 /completion /completions 和 /v1/chat/completions 请求
async function handleOtherRequests(request) {
    const { pathname } = new URL(request.url);

    try {
        const nodes = await NODES_KV.get('nodes', { type: 'json' }) || [];

        if (!nodes.length) {
            return new Response('No available nodes', { status: 503 });
        }
        const triedNodes = new Set();

        async function tryProxyRequest() {
            let nodeUrl;

            while (triedNodes.size < nodes.length) {
                nodeUrl = nodes[Math.floor(Math.random() * nodes.length)];

                if (triedNodes.has(nodeUrl)) {
                    continue; // 已经尝试过的节点跳过
                }

                triedNodes.add(nodeUrl);
                const healthUrl = `${nodeUrl}/health`;
                let response;

                try {
                    response = await fetch(healthUrl);
                } catch (error) {
                    // 如果节点无法访问，则直接删除该节点
                    await removeNodeFromKV(nodeUrl);
                    continue;
                }

                const result = await response.json();
                if (result.status === "ok" || result.status === "no slot available") {
                    if (result.status === "no slot available") {
                        continue;
                    }
                    const proxyRequest = new Request(nodeUrl + pathname, {
                        method: request.method,
                        headers: request.headers,
                        body: request.body,
                        redirect: 'follow'
                    });
                    const proxyResponse = await fetch(proxyRequest);
                    return proxyResponse;
                } else {
                    // 如果状态不为ok或no slot available，则删除节点
                    await removeNodeFromKV(nodeUrl);
                }

            }

            return new Response('No nodes available with "ok" status', { status: 503 });
        }

        // 尝试首次代理请求
        let proxyResponse = await tryProxyRequest();

        // 如果首次代理不成功，重试一次
        if (proxyResponse.status !== 200) {
            proxyResponse = await tryProxyRequest();
        }

        return proxyResponse;

    } catch (error) {
        return new Response('Error processing request', { status: 500 });
    }
}
