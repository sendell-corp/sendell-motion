// contacto/palma — «contacto de palma»: una mano que se apoya en la superficie de un cuerpo.
// Una mano que se apoya EN la superficie de otro cuerpo, cualquiera: araña, gusano, hormiga, jefe de 5,5 u o una caja desconocida.
// Técnica (docs/PALMA-CONTACTO.md): el contacto se codifica en el marco LOCAL del hueso que lo lleva (la idea de Villegas et al.
// 2021, «Contact-Aware Retargeting of Skinned Motion», y de la malla de interacción de Ho, Komura y Tai 2010: la relación vive en
// la superficie, no en el mundo), con la superficie real de la malla del cuadro (raycast a la malla con piel). Lo que añadimos:
//   1. el ancla sale de lo que el cuerpo trae (socket_mouth, mouth, head, una pista del juego o su caja) y el punto de la cara es
//      el cruce de ENTRADA de la malla más cercano al ancla a lo largo de la mirada (una pata delante de la cara no gana);
//   2. la palma (no la punta) se coloca: el objetivo del IK se corrige en lazo cerrado con la palma que se VIO el cuadro anterior
//      (un servo de contacto: la orientación de la mano, el clip y el warp quedan dentro del lazo);
//   3. la medida es la misma geometría: distancia firmada palma–superficie por raycast a lo largo de la normal;
//   4. `ajusteAltura`: si la cara cae fuera de la banda cómoda del brazo, el compañero se eleva o se inclina (pitch) lo justo.
// Sin reservas por cuadro (vectores de trabajo); las listas se arman una vez en `localizar`.
import * as THREE from 'three';

export const PALMA = Object.freeze({
    /** Nombres de ancla en orden de preferencia (minúsculas). */
    nombres: Object.freeze(['socket_mouth', 'mouth', 'socket_head', 'head', 'cabeza']),
    /** Separación deseada palma–superficie (m del rig; × escala del mundo). 0,5 cm: «a 0–1 cm». */
    hueco: 0.005,
    /** Servo: ganancia por cuadro y tope de la corrección (u). */
    ganancia: 0.55, topeCorr: 0.45,
    /** Re-proyección: mezcla del punto nuevo con el viejo (evita saltos). */
    mezcla: 0.5,
    /** Banda cómoda del punto de contacto respecto al hombro (× largo del brazo): abajo, arriba. */
    bandaBaja: 0.72, bandaAlta: 0.42,
    /** Pitch máximo que se le pide al compañero para bajar la cabeza (rad) y elevación máxima (× largo del brazo). */
    pitchMax: 0.62, elevaMax: 1.1
});

export type FuenteAncla = 'nombre' | 'pista' | 'caja';

const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _m3 = new THREE.Matrix3(), _box = new THREE.Box3(), _box2 = new THREE.Box3(), _sph = new THREE.Sphere(), _inv = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function visibleEnCadena(o: THREE.Object3D, raices: readonly THREE.Object3D[]): boolean {
    for (let x: THREE.Object3D | null = o; x; x = x.parent) { if (!x.visible) return false; if (raices.includes(x)) return true; }
    return true;
}

function materialOpaco(m: THREE.Material | THREE.Material[]): boolean {
    const l = Array.isArray(m) ? m : [m];
    return l.some(x => x && x.visible !== false && !(x.transparent && x.opacity < 0.98) && x.depthWrite !== false);
}

/** El contacto de una mano con la superficie de un cuerpo. Uno por escena; `localizar` al empezar, `refrescar` cuando convenga. */
export class ContactoPalma {
    /** Mallas del cuerpo que cuentan como superficie (visibles, opacas, no planas). */
    readonly mallas: THREE.Object3D[] = [];
    /** Nodo que lleva el contacto (el hueso de la cabeza, o la raíz). */
    portador: THREE.Object3D | null = null;
    fuente: FuenteAncla = 'caja';
    /** Ancla, punto de superficie y normal en el marco local del portador. */
    readonly anclaLocal = new THREE.Vector3();
    readonly puntoLocal = new THREE.Vector3();
    readonly normalLocal = new THREE.Vector3(0, 0, 1);
    /** Radio del cuerpo (u, esfera de la caja), para los rayos. */
    radio = 1;
    /** ¿La última proyección tocó la malla? (false = esfera aproximada). */
    tocoMalla = false;
    /** Corrección del servo (u, mundo). */
    readonly corr = new THREE.Vector3();
    private readonly ray = new THREE.Raycaster();
    private readonly hits: THREE.Intersection[] = [];

