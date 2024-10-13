import { handleOtherRequests } from "./handler";
import { getHealthStatus } from "./healthCheck";
import { deleteNode, registerNode, verifyNode } from "./nodeManagement";

export default {
    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);

        if (pathname === '/register-node') {
            return await registerNode(request, env);
        } else if (pathname === '/verify-node') {
            return await verifyNode(request, env);
        } else if (pathname === '/delete-node') {
            return await deleteNode(request, env);
        } else if (pathname === '/completion' || pathname === '/completions' || pathname === '/v1/chat/completions') {
            return await handleOtherRequests(request, env);
        } else if (pathname === '/health') {
            return await getHealthStatus(env);
        } else if (pathname === '/v1/models') {
            return new Response(JSON.stringify({
                "object": "list",
                "data": [
                    {
                        "id": "sakura-14b-qwen2.5-v1.0-iq4xs",
                        "object": "model",
                        "created": 1728830939,
                        "owned_by": "llamacpp",
                        "meta": {
                            "vocab_type": 2,
                            "n_vocab": 152064,
                            "n_ctx_train": 131072,
                            "n_embd": 5120,
                            "n_params": 14770033664,
                            "size": 8180228096
                        }
                    }
                ]
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }
        return new Response('Not found', { status: 404 });
    }
};


