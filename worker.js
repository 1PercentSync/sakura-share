import { handleOtherRequests } from "./handler";
import { getHealthStatus } from "./healthCheck";
import { deleteNode, registerNode, verifyNode } from "./nodeManagement";

export default {
    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);

        const method = request.method;

        if (pathname === '/register-node') {
            return await registerNode(request, env);
        } else if (pathname === '/verify-node') {
            return await verifyNode(request, env);
        } else if (pathname === '/delete-node') {
            return await deleteNode(request, env);
        } else if (pathname === '/completion' || pathname === '/completions' || pathname === '/v1/chat/completions' || pathname === '/v1/models') {
            return await handleOtherRequests(request, env);
        } else if (pathname === '/health') {
            return await getHealthStatus(env);
        }
        return new Response('Not found', { status: 404 });
    }
};


