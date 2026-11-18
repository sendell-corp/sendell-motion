// capas — capas aditivas después de la mezcla del clip, cada una con su máscara por hueso y su peso:
// respirar (pecho y hombros), mirar (cuello y cabeza al punto de interés, con tope), inclinarse hacia el blanco (columna) y
// encogerse al recibir un golpe (impulso que decae). Separa la capa de OBJETIVO (qué miro, hacia dónde me inclino: `objetivo`)
// de la capa de POSE (cómo se reparte en los huesos), la idea rescatada de ai4anim (docs/ESTADO-DEL-ARTE.md).
// Todo se escribe sobre la pose del clip de ESTE cuadro: si el clip no reescribe un hueso, `restaurar()` lo devuelve.
import * as THREE from 'three';
import { girarMundo } from '../ik/index.ts';

export const MODULO = 'capas' as const;

export type Mascara = Readonly<Record<string, number>>;   // hueso → reparto (0..1)

export const CAPAS = Object.freeze({
    respirar: { hz: 0.25, rad: 0.035, mascara: { chest: 1, spine: 0.4, upperarm_L: -0.5, upperarm_R: -0.5 } as Mascara },
    mirar: { maxRad: 1.1, mascara: { neck: 0.4, head: 0.6 } as Mascara, s: 0.12 },
    inclinar: { maxRad: 0.35, mascara: { spine: 0.5, chest: 0.5 } as Mascara },
    encoger: { rad: 0.3, decaeS: 0.25, mascara: { spine: 0.3, chest: 0.5, neck: 0.2 } as Mascara },
});

/** Capa de objetivo: lo que quiere el actor, sin saber de huesos. */
export interface Objetivo {
    mirar: THREE.Vector3 | null;          // punto de interés (mundo)
    inclinar: THREE.Vector3 | null;       // dirección del blanco (mundo, plano)
    golpe: { dir: THREE.Vector3; fuerza: number } | null;   // un golpe recibido ESTE cuadro
}

const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ax = new THREE.Vector3();
const _f = new THREE.Vector3(), _h = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Capas {
    private glb: THREE.Object3D | null = null;
    private huesos = new Map<string, THREE.Object3D>();
    private base = new Map<THREE.Object3D, THREE.Quaternion>();
    private escritas = new Map<THREE.Object3D, THREE.Quaternion>();
    private t = 0; private yawMirar = 0; private pitchMirar = 0;
    private encoger = 0; private readonly ejeEncoger = new THREE.Vector3(1, 0, 0);
    peso = { respirar: 1, mirar: 1, inclinar: 1, encoger: 1 };
    readonly objetivo: Objetivo = { mirar: null, inclinar: null, golpe: null };

    private bind(glb: THREE.Object3D): void {
        this.glb = glb; this.huesos.clear(); this.base.clear(); this.escritas.clear();
        const C = CAPAS;
        for (const m of [C.respirar.mascara, C.mirar.mascara, C.inclinar.mascara, C.encoger.mascara])
            for (const n of Object.keys(m)) { const o = glb.getObjectByName(n); if (o) this.huesos.set(n, o); }
    }

    /** Antes de la mezcla del cuadro siguiente no hace falta nada; si el clip NO anima un hueso, esto quita lo que se escribió. */
    restaurar(): void {
        for (const [o, q] of this.escritas) if (o.quaternion.equals(q)) o.quaternion.copy(this.base.get(o)!);
        this.escritas.clear();
    }

    private girar(nombre: string, eje: THREE.Vector3, rad: number): void {
        const o = this.huesos.get(nombre); if (!o || Math.abs(rad) < 1e-6) return;
        if (!this.escritas.has(o)) { let b = this.base.get(o); if (!b) { b = new THREE.Quaternion(); this.base.set(o, b); } b.copy(o.quaternion); }
        _q.setFromAxisAngle(eje, rad); girarMundo(o, _q);
        let w = this.escritas.get(o); if (!w) { w = new THREE.Quaternion(); this.escritas.set(o, w); } w.copy(o.quaternion);
    }

    private repartir(m: Mascara, eje: THREE.Vector3, rad: number): void { for (const n in m) this.girar(n, eje, rad * m[n]); }

    aplicar(glb: THREE.Object3D, dt: number): void {
        if (glb !== this.glb) this.bind(glb);
        this.restaurar();
        const C = CAPAS, O = this.objetivo; this.t += dt;
        glb.getWorldDirection(_f).setY(0).normalize();
        _ax.crossVectors(UP, _f).normalize();   // eje lateral (inclinarse adelante = girar sobre él)
        // respirar
        if (this.peso.respirar > 0) this.repartir(C.respirar.mascara, _ax, this.peso.respirar * C.respirar.rad * Math.sin(this.t * 2 * Math.PI * C.respirar.hz));
        // inclinarse hacia el blanco
        if (O.inclinar && this.peso.inclinar > 0) {
            _a.copy(O.inclinar).setY(0); const l = _a.length();
            if (l > 1e-4) { _a.multiplyScalar(1 / l); _b.crossVectors(UP, _a).normalize(); this.repartir(C.inclinar.mascara, _b, this.peso.inclinar * C.inclinar.maxRad * Math.min(1, l)); }
        }
        // encogerse: el golpe de este cuadro arma un impulso que decae
        if (O.golpe) { this.encoger = Math.min(1, this.encoger + O.golpe.fuerza); this.ejeEncoger.crossVectors(UP, O.golpe.dir).normalize(); O.golpe = null; }
        if (this.encoger > 1e-3 && this.peso.encoger > 0) { this.repartir(C.encoger.mascara, this.ejeEncoger, -this.peso.encoger * C.encoger.rad * this.encoger); this.encoger *= Math.exp(-dt / C.encoger.decaeS); }
        // mirar (con tope y suavizado)
        const head = this.huesos.get('head');
        if (O.mirar && head && this.peso.mirar > 0) {
            head.getWorldPosition(_h); _a.subVectors(O.mirar, _h);
            const yaw = Math.atan2(_a.x, _a.z) - Math.atan2(_f.x, _f.z);
            const yw = Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch = -Math.atan2(_a.y, Math.hypot(_a.x, _a.z));
            const k = Math.min(1, dt / C.mirar.s), M = C.mirar.maxRad;
            this.yawMirar += (Math.max(-M, Math.min(M, yw)) - this.yawMirar) * k;
            this.pitchMirar += (Math.max(-M / 2, Math.min(M / 2, pitch)) - this.pitchMirar) * k;
            this.repartir(C.mirar.mascara, UP, this.peso.mirar * this.yawMirar);
            this.repartir(C.mirar.mascara, _ax, this.peso.mirar * this.pitchMirar);
        }
        void _qw;
    }
}
