import { addNode, getNodes, removeNode } from "./database";
import { verifyModel } from "./modelVerification";


// 注册节点端点
export async function registerNode(request, env) {
    let url;
    try {
        ({ url } = await request.json());
        if (!url) {
            return new Response('Missing URL in request body', { status: 400 });
        }
    } catch (error) {
        return new Response('Invalid JSON in request body', { status: 400 });
    }
    url = url.replace(/\/+$/, '');

    const healthUrl = `${url}/health`;
    try {
        const response = await fetch(healthUrl);
        const result = await response.json();

        if ((result.status === "ok" || result.status === "no slot available") && await verifyModel(url)) {
            await addNode(url, env);
            return new Response('Node registered successfully', { status: 200 });
        } else {
            return new Response('Node not available', { status: 400 });
        }
    } catch (error) {
        return new Response('Error checking node availability', { status: 500 });
    }
}

// 验证节点是否存在于 DB 中的端点
export async function verifyNode(request, env) {
    let url;
    try {
        ({ url } = await request.json());
        if (!url) {
            return new Response('Missing URL in request body', { status: 400 });
        }
    } catch (error) {
        return new Response('Invalid JSON in request body', { status: 400 });
    }
    url = url.replace(/\/+$/, ''); // 去掉末尾的斜杠

    const nodes = await getNodes(env);

    if (nodes.includes(url)) {
        return new Response('Node exists', { status: 200 });
    } else {
        return new Response('Node not found', { status: 404 });
    }
}

// 删除节点的端点
export async function deleteNode(request, env) {
    let url;
    try {
        ({ url } = await request.json());
        if (!url) {
            return new Response('Missing URL in request body', { status: 400 });
        }
    } catch (error) {
        return new Response('Invalid JSON in request body', { status: 400 });
    }
    url = url.replace(/\/+$/, '');

    await removeNode(url, env);
    return new Response('Node deleted', { status: 200 });
}