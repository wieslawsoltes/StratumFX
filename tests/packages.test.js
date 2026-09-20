import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Engine, createRegistry, createDocument, createNode } from '../packages/core/dist/index.js';
import { box } from '../packages/geometry/dist/index.js';

test('Independent ESM geometry interoperates with independent core bundle', () => {
    const registry = createRegistry();
    registry.register('external_box', { label:'External', inputs:0, cook:()=>box([2,3,4]) });
    const d=createDocument('Package integration'), n=createNode('external_box',{},registry);d.nodes=[n];d.outputId=n.id;
    const mesh=new Engine(registry).cook(d).mesh;
    assert.equal(mesh.vertexCount,24);assert.deepEqual(mesh.bounds().max,[1,1.5,2]);
});
test('Core browser-global bundle resolves its readiness promise', async () => {
    const source=await readFile(new URL('../packages/core/dist/standalone.js',import.meta.url),'utf8');
    const context=vm.createContext({console,structuredClone,EventTarget,CustomEvent,performance,crypto,setTimeout,clearTimeout});
    vm.runInContext(source,context);const core=await context.StratumCoreReady;
    assert.equal(core,context.StratumCore);assert.equal(core.createRegistry().list().length,27);
    assert.equal(core.createDocument('Global').title,'Global');
});
test('Each published package entry and declarations exist', async () => {
    for(const name of ['geometry','core','renderer','controls','collaboration']) {
        const root=new URL(`../packages/${name}/`,import.meta.url), p=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
        for(const entry of [p.main,p.types,'dist/standalone.js','LICENSE','README.md'])await access(fileURLToPath(new URL(entry,root)));
        assert.equal(Object.keys(p.dependencies||{}).length,0);
    }
    await access(new URL('../packages/core/dist/worker.js',import.meta.url));
});
