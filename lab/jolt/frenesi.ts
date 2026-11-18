// Escena fija del banco del frenesí con física: 20 arañas + 5 gusanos en anillo de 4–8 u, jugador en el centro, un golpe
// cada 0,4 s al vivo más cercano, muere al 3.er golpe, cadáver 4 s y reaparece (siempre 25). 60 s simulados a 60 Hz.
import { MundoFisico } from '../../src/fisica/cuerpo-activo';

export interface Criat { id: string; tipo: 'arana' | 'gusano'; ang: number; rad: number; vel: number; vida: number; muerto: number }
export interface Resultado { lod: boolean; pasos: number; p50: number; p95: number; p99: number; max: number; media: number; golpes: number; muertes: number; activasMedia: number }

export async function montarFrenesi(lod: boolean): Promise<{ mundo: MundoFisico; cs: Criat[]; tick: (dt: number) => number }> {
    const mundo = await MundoFisico.crear({ lod });
    mundo.sala(10);
    const cs: Criat[] = [];
    for (let i = 0; i < 25; i++) {
        const tipo = i < 20 ? 'arana' : 'gusano', ang = i / 25 * Math.PI * 2, rad = 4 + (i * 7 % 5);
        const c: Criat = { id: tipo + i, tipo, ang, rad, vel: (i % 2 ? 1 : -1) * .25, vida: 3, muerto: -1 };
        mundo.agregar(c.id, tipo, Math.cos(ang) * rad, Math.sin(ang) * rad, ang);
        cs.push(c);
    }
    let t = 0, proxGolpe = .4;
    const jugador = { x: 0, y: 0, z: 0 };
    const tick = (dt: number): number => {
        t += dt;
        for (const c of cs) {
            if (c.muerto >= 0) {
                if (t - c.muerto > 4) {   // reaparece en otro punto del anillo
                    c.ang += 2.1; c.rad = 4 + Math.random() * 4; c.vida = 3; c.muerto = -1;
                    mundo.revivir(c.id, Math.cos(c.ang) * c.rad, Math.sin(c.ang) * c.rad, c.ang);
                }
                continue;
            }
            // La IA acerca al jugador y rodea; el radio oscila entre 2 y 8 u.
            c.ang += c.vel * dt / Math.max(1, c.rad) * 3; c.rad = Math.max(2, c.rad - dt * .4); if (c.rad <= 2.01) c.rad = 8;
            mundo.objetivo(c.id, Math.cos(c.ang) * c.rad, Math.sin(c.ang) * c.rad, c.ang + Math.PI / 2 * Math.sign(c.vel));
        }
        if (t >= proxGolpe) {
            proxGolpe += .4;
            let m: Criat | null = null; for (const c of cs) if (c.muerto < 0 && (!m || c.rad < m.rad)) m = c;
            if (m) {
                const x = Math.cos(m.ang) * m.rad, z = Math.sin(m.ang) * m.rad, l = Math.hypot(x, z) || 1;
                const punto = { x: x - x / l * .4, y: m.tipo === 'arana' ? .6 : 1.2, z: z - z / l * .4 }, dir = { x: x / l, y: .35, z: z / l };
                if (--m.vida <= 0) { mundo.matar(m.id, punto, dir, m.tipo === 'arana' ? 30 : 40); m.muerto = t; golpes.muertes++; }
                else mundo.golpe(m.id, punto, dir, m.tipo === 'arana' ? 18 : 25);
                golpes.n++;
            }
        }
        return mundo.paso(dt, jugador);
    };
    const golpes = { n: 0, muertes: 0 };
    (tick as any).golpes = golpes;
    return { mundo, cs, tick };
}

export async function correrBanco(lod: boolean, segundos = 60): Promise<Resultado> {
    const { mundo, tick } = await montarFrenesi(lod);
    const dt = 1 / 60, n = Math.round(segundos / dt), ms: number[] = []; let act = 0;
    for (let i = 0; i < 120; i++) tick(dt);   // calentamiento (JIT, primer sueño)
    for (let i = 0; i < n; i++) { ms.push(tick(dt)); act += mundo.activas(); }
    const s = [...ms].sort((a, b) => a - b), q = (f: number) => +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(3);
    const g = (tick as any).golpes;
    return { lod, pasos: n, p50: q(.5), p95: q(.95), p99: q(.99), max: +s[s.length - 1].toFixed(3), media: +(ms.reduce((a, b) => a + b, 0) / n).toFixed(3), golpes: g.n, muertes: g.muertes, activasMedia: +(act / n).toFixed(1) };
}
