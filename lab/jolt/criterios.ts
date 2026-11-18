// Los cinco criterios de aceptación de M4 (Daniel, 17/11/2026), medidos con el mismo MundoFisico que el lab.
import * as T from 'three';
import { MundoFisico } from '../../src/fisica/cuerpo-activo';

const DT = 1 / 60;
const pasos = (m: MundoFisico, n: number, f?: (k: number) => void) => { for (let k = 0; k < n; k++) { f?.(k); m.paso(DT); } };
const garras = (m: MundoFisico, id: string) => m.pose(id).filter((_, i) => i > 0 && (i - 1) % 3 === 2).map(o => o.p.clone());
const r3 = (x: number) => +x.toFixed(3);
/** Media extensión de una parte en un eje del mundo (caja: aprox. por su media altura; cápsula: eje Y local). */
const ext = (f: { caja?: { x: number; y: number; z: number }; r: number; media: number }, q: T.Quaternion, eje: 'x' | 'y') => {
    if (f.caja) { const m = new T.Matrix4().makeRotationFromQuaternion(q).elements, r = eje === 'y' ? 1 : 0;
        return Math.abs(m[r]) * f.caja.x + Math.abs(m[4 + r]) * f.caja.y + Math.abs(m[8 + r]) * f.caja.z; }
    const a = new T.Vector3(0, 1, 0).applyQuaternion(q); return Math.abs(a[eje]) * f.media + f.r;
};

async function mundo() { const m = await MundoFisico.crear({ lod: false }); m.sala(10); return m; }

/** 1) Reacción por zona: golpe en el lado +x; desplazamiento medio de las garras de ese lado frente al opuesto. */
async function zona() {
    // Cuatro orientaciones; el golpe llega siempre desde +x. Lado golpeado (x > 0) frente al opuesto.
    let golpeado = 0, opuesto = 0;
    for (const rumbo of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const m = await mundo(); m.agregar('a', 'arana', 0, 0, rumbo); pasos(m, 90);
        // Desvío de cada garra respecto a la pose procedural, ambas en el marco de su cuerpo: lo que cede la pata por el golpe
        // (no la marcha, que sigue, ni el empujón del cuerpo entero).
        const desvio = () => { const o = m.pose('a'), pr = m.poseProcedural('a');
            const io = o[0].q.clone().invert(), ip = pr[0].q.clone().invert();
            return o.map((x, i) => i > 0 && (i - 1) % 3 === 2 ? x.p.clone().sub(o[0].p).applyQuaternion(io).sub(pr[i].p.clone().sub(pr[0].p).applyQuaternion(ip)).length() : -1).filter(v => v >= 0); };
        const lado = garras(m, 'a').map(g => Math.sign(g.x - m.pose('a')[0].p.x)), max = lado.map(() => 0);
        m.golpe('a', { x: .55, y: .6, z: 0 }, { x: -1, y: .2, z: 0 }, 20);
        pasos(m, 30, () => desvio().forEach((v, i) => { max[i] = Math.max(max[i], v); }));
        const med = (s: number) => { const v = max.filter((_, i) => lado[i] === s); return v.reduce((a, b) => a + b, 0) / v.length; };
        golpeado += med(1) / 4; opuesto += med(-1) / 4;
    }
    return { golpeado_cm: r3(golpeado * 100), opuesto_cm: r3(opuesto * 100), razon: r3(golpeado / Math.max(1e-6, opuesto)) };
}

