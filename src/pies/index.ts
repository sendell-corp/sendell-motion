// pies — pies clavados y tope de giro, como librería. Reescrito a partir del FootLock de F1 (FE engine/anim-v2/foot-lock.ts,
// r831) con las ideas de Cinevva (docs/ESTADO-DEL-ARTE.md):
//  - el ancla del pie vive en coordenadas LOCALES de su soporte (un Object3D: plataforma, cuerpo, ascensor; null = mundo);
//  - un plano de apoyo por pie: la punta del tarso y la normal del suelo (callback `suelo`); el pie clavado se alinea a él;
//  - la pelvis baja lo justo para que TODAS las piernas apoyadas lleguen, y el suavizado vive dentro de ese rango;
//  - predicción de aterrizaje un paso antes (`prediccion` de cada pie: dónde tocará con la velocidad actual);
//  - drift del pie en el mundo durante el apoyo (`driftCm`): la medida de si el clavado funciona.
// Va después de la mezcla del clip (todo hueso animado se reescribe el cuadro siguiente: no se acumula nada).
import * as THREE from 'three';
import { dosHuesos, girarMundo } from '../ik/index.ts';

export const MODULO = 'pies' as const;

export const PIES = Object.freeze({
    uPerM: 1.8857,
    plantCm: 3, vyMs: 0.1,
    inS: 0.05, outS: 0.12,
    stretch: 0.995,
    turnMax: 540 * Math.PI / 180,
    tarso: 0.18,            // u: de foot_* a la punta del tarso (plano de apoyo)
    pelvisMax: 0.6,         // u: lo más que baja la pelvis para que lleguen las piernas
    pelvisS: 0.08,
    pasoMs: 0.6,            // m/s: el clip mueve el pie apoyado más rápido que esto → es un paso, se suelta
    pasoAlto: 0.08,         // u: altura del arco de un paso arrastrado          // s: suavizado de la bajada (dentro del rango permitido)
});

/** Suelo bajo (x, z): altura y normal (mundo). Sin callback, el plano y = rootY con normal +Y. */
export type Suelo = (x: number, z: number, out: { y: number; normal: THREE.Vector3 }) => void;

export interface PlanoApoyo { readonly punta: THREE.Vector3; readonly normal: THREE.Vector3 }

interface Pie {
    thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D;
    minY: number; lastY: number; live: boolean;
    locked: boolean; w: number;
    readonly lockLocal: THREE.Vector3;        // ancla en coordenadas del soporte
    soporte: THREE.Object3D | null;
    readonly from: THREE.Vector3;
    readonly last: THREE.Vector3; lastLive: boolean;
    readonly plano: PlanoApoyo;
    readonly prediccion: THREE.Vector3; predOk: boolean;
    vh: number; paso: number;
    readonly clip: THREE.Vector3;                    // el pie que dio el CLIP este cuadro (antes del tope de giro)
    readonly ancla0: THREE.Vector3; drift: number;   // drift del pie en el mundo en el apoyo en curso (u)
}

const _c = new THREE.Vector3(), _t = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _pole = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _lock = new THREE.Vector3(), _hip = new THREE.Vector3(), _n = new THREE.Vector3(), _fw = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _suelo = { y: 0, normal: new THREE.Vector3(0, 1, 0) };

export class PiesClavados {
    private glb: THREE.Object3D | null = null;
    private pies: Pie[] = [];
    private pelvis: THREE.Object3D | null = null;
    private yawLag = 0; private lastYaw = NaN;
    private bajada = 0;
    private readonly pelvisBase = new THREE.Vector3(); private readonly pelvisSet = new THREE.Vector3(); private pelvisMovida = false;
    /** Soporte actual (null = mundo). Un pie que se clava guarda su ancla en las coordenadas de ESTE objeto. */
    soporte: THREE.Object3D | null = null;
    suelo: Suelo | null = null;
    /** Peor drift en el mundo de un pie clavado desde el último reset (cm). */
    driftCm = 0;
    /** Bajada actual de la pelvis (u). */
    get pelvisBajada(): number { return this.bajada; }
    get planos(): readonly PlanoApoyo[] { return this.pies.map(p => p.plano); }
    get predicciones(): readonly (THREE.Vector3 | null)[] { return this.pies.map(p => p.predOk ? p.prediccion : null); }

