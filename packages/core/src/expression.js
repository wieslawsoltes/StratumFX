import { noise, fbm, clamp, lerp } from '../../geometry/src/math.js';
const FUNCTIONS = Object.freeze({ sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow, exp: Math.exp, log: Math.log, clamp, lerp, noise, fbm });
const cache = new Map();
/** Safe expression interpreter. No eval, Function, property access, assignments, or JavaScript execution. */
export function compileExpression(source) { source = String(source).replace(/^=/, '').replace(/\$F\b/g, 'f').replace(/\$T\b/g, 't'); if (source.length > 1024)
    throw Error('Expression exceeds 1024 characters'); if (cache.has(source))
    return cache.get(source); const tokens = [], rx = /\s*(?:(\d*\.\d+|\d+\.?\d*)([eE][+-]?\d+)?|([A-Za-z_]\w*)|(==|!=|<=|>=|[+\-*/%^(),<>?:]))/y; let index = 0; while (index < source.trimEnd().length) {
    rx.lastIndex = index;
    const m = rx.exec(source);
    if (!m)
        throw Error(`Invalid expression character at ${index}`);
    tokens.push(m[1] ? { type: 'number', value: Number(m[1] + (m[2] || '')) } : m[3] ? { type: 'name', value: m[3] } : { type: m[4] });
    index = rx.lastIndex;
} if (tokens.length > 256)
    throw Error('Expression too complex'); let pos = 0, depth = 0; const peek = () => tokens[pos]?.type, take = t => { if (peek() !== t)
    throw Error(`Expected ${t}`); return tokens[pos++]; }; const prec = { '==': 1, '!=': 1, '<': 2, '>': 2, '<=': 2, '>=': 2, '+': 3, '-': 3, '*': 4, '/': 4, '%': 4, '^': 5 }; function parse(min = 0) { if (++depth > 32)
    throw Error('Expression nesting limit exceeded'); let t = tokens[pos++], a; if (!t)
    throw Error('Incomplete expression'); if (t.type === 'number')
    a = { n: t.value };
else if (t.type === '+' || t.type === '-')
    a = { un: t.type, a: parse(5) };
else if (t.type === '(') {
    a = parse();
    take(')');
}
else if (t.type === 'name') {
    if (peek() === '(') {
        if (!Object.hasOwn(FUNCTIONS, t.value))
            throw Error(`Unknown function ${t.value}`);
        pos++;
        const args = [];
        if (peek() !== ')') {
            do {
                args.push(parse());
                if (peek() !== ',')
                    break;
                pos++;
            } while (args.length < 8);
        }
        take(')');
        a = { call: t.value, args };
    }
    else
        a = { variable: t.value };
}
else
    throw Error('Expected a number, variable, or function'); while (peek() in prec && prec[peek()] >= min) {
    const op = tokens[pos++].type;
    a = { op, a, b: parse(prec[op] + (op === '^' ? 0 : 1)) };
} if (min === 0 && peek() === '?') {
    pos++;
    const b = parse();
    take(':');
    a = { cond: a, b, c: parse() };
} depth--; return a; } const ast = parse(); if (pos !== tokens.length)
    throw Error('Unexpected expression token'); function run(n, env) { if ('n' in n)
    return n.n; if (n.variable) {
    if (n.variable === 'pi' || n.variable === 'PI')
        return Math.PI;
    if (n.variable === 'e')
        return Math.E;
    if (!Object.hasOwn(env, n.variable))
        throw Error(`Unknown variable ${n.variable}`);
    return Number(env[n.variable]);
} if (n.un)
    return n.un === '-' ? -run(n.a, env) : run(n.a, env); if (n.call)
    return FUNCTIONS[n.call](...n.args.map(a => run(a, env))); if (n.cond)
    return run(n.cond, env) ? run(n.b, env) : run(n.c, env); const a = run(n.a, env), b = run(n.b, env); switch (n.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
    case '^': return Math.pow(a, b);
    case '<': return +(a < b);
    case '>': return +(a > b);
    case '<=': return +(a <= b);
    case '>=': return +(a >= b);
    case '==': return +(a === b);
    case '!=': return +(a !== b);
} } const fn = env => { const n = run(ast, env); if (!Number.isFinite(n))
    throw Error('Expression produced a non-finite value'); return n; }; cache.set(source, fn); if (cache.size > 256)
    cache.delete(cache.keys().next().value); return fn; }
export function evaluateExpression(source, variables = {}) { return compileExpression(source)(variables); }
export function sampleKeys(keys, frame, fallback) { if (!keys?.length)
    return fallback; const sorted = [...keys].sort((a, b) => a.frame - b.frame); if (frame <= sorted[0].frame)
    return sorted[0].value; for (let i = 1; i < sorted.length; i++)
    if (frame <= sorted[i].frame) {
        const a = sorted[i - 1], b = sorted[i], t = (frame - a.frame) / (b.frame - a.frame);
        return a.interpolation === 'step' ? a.value : lerp(a.value, b.value, t);
    } return sorted.at(-1).value; }
