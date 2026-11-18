// ik — IK de dos huesos con polo, y el efector como PUNTA (arma/garra) con offset fijo (Cinevva).
// Reescrito a partir del twoBoneIk de F1 (FE engine/anim-v2/foot-lock.ts, r831). Sin asignaciones por cuadro.
import * as THREE from 'three';

export const MODULO = 'ik' as const;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();
const _tip = new THREE.Vector3(), _tt = new THREE.Vector3(), _hh = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _q1 = new THREE.Quaternion();

/** Gira `bone` por la rotación de mundo `q` y refresca su subárbol. */
export function girarMundo(bone: THREE.Object3D, q: THREE.Quaternion): void {
    if (!bone.parent) return;
    bone.getWorldQuaternion(_qw);
    _q1.multiplyQuaternions(q, _qw);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_q1.premultiply(_qp));
    bone.updateMatrixWorld(true);
}

/** Longitud de la cadena (u, mundo). */
export function largoCadena(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D): number {
    upper.getWorldPosition(_a); mid.getWorldPosition(_b); end.getWorldPosition(_e);
    return _a.distanceTo(_b) + _b.distanceTo(_e);
}

/** «Fuera de alcance» ANTES del golpe: ¿llega la cadena (más `extra`, la punta) a `target` sin pasar de `stretch`? */
export function alcanza(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, extra = 0, stretch = 0.995): boolean {
    const l = largoCadena(upper, mid, end) + extra;
    return upper.getWorldPosition(_a).distanceTo(target) <= l * stretch;
}

/** Dos huesos, la articulación media hacia `pole` (mundo). false si el blanco pasa de `stretch` de la cadena. */
export function dosHuesos(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, stretch = 1): boolean {
    upper.getWorldPosition(_a); mid.getWorldPosition(_b); end.getWorldPosition(_e);
    const l1 = _a.distanceTo(_b), l2 = _e.distanceTo(_b);
    if (l1 < 1e-5 || l2 < 1e-5) return false;
    _d.subVectors(target, _a);
    let d = _d.length();
    if (d < 1e-5 || d > (l1 + l2) * stretch) return false;
    _d.multiplyScalar(1 / d);
    d = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(l1 + l2 - 1e-4, d));
    _k.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_k.lengthSq() < 1e-8) return false;
    _k.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    _k.multiplyScalar(h).addScaledVector(_d, x).add(_a);
    _b.sub(_a).normalize(); _k.sub(_a).normalize();
    _q.setFromUnitVectors(_b, _k); girarMundo(upper, _q);
    mid.getWorldPosition(_b); end.getWorldPosition(_e);
    _e.sub(_b); _k.subVectors(target, _b);
    if (_e.lengthSq() > 1e-10 && _k.lengthSq() > 1e-10) { _q.setFromUnitVectors(_e.normalize(), _k.normalize()); girarMundo(mid, _q); }
    return true;
}

/** La punta del efector: `end` + `offset` u a lo largo de (end − mid). La garra de A es 0.28; la punta del pie, 0.25. */
export function puntaEfector(mid: THREE.Object3D, end: THREE.Object3D, offset: number, out: THREE.Vector3): THREE.Vector3 {
    end.getWorldPosition(_e); mid.getWorldPosition(_b);
    _d.subVectors(_e, _b); const l = _d.length();
    return out.copy(_e).addScaledVector(_d, l > 1e-6 ? offset / l : 0);
}

/** Lleva la PUNTA (no el hueso) a `target`: corrige el blanco del hueso por la diferencia, `iter` pasadas. */
export function puntaA(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, offset: number, target: THREE.Vector3, pole: THREE.Vector3, iter = 4): boolean {
    const tip = _tip, t = _tt, h = _hh;
    let ok = true;
    for (let i = 0; i < iter; i++) {
        puntaEfector(mid, end, offset, tip); t.subVectors(target, tip);
        if (t.lengthSq() < 1e-6) break;
        end.getWorldPosition(h).add(t);
        ok = dosHuesos(upper, mid, end, h, pole); if (!ok) break;
    }
    return ok;
}