    private bind(glb: THREE.Object3D): void {
        this.glb = glb; this.pies = []; this.yawLag = 0; this.lastYaw = NaN; this.bajada = 0;
        this.pelvis = glb.getObjectByName('pelvis') ?? null;
        for (const s of ['L', 'R']) {
            const thigh = glb.getObjectByName('thigh_' + s), shin = glb.getObjectByName('shin_' + s), foot = glb.getObjectByName('foot_' + s);
            if (thigh && shin && foot) this.pies.push({ thigh, shin, foot, minY: Infinity, lastY: NaN, live: false, locked: false, w: 0,
                lockLocal: new THREE.Vector3(), soporte: null, from: new THREE.Vector3(), last: new THREE.Vector3(), lastLive: false,
                plano: { punta: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }, prediccion: new THREE.Vector3(), predOk: false,
                vh: 0, paso: 0, clip: new THREE.Vector3(), ancla0: new THREE.Vector3(), drift: 0 });
        }
    }

    reset(): void {
        this.yawLag = 0; this.lastYaw = NaN; this.bajada = 0; this.driftCm = 0;
        for (const p of this.pies) { p.locked = false; p.w = 0; p.live = false; p.lastY = NaN; p.lastLive = false; p.predOk = false; p.drift = 0; }
    }

    private anclaMundo(p: Pie, out: THREE.Vector3): THREE.Vector3 {
        out.copy(p.lockLocal); if (p.soporte) { p.soporte.updateMatrixWorld(); p.soporte.localToWorld(out); } return out;
    }