/** 2) Pata rota: 4 s de marcha recta (+z a 1 u/s) entera y con la pata 2 (+x) rota. */
async function cojera() {
    const una = async (rota: boolean) => {
        const m = await mundo(); m.agregar('a', 'arana', 0, -4, 0); pasos(m, 60);
        if (rota) m.romperPata('a', 2);
        const ys: number[] = [], gy: number[][] = Array.from({ length: 8 }, () => []);
        pasos(m, 480, k => {
            m.objetivo('a', 0, -4 + k * DT, 0);
            const p = m.pose('a'); ys.push(p[0].p.y);
            for (let i = 0; i < 8; i++) gy[i].push(p[1 + i * 3 + 2].p.y - p[0].p.y);
        });
        // Pisadas por pata (garra respecto al cuerpo: baja del 30 % de su recorrido tras pasar del 70 %).
        const pis = gy.map(g => { const lo = Math.min(...g), hi = Math.max(...g); if (hi - lo < .03) return 0; let n = 0, arriba = false;
            g.forEach(v => { if (v > lo + .7 * (hi - lo)) arriba = true; else if (arriba && v < lo + .3 * (hi - lo)) { arriba = false; n++; } }); return n; });
        const sanas = pis.filter((_, i) => !(rota && i === 2));
        const ladoX = (s: number) => pis.reduce((a, n, i) => a + (Math.sign(Math.sin(i * Math.PI / 4 + .18)) === s && !(rota && i === 2) ? n : 0), 0);
        const fin = m.pose('a')[0].p;
        return { pisadasPorSeg: r3(sanas.reduce((a, b) => a + b, 0) / sanas.length / 8), pisadasLadoRoto: ladoX(1), pisadasLadoSano: ladoX(-1),
            alturaMedia_cm: r3(ys.reduce((a, b) => a + b, 0) / ys.length * 100), deriva_cm: r3(fin.x * 100) };
    };
    return { entera: await una(false), rota: await una(true) };
}

/** 3) Muerte física: araña y gusano mueren lanzados contra la pared (x = 10); ragdoll, sin atravesar, y tiempo hasta el reposo. */
async function muerte() {
    const m = await mundo(); m.agregar('a', 'arana', 8.3, -2, 0); m.agregar('g', 'gusano', 8.5, 1, 0); pasos(m, 60);
    m.matar('a', { x: 7.8, y: .6, z: -2 }, { x: 1, y: .5, z: 0 }, 60); m.matar('g', { x: 8.2, y: 1.2, z: 3.5 }, { x: 1, y: .3, z: 0 }, 80);
    const fs = { a: m.formas('a'), g: m.formas('g') }; let suelo = 9, pared = -9; const reposo: Record<string, number> = { a: -1, g: -1 };
    pasos(m, 240, k => {
        for (const id of ['a', 'g'] as const) {
            m.pose(id).forEach((o, i) => { const f = fs[id][i]; suelo = Math.min(suelo, o.p.y - ext(f, o.q, 'y')); pared = Math.max(pared, o.p.x + ext(f, o.q, 'x')); });
            let vmax = 0; for (let i = 0; i < fs[id].length; i++) vmax = Math.max(vmax, m.velocidad(id, i).length());
            if (vmax < .05 && reposo[id] < 0 && k > 10) reposo[id] = k * DT; if (vmax >= .05) reposo[id] = -1;
        }
    });
    return { penetracionSuelo_cm: r3(Math.max(0, -suelo) * 100), penetracionPared_cm: r3(Math.max(0, pared - 10) * 100), reposoArana_s: r3(reposo.a), reposoGusano_s: r3(reposo.g) };
}

/** 4) Agarre y lanzamiento: se agarra el cuerpo, se alza 1 m, se lanza a 6 m/s contra la pared y se suelta. */
async function lanzamiento() {
    const m = await mundo(); m.agregar('a', 'arana', 0, 0, 0); pasos(m, 60);
    const h = new T.Vector3(0, .6, 0); m.agarrar('a', h);
    pasos(m, 30, () => { h.y += 1 / 30; m.mano('a', h); });
    pasos(m, 12, () => { h.x += 6 * DT; m.mano('a', h); });
    m.soltar('a'); pasos(m, 1); const salida = m.velocidad('a', 0).length();
    let suelo = 9, pared = -9; const fs = m.formas('a');
    pasos(m, 180, () => m.pose('a').forEach((o, i) => { const f = fs[i]; suelo = Math.min(suelo, o.p.y - ext(f, o.q, 'y')); pared = Math.max(pared, o.p.x + ext(f, o.q, 'x')); }));
    return { salida_ms: r3(salida), penetracionSuelo_cm: r3(Math.max(0, -suelo) * 100), penetracionPared_cm: r3(Math.max(0, pared - 10) * 100) };
}