    /**
     * Arma el contacto sobre los cuerpos `raices` mirando desde `desde` (los ojos o el hombro de quien toca). `pista`: un punto del
     * mundo que el juego sabe que es la cara (el ojo de la araña, la boca del gusano) y su portador; null = buscar por nombre o caja.
     */
    localizar(raices: readonly THREE.Object3D[], desde: THREE.Vector3, pista: { punto: THREE.Vector3; portador: THREE.Object3D } | null): void {
        this.mallas.length = 0; this.portador = null; this.corr.set(0, 0, 0);
        _box.makeEmpty();
        for (const r of raices) {
            r.updateWorldMatrix(true, true);
            r.traverse(o => {
                const m = o as THREE.Mesh;
                if (!m.isMesh || (o as unknown as THREE.Sprite).isSprite || !m.geometry || !visibleEnCadena(o, raices) || !materialOpaco(m.material)) return;
                _box2.setFromObject(o);
                if (_box2.isEmpty() || _box2.max.y - _box2.min.y < 0.02) return;   // sombras, aros, calcomanías
                this.mallas.push(o); _box.union(_box2);
            });
        }
        if (_box.isEmpty()) for (const r of raices) _box.expandByObject(r);
        _box.getBoundingSphere(_sph);
        this.radio = Math.max(0.2, _sph.radius);
        // 1. El ancla: por nombre, por pista, o la caja (arriba y al frente, hacia quien toca).
        let nodo: THREE.Object3D | null = null;
        for (const nom of PALMA.nombres) {
            for (const r of raices) { r.traverse(o => { if (!nodo && o.name.toLowerCase() === nom) nodo = o; }); if (nodo) break; }
            if (nodo) break;
        }
        if (nodo) { this.fuente = 'nombre'; this.portador = nodo; (nodo as THREE.Object3D).getWorldPosition(_p); }
        else if (pista) { this.fuente = 'pista'; this.portador = pista.portador; _p.copy(pista.punto); }
        else {
            this.fuente = 'caja'; this.portador = raices[0] ?? null;
            _box.getCenter(_p);
            _dir.subVectors(desde, _p).setY(0);
            if (_dir.lengthSq() > 1e-8) _dir.normalize();
            _box.getSize(_t);
            _p.addScaledVector(_dir, 0.3 * Math.max(_t.x, _t.z)); _p.y = _box.min.y + 0.72 * _t.y;
        }
        if (!this.portador) return;
        this.portador.updateWorldMatrix(true, false);
        this.anclaLocal.copy(_p); this.portador.worldToLocal(this.anclaLocal);
        this.proyectar(desde, 1);
    }

    /** Ancla actual (mundo). */
    ancla(out: THREE.Vector3): THREE.Vector3 { return this.portador ? this.portador.localToWorld(out.copy(this.anclaLocal)) : out; }

    /** Punto de superficie y normal actuales (mundo), siguiendo al portador. */
    superficie(outP: THREE.Vector3, outN: THREE.Vector3): void {
        const q = this.portador;
        if (!q) return;
        outP.copy(this.puntoLocal); q.localToWorld(outP);
        _m3.setFromMatrix4(q.matrixWorld);
        outN.copy(this.normalLocal).applyMatrix3(_m3).normalize();
    }

    /**
     * Re-proyecta la cara desde `desde`: el cruce de entrada de la malla más cercano al ancla a lo largo de la mirada; sin malla,
     * la esfera del ancla. `mezcla` 1 = el punto nuevo tal cual; < 1 lo mezcla con el anterior. Coste: un raycast al cuerpo.
     */
    proyectar(desde: THREE.Vector3, mezcla: number = PALMA.mezcla): void {
        const q = this.portador;
        if (!q) return;
        const H = this.ancla(_p);
        _dir.subVectors(H, desde);
        let dist = _dir.length();
        if (dist < 1e-4) { _dir.set(0, 0, 1); dist = 1; }
        _dir.multiplyScalar(1 / dist);
        const lejos = this.radio * 2 + 0.5;
        _o.copy(H).addScaledVector(_dir, -lejos);
        this.ray.set(_o, _dir); this.ray.near = 0; this.ray.far = lejos * 2;
        this.hits.length = 0;
        this.ray.intersectObjects(this.mallas, false, this.hits);
        let best: THREE.Intersection | null = null, bestErr = Infinity;
        for (const h of this.hits) {
            if (!h.face) continue;
            _m3.getNormalMatrix(h.object.matrixWorld);
            _n.copy(h.face.normal).applyMatrix3(_m3).normalize();
            if (_n.dot(_dir) > 0) continue;   // solo cruces de entrada (la cara que mira a quien toca)
            const err = Math.abs(h.distance - lejos) * (h.distance > lejos ? 1.6 : 1);   // detrás del ancla pesa más
            if (err < bestErr) { bestErr = err; best = h; }
        }
        this.tocoMalla = !!best && bestErr < this.radio;
        if (this.tocoMalla && best) {
            _t.copy(best.point);
            _m3.getNormalMatrix(best.object.matrixWorld);
            _n.copy(best.face!.normal).applyMatrix3(_m3).normalize();
            if (_n.dot(_dir) > -0.2) _n.copy(_dir).negate();   // caras de canto: la normal de la mirada
        } else {
            // Sin malla: una esfera alrededor del ancla (radio ~ un sexto del cuerpo).
            _n.copy(_dir).negate();
            _t.copy(H).addScaledVector(_n, Math.min(0.5, this.radio / 6));
        }
        // Al marco del portador, mezclado con lo anterior.
        _inv.copy(q.matrixWorld).invert();
        _t.applyMatrix4(_inv);
        _m3.setFromMatrix4(_inv); _n.applyMatrix3(_m3).normalize();
        const k = Math.max(0, Math.min(1, mezcla));
        this.puntoLocal.lerp(_t, k); if (k >= 1) this.puntoLocal.copy(_t);
        this.normalLocal.lerp(_n, k).normalize(); if (k >= 1) this.normalLocal.copy(_n);
    }