    /**
     * Un cuadro, después del clip. `rootY` = suelo de la figura; `groundVel` = cómo se mueve el suelo bajo la RAÍZ (0 en el juego;
     * los clips en el sitio del banco pasan −velocidad); `moviendo` suelta los pies (la marcha la lleva el clip).
     */
    aplicar(glb: THREE.Object3D, dt: number, rootY: number, groundVel: THREE.Vector3 | null = null, moviendo = false): void {
        if (glb !== this.glb) this.bind(glb);
        if (!(dt > 0) || dt > 0.25) { this.reset(); return; }
        const F = PIES, U = F.uPerM;
        // si el clip no reescribió la pelvis, se deshace la bajada del cuadro anterior (no se acumula)
        const pv0 = this.pelvis;
        if (pv0 && this.pelvisMovida && pv0.position.equals(this.pelvisSet)) { pv0.position.copy(this.pelvisBase); pv0.updateMatrixWorld(true); }
        this.pelvisMovida = false;
        for (const p of this.pies) p.foot.getWorldPosition(p.clip);
        this.topeGiro(glb, dt);   // gira la pelvis y con ella las piernas: los pies vuelven a su sitio por IK en (3)
        // 1) Estado de cada pie y su ancla.
        for (const p of this.pies) {
            _c.copy(p.clip);
            const y = _c.y - rootY;
            if (y < p.minY) p.minY = y;
            const vy = Number.isFinite(p.lastY) ? (y - p.lastY) / dt : 0;
            p.vh = p.lastLive ? Math.hypot(_c.x - p.last.x, _c.z - p.last.z) / dt : 0;
            const plantado = y < p.minY + F.plantCm / 100 * U && Math.abs(vy) < F.vyMs * U;
            // predicción de aterrizaje: el pie baja → dónde tocará con su velocidad de ahora
            p.predOk = false;
            if (p.lastLive && vy < -F.vyMs * U && !plantado) {
                const tt = (y - p.minY) / -vy;
                if (tt < 0.5) { p.prediccion.subVectors(_c, p.last).multiplyScalar(tt / dt).add(_c); p.prediccion.y = rootY + p.minY; p.predOk = true; }
            }
            p.last.copy(_c); p.lastLive = true; p.lastY = y; p.live = true;
            if (groundVel && p.locked && !p.soporte) p.lockLocal.addScaledVector(groundVel, dt);
            if (plantado && !p.locked && !moviendo) {
                p.locked = true; p.soporte = this.soporte;
                _lock.copy(_c); _lock.y = Math.min(_c.y, rootY + p.minY + 0.5 * F.plantCm / 100 * U);
                if (this.suelo) { this.suelo(_lock.x, _lock.z, _suelo); _lock.y = Math.max(_lock.y, _suelo.y); }
                p.lockLocal.copy(_lock); if (p.soporte) p.soporte.worldToLocal(p.lockLocal);
                p.ancla0.copy(_lock); p.drift = 0;
            } else if (p.locked && (moviendo || y > p.minY + F.plantCm / 100 * U || p.vh > F.pasoMs * U)) {
                // se suelta cuando el clip LEVANTA el pie o lo DESPLAZA a paso (no por el ruido de su velocidad vertical). Si lo
                // arrastra por el suelo, el traslado se hace con un arco (`paso`): un paso corto en vez de un patinazo.
                p.paso = y < p.minY + F.plantCm / 100 * U ? 1 : 0;
                p.locked = false; this.anclaMundo(p, p.from);
            }
            p.w = p.locked ? Math.min(1, p.w + dt / F.inS) : Math.max(0, p.w - dt / F.outS);
            if (!(p.w > 0)) p.paso = 0;
        }
        // 2) Pelvis: baja lo justo para que TODAS las piernas apoyadas lleguen a su ancla; suavizado dentro de [0, necesaria].
        let necesaria = 0;
        if (this.pelvis?.parent) {
            for (const p of this.pies) {
                if (!(p.w > 1e-3)) continue;
                this.objetivo(p, groundVel, dt, _t, false);
                p.thigh.getWorldPosition(_hip);
                p.shin.getWorldPosition(_a); const l1 = _hip.distanceTo(_a); p.foot.getWorldPosition(_v); const l = (l1 + _a.distanceTo(_v)) * F.stretch;
                const r = Math.hypot(_t.x - _hip.x, _t.z - _hip.z), dy = _hip.y - _t.y;
                if (r < l) { const falta = dy - Math.sqrt(l * l - r * r); if (falta > necesaria) necesaria = falta; }
            }
            necesaria = Math.min(F.pelvisMax, Math.max(0, necesaria));
            const k = Math.min(1, dt / F.pelvisS);
            this.bajada = Math.min(necesaria, this.bajada + (necesaria - this.bajada) * k);   // acotada: nunca por debajo del alcance
            if (this.bajada > 1e-4) {
                const pv = this.pelvis; this.pelvisBase.copy(pv.position); pv.getWorldPosition(_v); _v.y -= this.bajada; pv.parent!.worldToLocal(_v);
                pv.position.copy(_v); pv.updateMatrixWorld(true); this.pelvisSet.copy(pv.position); this.pelvisMovida = true;
            }
        }
        // 3) IK de cada pierna hacia su ancla; el pie se alinea al plano de apoyo.
        for (const p of this.pies) {
            p.foot.getWorldPosition(_c);
            this.plano(p, _c, glb, rootY);
            this.objetivo(p, groundVel, dt, _t, true);   // suelto (w = 0) el objetivo es el pie del clip: el tope de giro no lo arrastra
            if (_t.distanceToSquared(_c) < 1e-8) continue;
            p.shin.getWorldPosition(_v); p.thigh.getWorldPosition(_pole);
            _pole.subVectors(_v, _pole).normalize();
            _v.subVectors(_c, p.thigh.getWorldPosition(_a)).normalize();
            _pole.addScaledVector(_v, -_pole.dot(_v));
            if (_pole.lengthSq() < 1e-6) glb.getWorldDirection(_pole).setY(0);
            p.foot.getWorldQuaternion(_q1);
            if (!dosHuesos(p.thigh, p.shin, p.foot, _t, _pole, F.stretch)) { if (p.locked) { p.locked = false; this.anclaMundo(p, p.from); } continue; }
            if (p.foot.parent) {
                // alinear al plano: la normal del clip (+Y del pie en mundo) gira hacia la normal del suelo, por el peso
                _n.copy(UP); _q.setFromUnitVectors(UP, p.plano.normal); _qw.identity().slerp(_q, p.w);
                _q1.premultiply(_qw);
                p.foot.parent.getWorldQuaternion(_qp).invert(); p.foot.quaternion.copy(_qp.multiply(_q1)); p.foot.updateMatrixWorld(true);
            }
            if (p.locked) {   // drift en el mundo durante el apoyo
                p.foot.getWorldPosition(_c);
                this.anclaMundo(p, _lock); // con suelo móvil, el drift se mide contra el ancla que se mueve con él
                const d = groundVel && !p.soporte ? Math.hypot(_c.x - _lock.x, _c.z - _lock.z) : Math.hypot(_c.x - p.ancla0.x, _c.z - p.ancla0.z);
                { p.drift = Math.max(p.drift, d); this.driftCm = Math.max(this.driftCm, p.drift / U * 100); }
            }
        }
    }

