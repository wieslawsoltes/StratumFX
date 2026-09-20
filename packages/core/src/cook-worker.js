import { Engine } from './graph.js';
const engine = new Engine();
self.onmessage = ({ data }) => { if (data.type === 'clear') {
    engine.clear();
    return;
} try {
    const result = engine.cook(data.document, data.frame, data.outputId), mesh = result.mesh.clone();
    self.postMessage({ id: data.id, mesh, stats: result.stats }, [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.uvs.buffer, mesh.indices.buffer, mesh.instances.buffer]);
}
catch (error) {
    self.postMessage({ id: data.id, error: error.message });
} };