    /**
     * Distancia firmada (u) de `palma` a la superficie, a lo largo de la normal `n` (+ fuera, − dentro), por raycast; NaN si el
     * rayo no encuentra la malla.
     */
    medir(palma: THREE.Vector3, n: THREE.Vector3): number {
        const m = 0.25 * this.radio + 0.2;
        _o.copy(palma).addScaledVector(n, m);
        _dir.copy(n).negate();
        this.ray.set(_o, _dir); this.ray.near = 0; this.ray.far = m * 3;
        this.hits.length = 0;
        this.ray.intersectObjects(this.mallas, false, this.hits);
        let best = NaN, bestErr = Infinity;
        for (const h of this.hits) {
            if (!h.face) continue;
            _m3.getNormalMatrix(h.object.matrixWorld);
            _n.copy(h.face.normal).applyMatrix3(_m3);
            if (_n.dot(_dir) > 0) continue;
            const e = Math.abs(h.distance - m);
            if (e < bestErr) { bestErr = e; best = h.distance - m; }
        }
        return best;
    }

    /**
     * Objetivo de la PUNTA de la mano (lo que mueve el IK de dos huesos) para que la PALMA quede a `hueco` u sobre la superficie:
     * palma deseada = P + n·hueco; punta = palma + dedos·mitad + corrección del servo. `palmaVista` = la palma del cuadro anterior
     * (null = sin servo este cuadro). `dedos` sale tangente a la superficie, hacia arriba (o hacia `adelante` sobre una coronilla).
     */
    objetivo(P: THREE.Vector3, n: THREE.Vector3, hueco: number, mitad: number, adelante: THREE.Vector3, palmaVista: THREE.Vector3 | null,
        outPunta: THREE.Vector3, outDedos: THREE.Vector3): void {
        tangenteArriba(n, adelante, outDedos);
        _p.copy(P).addScaledVector(n, hueco);   // palma deseada
        if (palmaVista) {
            _t.subVectors(_p, palmaVista).multiplyScalar(PALMA.ganancia);
            this.corr.add(_t);
            const l = this.corr.length();
            if (l > PALMA.topeCorr) this.corr.multiplyScalar(PALMA.topeCorr / l);
        }
        outPunta.copy(_p).addScaledVector(outDedos, mitad).add(this.corr);
    }

    /** El servo se olvida (la mano se suelta o vuelve a entrar). */
    soltar(): void { this.corr.set(0, 0, 0); }
}

/** Dirección de los dedos: «arriba» proyectado sobre el plano de la superficie; sobre una coronilla, `adelante` proyectado. */
export function tangenteArriba(n: THREE.Vector3, adelante: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(UP).addScaledVector(n, -n.dot(UP));
    if (out.lengthSq() < 0.05) out.copy(adelante).addScaledVector(n, -n.dot(adelante));
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    return out.normalize();
}

/**
 * La cara cae fuera de la banda cómoda del brazo: cuánto se eleva el compañero (u, ≥ 0) o cuánto inclina la cabeza hacia delante
 * (pitch, rad ≥ 0). `alturaCara` y `hombroY` en u del mundo, `brazo` = largo del brazo (u), `brazoCara` = la cara relativa a la
 * raíz del compañero a lo largo de su frente (u: + hacia quien toca) y en altura (u), para el pitch.
 */
export function ajusteAltura(alturaCara: number, hombroY: number, brazo: number, frente: number, alto: number): { eleva: number; pitch: number } {
    const baja = hombroY - PALMA.bandaBaja * brazo, alta = hombroY + PALMA.bandaAlta * brazo;
    if (alturaCara < baja) return { eleva: Math.min(PALMA.elevaMax * brazo, baja - alturaCara), pitch: 0 };
    if (alturaCara <= alta || !(alto > 1e-3)) return { eleva: 0, pitch: 0 };
    // Inclinar sobre la raíz (Euler YXZ, pitch +: el frente baja): y(a) = alto·cos a − frente·sin a + (raíz).
    const raiz = alturaCara - alto;
    let lo = 0, hi: number = PALMA.pitchMax;
    // Rx(a): y' = y·cos a − z·sin a (three.js), el frente (+Z) mira a quien toca: a > 0 baja la cara.
    const y = (a: number): number => raiz + alto * Math.cos(a) - frente * Math.sin(a);
    if (y(hi) > alta) return { eleva: 0, pitch: hi };
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (y(mid) > alta) lo = mid; else hi = mid; }
    return { eleva: 0, pitch: hi };
}
