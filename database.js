export async function getNodes(env) {
    const { results } = await env.DB.prepare("SELECT url FROM nodes").all();
    return results.map(row => row.url);
}
export async function addNode(url, env) {
    await env.DB.prepare("INSERT OR IGNORE INTO nodes (url) VALUES (?)").bind(url).run();
}
export async function removeNode(url, env) {
    await env.DB.prepare("DELETE FROM nodes WHERE url = ?").bind(url).run();
}