    private objetivo(p: Pie, groundVel: THREE.Vector3 | null, dt: number, out: THREE.Vector3, avanzar: boolean): void {
        if (p.locked) out.copy(p.clip).lerp(this.anclaMundo(p, _lock), p.w);
        else { if (avanzar && groundVel) p.from.addScaledVector(groundVel, dt); out.copy(p.clip).lerp(p.from, p.w); if (p.paso) out.y += PIES.pasoAlto * Math.sin(Math.PI * p.w); }
    }

    private plano(p: Pie, pie: THREE.Vector3, glb: THREE.Object3D, rootY: number): void {
        p.foot.getWorldQuaternion(_qw); _fw.set(0, 0, 1).applyQuaternion(_qw); _fw.y = 0;
        if (_fw.lengthSq() < 1e-6) glb.getWorldDirection(_fw).setY(0);
        _fw.normalize();
        p.plano.punta.copy(pie).addScaledVector(_fw, PIES.tarso);
        if (this.suelo) { this.suelo(p.plano.punta.x, p.plano.punta.z, _suelo); p.plano.punta.y = _suelo.y; p.plano.normal.copy(_suelo.normal).normalize(); }
        else { p.plano.punta.y = rootY; p.plano.normal.copy(UP); }
    }

    /** La pelvis gira como mucho turnMax rad/s en vertical; el exceso se arrastra y se paga cuando el clip frena. */
    private topeGiro(glb: THREE.Object3D, dt: number): void {
        const pv = this.pelvis; if (!pv) return;
        pv.getWorldQuaternion(_qw); glb.getWorldQuaternion(_qp).invert();
        _v.set(0, 0, 1).applyQuaternion(_qp.multiply(_qw));
        const yaw = Math.atan2(_v.x, _v.z);
        if (Number.isFinite(this.lastYaw)) {
            let dy = yaw - this.lastYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
            const want = dy + this.yawLag, cap = PIES.turnMax * dt, shown = Math.max(-cap, Math.min(cap, want));
            this.yawLag = want - shown;
            if (Math.abs(this.yawLag) > 1e-5) { _q.setFromAxisAngle(UP, -this.yawLag); girarMundo(pv, _q); }
        }
        this.lastYaw = yaw;
    }
}