/** 5) Mordida: el blanco es un punto del cuerpo del jugador a 0,8 m de la boca; distancia boca–cuerpo en el cuadro de impacto. */
async function mordida() {
    const m = await mundo(); m.agregar('a', 'arana', 0, 0, 0); m.agregar('g', 'gusano', 4, 0, 0); pasos(m, 90);
    const res: Record<string, number> = {};
    for (const id of ['a', 'g']) {
        const b = m.boca(id), blanco = b.clone().add(new T.Vector3(0, id === 'a' ? .2 : -.3, .8));
        m.morder(id, blanco, .4); let min = 9; pasos(m, 24, () => { min = Math.min(min, m.boca(id).distanceTo(blanco)); });
        res[id === 'a' ? 'arana_cm' : 'gusano_cm'] = r3(min * 100);
    }
    return res;
}

/** 6) En reposo físico la marcha es idéntica a la procedural; tras un golpe vuelve sin saltos. */
async function reposo() {
    const m = await mundo(); m.agregar('a', 'arana', 0, -3, 0); m.agregar('g', 'gusano', 4, -3, 0);
    const dif = (id: string) => { const a = m.pose(id), b = m.poseProcedural(id); let cm = 0, gr = 0;
        a.forEach((o, i) => { cm = Math.max(cm, o.p.distanceTo(b[i].p) * 100); gr = Math.max(gr, o.q.angleTo(b[i].q) * 180 / Math.PI); }); return [cm, gr]; };
    let sinCm = 0, sinGr = 0, trasCm = 0, trasGr = 0, salto = 0, saltoProc = 0, vuelta = -1;
    const prev = m.pose('a').map(o => o.p.clone()), prevP = m.poseProcedural('a').map(o => o.p.clone()); let prevF = m.poseFisica('a').map(o => o.p.clone());
    pasos(m, 480, k => {
        m.objetivo('a', 0, -3 + k * DT * .8, 0); m.objetivo('g', 4, -3 + k * DT * .5, 0);
        if (k === 240) m.golpe('a', { x: .55, y: .6, z: -3 + k * DT * .8 }, { x: -1, y: .2, z: 0 }, 20);
        if (k > 0) {
            const [ca, ga] = dif('a'), [cg, gg] = dif('g');
            if (k < 240) { sinCm = Math.max(sinCm, ca, cg); sinGr = Math.max(sinGr, ga, gg); }
            if (k > 240 && vuelta < 0 && m.fisica('a') === 0) vuelta = (k - 240) * DT;
            if (k > 240 + 60) { trasCm = Math.max(trasCm, ca); trasGr = Math.max(trasGr, ga); }
            // Saltos: el mayor desplazamiento de una parte entre dos cuadros, durante la vuelta (tras el golpe y su
            // primer cuadro) frente al de la propia marcha procedural.
            // Salto = lo que se mueve la salida entre dos cuadros por ENCIMA de lo que se mueven sus dos fuentes (Jolt y la
            // procedural): mide la costura de la mezcla, no el golpe en sí.
            const po = m.pose('a'), pp = m.poseProcedural('a'), pf = m.poseFisica('a');
            po.forEach((o, i) => { const d = o.p.distanceTo(prev[i]) * 100, dp = pp[i].p.distanceTo(prevP[i]) * 100, df = pf[i].p.distanceTo(prevF[i]) * 100;
                if (k > 241 && k < 240 + 60) salto = Math.max(salto, d - Math.max(dp, df)); if (k < 240) saltoProc = Math.max(saltoProc, dp);
                prev[i].copy(o.p); prevP[i].copy(pp[i].p); });
            prevF = pf.map(o => o.p.clone());
        }
    });
    return { sinGolpe_cm: r3(sinCm), sinGolpe_grados: r3(sinGr), vueltaA0_s: r3(vuelta), tras1s_cm: r3(trasCm), tras1s_grados: r3(trasGr), saltoVuelta_cmPorCuadro: r3(salto), saltoMarcha_cmPorCuadro: r3(saltoProc) };
}

export async function medirCriterios() {
    return { zona: await zona(), cojera: await cojera(), muerte: await muerte(), lanzamiento: await lanzamiento(), mordida: await mordida(), reposo: await reposo() };
}
