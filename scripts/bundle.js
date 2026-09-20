import { readFile } from 'node:fs/promises';
import path from 'node:path';
/** Deterministic bundler for this repository's static named ESM imports/exports. No third-party compiler. */
export async function bundle(entry, { format = 'iife', globalName } = {}) {
    const modules = [], seen = new Map();
    async function visit(file) {
        file = path.resolve(file);
        if (seen.has(file))
            return seen.get(file);
        const id = seen.size;
        seen.set(file, id);
        let code = await readFile(file, 'utf8'), imports = [], reexports = [], names = [];
        const importRx = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
        const matches = [...code.matchAll(importRx)];
        for (const m of matches) {
            if (!m[2].startsWith('.'))
                throw Error('Only relative imports are supported by this dependency-free bundler: ' + m[2]);
            const dep = await visit(path.resolve(path.dirname(file), m[2]));
            const binding = m[1].trim();
            if (!binding.startsWith('{'))
                throw Error('Use named imports in browser modules');
            imports.push(`const ${binding.replace(/\bas\b/g, ':')}=__m[${dep}];`);
        }
        code = code.replace(importRx, '');
        const reRx = /^export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm;
        for (const m of [...code.matchAll(reRx)]) {
            const dep = await visit(path.resolve(path.dirname(file), m[2]));
            for (const part of m[1].split(',')) {
                const [original, alias] = part.trim().split(/\s+as\s+/);
                names.push(alias || original);
                reexports.push(`const ${alias || original}=__m[${dep}].${original};`);
            }
        }
        code = code.replace(reRx, '');
        code = code.replace(/\bexport\s+(async\s+)?(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g, (_, async = '', kind, name) => { names.push(name); return `${async}${kind} ${name}`; });
        code = code.replace(/^export\s*\{([^}]+)\};?\s*$/gm, (_, list) => { for (const part of list.split(',')) {
            const [original, alias] = part.trim().split(/\s+as\s+/);
            names.push(alias || original);
            if (alias)
                reexports.push(`const ${alias}=${original};`);
        } return ''; });
        code = code.replaceAll('import.meta.url', `(typeof document!=='undefined'?new URL(${JSON.stringify('app/' + path.basename(file))},document.baseURI).href:self.location.href)`);
        modules.push({ id, file, names, code: `__m[${id}]=await(async()=>{\n${imports.join('\n')}\n${code}\n${reexports.join('\n')}\nreturn {${[...new Set(names)].join(',')}};\n})();` });
        return id;
    }
    const root = await visit(entry), exports = modules.find(m => m.id === root).names;
    let code = `const __m={};\n${modules.map(m => `// MODULE: ${path.basename(m.file)}\n${m.code}`).join('\n')}`;
    if (format === 'esm')
        code += `\n${exports.map(n => `export const ${n}=__m[${root}].${n};`).join('\n')}\n`;
    else {
        if (globalName) {
            code += `\nglobalThis[${JSON.stringify(globalName)}]=__m[${root}];return __m[${root}];`;
            code = `globalThis[${JSON.stringify(globalName + 'Ready')}]=(async()=>{\n${code}\n})();\n`;
        }
        else
            code = `(async()=>{\n${code}\n})().catch(e=>{console.error(e);globalThis.STRATUM_BOOT_ERROR=e.message;});\n`;
    }
    return { code, exports, files: modules.map(m => m.file) };
}
