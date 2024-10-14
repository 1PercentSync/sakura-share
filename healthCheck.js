import { getNodes, removeNode } from "./database";


// 获取所有节点/health状态
export async function getHealthStatus(env) {
    const nodes = await getNodes(env);
    let totalSlotsIdle = 0;
    let totalSlotsProcessing = 0;

    for (const nodeUrl of nodes) {
        const nodeStatus = await getNodeStatus(nodeUrl);

        if (nodeStatus) {
            totalSlotsIdle += nodeStatus.slotsIdle;
            totalSlotsProcessing += nodeStatus.slotsProcessing;
        } else {
            // If nodeStatus is null, remove the node
            await removeNode(nodeUrl, env);
        }
    }

    const status = (totalSlotsIdle > 0) ? "ok" : "no slot available";
    return new Response(JSON.stringify({
        status,
        slots_idle: totalSlotsIdle,
        slots_processing: totalSlotsProcessing
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function getNodeStatus(nodeUrl) {
    const healthUrl = `${nodeUrl}/health`;
    const slotsUrl = `${nodeUrl}/slots`;

    try {
        // Fetch health status
        const healthResponse = await fetch(healthUrl);
        if (!healthResponse.ok) {
            return null;
        }

        let healthResult;
        try {
            healthResult = await healthResponse.json();
        } catch (parseError) {
            console.error('Failed to parse health JSON response:', parseError.message);
            return null;
        }

        let slotsIdle = 0;
        let slotsProcessing = 0;

        // Check if it's an old version health status (directly contains slots info)
        if ('slots_idle' in healthResult && 'slots_processing' in healthResult) {
            slotsIdle = healthResult.slots_idle;
            slotsProcessing = healthResult.slots_processing;
        } else {
            // If it's a new version, try to get detailed info from /slots endpoint
            const slotsResponse = await fetch(slotsUrl);
            if (!healthResponse.ok) {
                return null;
            }

            let slotsResult;
            try {
                slotsResult = await slotsResponse.json();
            } catch (parseError) {
                console.error('Failed to parse slots JSON response:', parseError.message);
                return null;
            }

            if (Array.isArray(slotsResult)) {
                // Calculate idle and busy slot counts
                slotsIdle = slotsResult.filter(slot => slot.state === 0).length;
                slotsProcessing = slotsResult.filter(slot => slot.state !== 0).length;
            }
        }

        // Return node status information
        return {
            status: healthResult.status,
            slotsIdle,
            slotsProcessing,
        };
    } catch (error) {
        console.error(`Error fetching data from node: ${nodeUrl}`, error);
        return null;
    }
}