// fisica/cuerpo-activo — M4 (rediseño del 17/11, decisión de Daniel): la marcha es 100 % la procedural; Jolt entra
// SOLO a demanda. Cada parte tiene una autoridad física `fis` 0..1 que mezcla la pose de salida entre la procedural
// (0) y la de Jolt (1):
//   · golpe de un jugable → sube `fis` en el cuerpo y en las patas del lado golpeado, impulso EN el punto de contacto,
//     y vuelve a 0 en ~0,5 s con una mezcla suave (los motores ya persiguen la pose procedural: no hay salto);
//   · muerte → física completa; agarre/lanzamiento → física completa mientras dure y, si sigue viva, vuelta a 0;
//   · mordida → IK sobre la pose procedural (sin física); pata rota → la marcha procedural cojea (sin física).
// Solo despiertan las golpeadas (o muertas / agarradas); las demás no cuestan nada en Jolt.
import initJolt from 'jolt-physics';
import type Jolt from 'jolt-physics';
import * as T from 'three';

type J = typeof Jolt;
export type TipoCriatura = 'arana' | 'gusano';
export type EstadoCriatura = 'dormida' | 'activa' | 'muriendo' | 'cadaver';
export interface V3 { x: number; y: number; z: number }
export interface PoseParte { p: T.Vector3; q: T.Quaternion }

const CAPA_FIJA = 0, CAPA_MOVIL = 1, CAPA_DORMIDA = 2;
const FUNDIDO_MUERTE = 0.35;           // s que tardan los motores en apagarse al morir
const SEG_CADAVER = 4;                 // CREATURE_BUDGET.corpseSeconds del juego
const MARGEN = .035;                    // m de colisión por fuera de la pieza visible
const VUELTA = [.1, .55];              // s tras el golpe: la física manda hasta .12 y se funde a 0 hasta .5 (smoothstep)
const RETENER_LANZADA = .7;            // s de física completa tras soltarla (vuelo y caída) antes de fundirse
const ARRIBA = new T.Vector3(0, 1, 0);

/** Geometría de reposo: la misma que CreatureModel.spider() / worm() (creature-presentation.ts), en el espacio de la raíz. */
interface ParteDef { a: T.Vector3; b: T.Vector3; r: number; masa: number; caja?: T.Vector3; padre: number; cono: number; giro: number }

function defArana(): ParteDef[] {
    const d: ParteDef[] = [{ a: new T.Vector3(0, .58, 0), b: new T.Vector3(0, .58, 0), r: .2, masa: 6, caja: new T.Vector3(.5, .2, .5), padre: -1, cono: 0, giro: 0 }];
    for (let i = 0; i < 8; i++) {
        const an = i * Math.PI / 4 + .18, dx = Math.sin(an), dz = Math.cos(an);
        const base = new T.Vector3(dx * .4, .6, dz * .4), rod = new T.Vector3(dx * .96, .82, dz * .96);
        const pie = new T.Vector3(dx * 1.26, .1, dz * 1.26), punta = new T.Vector3(dx * 1.4, -.015 + .06, dz * 1.4);
        const n = d.length;
        d.push({ a: base, b: rod, r: .07, masa: .35, padre: 0, cono: .7, giro: .15 });
        d.push({ a: rod, b: pie, r: .055, masa: .25, padre: n, cono: .9, giro: .1 });
        d.push({ a: pie, b: punta, r: .045, masa: .1, padre: n + 1, cono: .5, giro: .1 });
    }
    return d;
}

function defGusano(): ParteDef[] {
    // Como el gusano del juego: 16 partes, tubo en el suelo y cuerpo que se alza; aquí la espiral se abre en línea para
    // que el prototipo lea mejor. Radios .2 (suelo) / .26 (cuerpo), como worm().
    const pts: T.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
        if (i <= 9) pts.push(new T.Vector3(0, .24, -1.8 + i * .36));
        else { const k = i - 9, a = k / 7 * Math.PI * .5; pts.push(new T.Vector3(0, .24 + Math.sin(a) * 1.5, -1.8 + 9 * .36 + (1 - Math.cos(a)) * .3 + k * .12)); }
    }
    const d: ParteDef[] = [];
    for (let i = 0; i < 16; i++) d.push({ a: pts[i], b: pts[i + 1], r: i < 8 ? .2 : .26, masa: i < 8 ? .8 : 1, padre: i - 1, cono: .35, giro: .15 });
    return d;
}

interface Parte {
    def: ParteDef; body: Jolt.Body; id: Jolt.BodyID; local: T.Vector3; localQ: T.Quaternion;
    /** Ejes de la junta con su padre en el espacio de la raíz (reposo): giro (X), plano (Y), normal (Z). */
    ejeGiro: T.Vector3; ejePlano: T.Vector3; ejeNormal: T.Vector3;
    /** aut: fuerza de los motores 0..1; fis / pico: autoridad física de la salida y su pico tras el golpe. */
    aut: number; fis: number; pico: number; junta: Jolt.SwingTwistConstraint | null; torque: number;
    /** Ángulos procedurales de la junta este cuadro (alrededor del plano y de la normal). */
    ay: number; az: number;
}
interface Criatura {
    id: string; tipo: TipoCriatura; estado: EstadoCriatura; partes: Parte[]; grupo: number;
    raiz: T.Vector3; rumbo: number; fase: number; reloj: number; ultimoGolpe: number;
    /** s desde el último golpe/suelta (la vuelta a la procedural se cuenta desde aquí) y s que la física se retiene. */
    tGolpe: number; retener: number;
    rotas: number; mordida: { p: T.Vector3; t: number; dur: number } | null; mano: { body: Jolt.Body; c: Jolt.Constraint; p: T.Vector3 } | null;
    proc: PoseParte[];
}

export interface OpcionesMundo { lod?: boolean; pasosVelocidad?: number }

const nuevaPose = (n: number): PoseParte[] => Array.from({ length: n }, () => ({ p: new T.Vector3(), q: new T.Quaternion() }));
const suave = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class MundoFisico {
    private crs = new Map<string, Criatura>();
    private bi: Jolt.BodyInterface;
    private sys: Jolt.PhysicsSystem;
    private v: Jolt.Vec3; private v2: Jolt.Vec3; private rv: Jolt.RVec3; private qj: Jolt.Quat;
    private filtro: Jolt.GroupFilterTable;
    private grupos = 0; private t = 0;
    /** true: duermen las que no tienen física que hacer (solo despiertan las golpeadas). false: las 25 despiertas (banco). */
    lod: boolean;
    /** Último paso: ms totales (pose procedural de todas + motores + Step de Jolt). */
    ultimoMs = 0;

    private constructor(private J: J, private iface: Jolt.JoltInterface, op: OpcionesMundo) {
        this.v = new J.Vec3(0, 0, 0); this.v2 = new J.Vec3(0, 0, 0); this.rv = new J.RVec3(0, 0, 0); this.qj = new J.Quat(0, 0, 0, 1);
        this.sys = iface.GetPhysicsSystem(); this.bi = this.sys.GetBodyInterface();
        this.lod = op.lod ?? true;
        this.filtro = new J.GroupFilterTable(32);
        for (let a = 0; a < 32; a++) for (let b = a + 1; b < 32; b++) this.filtro.DisableCollision(a, b);
        const ps = this.sys.GetPhysicsSettings(); ps.mNumVelocitySteps = op.pasosVelocidad ?? 6;
        ps.mPenetrationSlop = .005; ps.mBaumgarte = .2; ps.mSpeculativeContactDistance = .03; ps.mLinearCastThreshold = .2;
        this.sys.SetPhysicsSettings(ps);
    }

    static async crear(op: OpcionesMundo = {}): Promise<MundoFisico> {
        const J = await initJolt();
        const s = new J.JoltSettings(); s.mMaxBodies = 4096; s.mMaxBodyPairs = 16384; s.mMaxContactConstraints = 8192;
        const olf = new J.ObjectLayerPairFilterTable(3);
        olf.EnableCollision(CAPA_FIJA, CAPA_MOVIL); olf.EnableCollision(CAPA_MOVIL, CAPA_MOVIL);
        const bpi = new J.BroadPhaseLayerInterfaceTable(3, 3);
        bpi.MapObjectToBroadPhaseLayer(CAPA_FIJA, new J.BroadPhaseLayer(0));
        bpi.MapObjectToBroadPhaseLayer(CAPA_MOVIL, new J.BroadPhaseLayer(1));
        bpi.MapObjectToBroadPhaseLayer(CAPA_DORMIDA, new J.BroadPhaseLayer(2));
        s.mObjectLayerPairFilter = olf; s.mBroadPhaseLayerInterface = bpi;
        s.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 3, olf, 3);
        const iface = new J.JoltInterface(s); J.destroy(s);
        return new MundoFisico(J, iface, op);
    }

    /** Caja estática (suelo, paredes). Centro y medias medidas. */
    caja(c: V3, h: V3): void {
        const J = this.J; const sh = new J.BoxShape(new J.Vec3(h.x, h.y, h.z), .05);
        const bcs = new J.BodyCreationSettings(sh, new J.RVec3(c.x, c.y, c.z), J.Quat.prototype.sIdentity(), J.EMotionType_Static, CAPA_FIJA);
        bcs.mFriction = .8; this.bi.CreateAndAddBody(bcs, J.EActivation_DontActivate); J.destroy(bcs);
    }
    /** Suelo de 1 u de grosor (nada lo atraviesa aunque el paso sea grande) y cuatro paredes. */
    sala(medio: number, alto = 3): void {
        this.caja({ x: 0, y: -.5, z: 0 }, { x: medio + 1, y: .5, z: medio + 1 });
        for (const [x, z, hx, hz] of [[medio + .25, 0, .25, medio], [-medio - .25, 0, .25, medio], [0, medio + .25, medio, .25], [0, -medio - .25, medio, .25]])
            this.caja({ x, y: alto / 2, z }, { x: hx, y: alto / 2, z: hz });
    }

    agregar(id: string, tipo: TipoCriatura, x: number, z: number, rumbo = 0): void {
        const J = this.J; const defs = tipo === 'arana' ? defArana() : defGusano();
        const grupo = ++this.grupos; const raizQ = new T.Quaternion().setFromAxisAngle(ARRIBA, rumbo);
        const raiz = new T.Vector3(x, 0, z); const partes: Parte[] = [];
        defs.forEach((d, i) => {
            const len = d.a.distanceTo(d.b);
            // Colisión algo más gorda que la pieza dibujada (MARGEN): el hueco de contacto de Jolt (~2 cm bajo carga o en
            // un golpe fuerte) queda dentro del margen y la pieza visible no entra en suelo ni pared.
            const sh: Jolt.Shape = d.caja ? new J.BoxShape(new J.Vec3(d.caja.x + MARGEN, d.caja.y + MARGEN, d.caja.z + MARGEN), .08) : new J.CapsuleShape(Math.max(.01, len / 2), d.r + MARGEN);
            const local = d.a.clone().add(d.b).multiplyScalar(.5);
            const localQ = d.caja ? new T.Quaternion() : new T.Quaternion().setFromUnitVectors(ARRIBA, d.b.clone().sub(d.a).normalize());
            const p = local.clone().applyQuaternion(raizQ).add(raiz), q = raizQ.clone().multiply(localQ);
            const bcs = new J.BodyCreationSettings(sh, new J.RVec3(p.x, p.y, p.z), new J.Quat(q.x, q.y, q.z, q.w), J.EMotionType_Dynamic, CAPA_MOVIL);
            bcs.mAllowDynamicOrKinematic = true; bcs.mFriction = .7; bcs.mLinearDamping = .1; bcs.mAngularDamping = .3;
            bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia; bcs.mMassPropertiesOverride.mMass = d.masa;
            bcs.mMotionQuality = J.EMotionQuality_LinearCast;   // AUDITORIA #10: nada atraviesa suelo ni paredes
            bcs.mMaxLinearVelocity = 12;
            bcs.mCollisionGroup = new J.CollisionGroup(this.filtro, grupo, i);
            const body = this.bi.CreateBody(bcs); J.destroy(bcs);
            this.bi.AddBody(body.GetID(), J.EActivation_Activate);
            const ejeGiro = d.b.clone().sub(d.a).normalize();
            const ejePlano = new T.Vector3().crossVectors(ejeGiro, ARRIBA); if (ejePlano.lengthSq() < 1e-4) ejePlano.set(1, 0, 0); ejePlano.normalize();
            const ejeNormal = new T.Vector3().crossVectors(ejeGiro, ejePlano).normalize();
            partes.push({ def: d, body, id: body.GetID(), local, localQ, ejeGiro, ejePlano, ejeNormal, aut: 1, fis: 0, pico: 0, junta: null, torque: 0, ay: 0, az: 0 });
        });
        // Juntas: giro-oscilación con límites (no estira: restricción dura) y motor de posición hacia la pose procedural.
        defs.forEach((d, i) => {
            if (d.padre < 0) return;
            const pt = partes[i], cs = new J.SwingTwistConstraintSettings();
            const pj = d.a.clone().applyQuaternion(raizQ).add(raiz), eje = pt.ejeGiro.clone().applyQuaternion(raizQ), plano = pt.ejePlano.clone().applyQuaternion(raizQ);
            cs.mSpace = J.EConstraintSpace_WorldSpace;
            cs.mPosition1 = cs.mPosition2 = new J.RVec3(pj.x, pj.y, pj.z);
            cs.mTwistAxis1 = cs.mTwistAxis2 = new J.Vec3(eje.x, eje.y, eje.z);
            cs.mPlaneAxis1 = cs.mPlaneAxis2 = new J.Vec3(plano.x, plano.y, plano.z);
            cs.mNormalHalfConeAngle = d.cono; cs.mPlaneHalfConeAngle = d.cono; cs.mTwistMinAngle = -d.giro; cs.mTwistMaxAngle = d.giro;
            cs.mMaxFrictionTorque = tipo === 'arana' ? .3 : 1;
            const torque = tipo === 'arana' ? (d.padre === 0 ? 40 : 20) : (i >= 8 && i <= 12 ? 220 : 120);
            for (const m of [cs.mSwingMotorSettings, cs.mTwistMotorSettings]) {
                m.mSpringSettings.mFrequency = tipo === 'arana' ? 12 : 35; m.mSpringSettings.mDamping = 1;
                m.mMinTorqueLimit = -torque; m.mMaxTorqueLimit = torque;
            }
            const c = J.castObject(this.bi.CreateConstraint(cs, partes[d.padre].id, partes[i].id), J.SwingTwistConstraint);
            J.destroy(cs);
            this.sys.AddConstraint(c);
            c.SetSwingMotorState(J.EMotorState_Position); c.SetTwistMotorState(J.EMotorState_Position);
            pt.junta = c; pt.torque = torque;
        });
        const c: Criatura = { id, tipo, estado: 'activa', partes, grupo, raiz, rumbo, fase: [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0) | 0, 7) % 628 / 100,
            reloj: 0, ultimoGolpe: -99, tGolpe: 99, retener: 0, rotas: 0, mordida: null, mano: null, proc: nuevaPose(partes.length) };
        this.crs.set(id, c); this.procedural(c, 0); this.dormir(c); if (!this.lod) this.despertar(c);
    }

    /** Pose de la animación para la raíz este cuadro (EnemyThree.root: posición en el suelo y rumbo). */
    objetivo(id: string, x: number, z: number, rumbo: number, fase?: number): void {
        const c = this.crs.get(id); if (!c) return; c.raiz.set(x, 0, z); c.rumbo = rumbo; if (fase !== undefined) c.fase = fase;
    }

    /** Golpe de un jugable (en el juego: el evento de contacto del ataque). Impulso (N·s) EN `punto`; sube la autoridad
     *  física del cuerpo y de las patas del lado golpeado y vuelve sola a la procedural en ~0,5 s. */
    golpe(id: string, punto: V3, dir: V3, impulso: number): void {
        const c = this.crs.get(id); if (!c || c.estado === 'cadaver') return;
        if (c.estado === 'dormida') this.despertar(c);
        const pt = new T.Vector3(punto.x, punto.y, punto.z); const k = this.masCercana(c, pt);
        // El impulso entra EN el punto, pero una pata ligera solo absorbe hasta ~8 m/s de cambio; el resto pasa al cuerpo
        // por la cadena (si no, 60 N·s sobre 0,1 kg = 600 m/s y atraviesa paredes).
        const d = new T.Vector3(dir.x, dir.y, dir.z).normalize().multiplyScalar(impulso);
        const tope = c.partes[k].def.masa * 12, parte = Math.min(1, tope / Math.max(1e-6, impulso));
        this.v.Set(d.x * parte, d.y * parte, d.z * parte); this.rv.Set(pt.x, pt.y, pt.z); this.bi.AddImpulse(c.partes[k].id, this.v, this.rv);
        if (parte < 1) {
            const resto = 1 - parte;
            if (c.tipo === 'arana') { const rr = resto * .6; this.v.Set(d.x * rr, d.y * rr, d.z * rr);   // el cuerpo absorbe parte (patas cediendo)
                this.bi.AddImpulse(c.partes[0].id, this.v, this.rv); }
            else for (let i = Math.max(0, k - 3); i <= Math.min(15, k + 3); i++) { const f = resto / 7; this.v.Set(d.x * f, d.y * f, d.z * f); this.bi.AddImpulse(c.partes[i].id, this.v); }
        }
        c.partes.forEach((p, i) => {
            // Araña: cede por distancia al punto (las patas del lado golpeado; las del otro casi no) y la pata golpeada entera.
            // Gusano: ±4 anillos. `fis` decide cuánto de Jolt se ve; `aut` cuánto empujan los motores mientras tanto.
            const q = p.body.GetCenterOfMassPosition(), dd = Math.hypot(q.GetX() - pt.x, q.GetY() - pt.y, q.GetZ() - pt.z);
            const mismaPata = k > 0 && i > 0 && Math.floor((i - 1) / 3) === Math.floor((k - 1) / 3);
            const cerca = c.tipo === 'arana' ? (i === 0 ? .2 : mismaPata ? 1 : Math.max(0, 1 - dd / 1.1)) : Math.max(0, 1 - Math.abs(i - k) / 4);
            p.aut = Math.min(p.aut, 1 - .9 * cerca);
            const f = c.tipo === 'arana' ? 1 : cerca;   // araña entera (las patas lejanas, con motores fuertes, siguen la marcha): sin costuras en las caderas
            if (c.tipo === 'arana' && i > 0 && i !== k && cerca > .2) { const g = Math.min(p.def.masa * 16, impulso * .25) * cerca; this.v.Set(d.x / impulso * g, d.y / impulso * g, d.z / impulso * g); this.bi.AddImpulse(p.id, this.v); }
            p.pico = Math.max(p.fis, f); p.fis = p.pico;
        });
        c.ultimoGolpe = this.t; c.tGolpe = 0;
    }
    /** Alias con el nombre que usará el juego. */
    hit(enemyId: string, point: V3, dir: V3, impulse: number): void { this.golpe(enemyId, point, dir, impulse); }

    /** Parry: tambaleo — empuje en el cuerpo, el cuerpo entero con autoridad física media. */
    parry(id: string, dir: V3, impulso = 30): void {
        const c = this.crs.get(id); if (!c || c.estado === 'cadaver') return;
        const b = c.proc[0].p; this.golpe(id, { x: b.x, y: b.y + .15, z: b.z }, dir, impulso);
        for (const p of c.partes) { p.aut = Math.min(p.aut, .5); p.pico = p.fis = Math.max(p.fis, .5); }
    }

    /** Muerte: física completa; los motores se funden a 0 en 0,35 s → ragdoll entero; a los 4 s se congela. */
    matar(id: string, punto?: V3, dir?: V3, impulso = 0): void {
        const c = this.crs.get(id); if (!c || c.estado === 'muriendo' || c.estado === 'cadaver') return;
        if (punto && dir && impulso > 0) this.golpe(id, punto, dir, impulso); else if (c.estado === 'dormida') this.despertar(c);
        c.estado = 'muriendo'; c.reloj = 0;
        for (const p of c.partes) { p.fis = p.pico = 1; const mp = p.body.GetMotionProperties(); mp.SetLinearDamping(1); mp.SetAngularDamping(5); p.junta?.SetMaxFrictionTorque(c.tipo === 'arana' ? 1.5 : 4); }
    }
    kill(enemyId: string, point?: V3, dir?: V3, impulse = 0): void { this.matar(enemyId, point, dir, impulse); }

    quitar(id: string): void {
        const c = this.crs.get(id); if (!c) return;
        if (c.mano) this.soltar(id);
        for (const p of c.partes) if (p.junta) this.sys.RemoveConstraint(p.junta);
        for (const p of c.partes) { this.bi.RemoveBody(p.id); this.bi.DestroyBody(p.id); }
        this.crs.delete(id);
    }

    /** Pata rota: sale de la marcha procedural (esa pata casi no se mueve, el cuerpo baja y se inclina hacia ella, la
     *  cadencia se vuelve irregular y la trayectoria deriva). No despierta la física. */
    romperPata(id: string, i: number): void {
        const c = this.crs.get(id); if (c && c.tipo === 'arana') c.rotas |= 1 << i;
    }
    /** Boca en el mundo (pose de salida): araña = frente del cuerpo (quelíceros); gusano = punta de la cabeza. */
    boca(id: string): T.Vector3 { return this.bocaDe(this.crs.get(id)!, this.pose(id)); }
    /** Mordida: IK sobre la pose procedural; la boca llega al punto del cuerpo del blanco a mitad de `seg` (el cuadro de
     *  impacto) y vuelve. Sin física. */
    morder(id: string, blanco: V3, seg = .3): void {
        const c = this.crs.get(id); if (!c || c.estado === 'cadaver' || c.estado === 'muriendo') return;
        c.mordida = { p: new T.Vector3(blanco.x, blanco.y, blanco.z), t: 0, dur: seg };
    }
    /** Agarre: un punto de la criatura queda unido por una articulación física (PointConstraint) a una mano cinemática;
     *  física completa mientras dure. */
    agarrar(id: string, punto: V3): void {
        const J = this.J; const c = this.crs.get(id); if (!c || c.mano) return;
        if (c.estado === 'dormida' || c.estado === 'cadaver') this.despertar(c);
        const pt = new T.Vector3(punto.x, punto.y, punto.z), k = this.masCercana(c, pt);
        const bcs = new J.BodyCreationSettings(new J.SphereShape(.05), new J.RVec3(pt.x, pt.y, pt.z), J.Quat.prototype.sIdentity(), J.EMotionType_Kinematic, CAPA_DORMIDA);
        const body = this.bi.CreateBody(bcs); J.destroy(bcs); this.bi.AddBody(body.GetID(), J.EActivation_Activate);
        const cs = new J.PointConstraintSettings(); cs.mSpace = J.EConstraintSpace_WorldSpace; cs.mPoint1 = cs.mPoint2 = new J.RVec3(pt.x, pt.y, pt.z);
        const con = this.bi.CreateConstraint(cs, body.GetID(), c.partes[k].id); J.destroy(cs); this.sys.AddConstraint(con);
        c.mano = { body, c: con, p: pt.clone() };
        for (const p of c.partes) { p.aut = .15; p.fis = p.pico = 1; }
    }
    /** Mueve la mano (la física la sigue en el próximo paso). */
    mano(id: string, punto: V3): void { const c = this.crs.get(id); if (c?.mano) c.mano.p.set(punto.x, punto.y, punto.z); }
    /** Suelta: sale con la velocidad que llevaba la mano; si sigue viva, vuelve a la procedural tras el vuelo. */
    soltar(id: string): void {
        const c = this.crs.get(id); if (!c?.mano) return;
        this.sys.RemoveConstraint(c.mano.c); this.bi.RemoveBody(c.mano.body.GetID()); this.bi.DestroyBody(c.mano.body.GetID()); c.mano = null;
        c.tGolpe = 0; c.retener = RETENER_LANZADA; for (const p of c.partes) p.pico = p.fis = 1;
    }
    /** Velocidad lineal de una parte (0 = cuerpo / primer anillo). */
    velocidad(id: string, i = 0): T.Vector3 { const v = this.crs.get(id)!.partes[i].body.GetLinearVelocity(); return new T.Vector3(v.GetX(), v.GetY(), v.GetZ()); }

    /** Formas VISIBLES de las partes (sin el margen de colisión): caja (medias medidas) o cápsula (radio, media altura en Y). */
    formas(id: string): { caja?: V3; r: number; media: number }[] {
        return (this.crs.get(id)?.partes ?? []).map(p => ({ caja: p.def.caja, r: p.def.r, media: Math.max(.01, p.def.a.distanceTo(p.def.b) / 2) }));
    }
    tipo(id: string): TipoCriatura | null { return this.crs.get(id)?.tipo ?? null; }
    estado(id: string): EstadoCriatura | null { return this.crs.get(id)?.estado ?? null; }
    get ids(): string[] { return [...this.crs.keys()]; }
    activas(): number { let n = 0; for (const c of this.crs.values()) if (c.estado === 'activa' || c.estado === 'muriendo') n++; return n; }
    /** Autoridad física máxima de la criatura (0 = 100 % procedural). */
    fisica(id: string): number { const c = this.crs.get(id); return c ? Math.max(...c.partes.map(p => p.fis)) : 0; }

    /** La pose de Jolt (sin mezclar), para medir. */
    poseFisica(id: string): PoseParte[] {
        const c = this.crs.get(id); if (!c) return [];
        return c.partes.map(p => { const a = p.body.GetPosition(), q = p.body.GetRotation(); return { p: new T.Vector3(a.GetX(), a.GetY(), a.GetZ()), q: new T.Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW()) }; });
    }
    /** La pose procedural de este cuadro (lo que se vería sin física). */
    poseProcedural(id: string): PoseParte[] { return this.crs.get(id)?.proc ?? []; }

    /** Pose de salida de cada parte (centro y orientación; eje Y local = eje de la cápsula): procedural mezclada con Jolt por `fis`. */
    pose(id: string, out: PoseParte[] = []): PoseParte[] {
        const c = this.crs.get(id); if (!c) return out;
        const qf = new T.Quaternion();
        c.partes.forEach((p, i) => {
            const o = out[i] ?? (out[i] = { p: new T.Vector3(), q: new T.Quaternion() }), pr = c.proc[i];
            if (c.estado === 'dormida' || p.fis <= 0) { o.p.copy(pr.p); o.q.copy(pr.q); return; }
            const pos = p.body.GetPosition(), q = p.body.GetRotation();
            o.p.set(pos.GetX(), pos.GetY(), pos.GetZ()); qf.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
            if (p.fis < 1) { o.p.lerpVectors(pr.p, o.p, p.fis); o.q.copy(pr.q).slerp(qf, p.fis); } else o.q.copy(qf);
        });
        return out;
    }

    /** Un paso: pose procedural de todas, vuelta de la autoridad física, motores hacia la procedural, Step de Jolt. */
    paso(dt: number, _jugador?: V3): number {
        const t0 = performance.now(); this.t += dt; let despiertas = 0;
        for (const c of this.crs.values()) {
            if (c.estado === 'activa' || c.estado === 'dormida') this.procedural(c, dt);
            if (c.estado === 'dormida' || c.estado === 'cadaver') continue;
            this.motores(c, dt); despiertas++;
            if (this.lod && c.estado === 'activa' && !c.mano && c.partes.every(p => p.fis <= 0)) this.dormir(c);
        }
        if (despiertas) this.iface.Step(dt, dt > 1 / 55 ? 2 : 1);
        this.ultimoMs = performance.now() - t0; return this.ultimoMs;
    }

    // ── pose procedural ─────────────────────────────────────────────────────────────────────────────────────────────
    /** Marcha procedural (la del juego vendrá de CreatureModel; aquí, la misma idea): araña — zancada en la cadera
     *  alterna por pata; gusano — onda en el cuerpo alzado. Cojera y mordida (IK) se aplican aquí. Rellena c.proc y los
     *  ángulos de junta que persiguen los motores. */
    private procedural(c: Criatura, dt: number): void {
        const rotas = this.contarBits(c.rotas);
        c.fase += dt * 6 * (rotas ? 1 + .45 * Math.sin(c.fase * .5) : 1);
        const rq = new T.Quaternion().setFromAxisAngle(ARRIBA, c.rumbo);
        for (let i = 0; i < c.partes.length; i++) {
            const p = c.partes[i]; p.ay = p.az = 0; if (!p.junta) continue;
            if (c.tipo === 'arana') {
                const pata = Math.floor((i - 1) / 3), seg = (i - 1) % 3; if (seg !== 0) continue;
                const s = c.fase + (pata % 2) * Math.PI, amp = c.rotas & (1 << pata) ? .25 : 1;   // pata rota: casi quieta
                p.az = Math.sin(s) * .25 * amp; p.ay = Math.max(0, Math.cos(s)) * .2 * amp;
                if (c.rotas & (1 << pata)) p.ay += .35;   // y recogida
            } else p.ay = i >= 9 ? Math.sin(c.fase * .5 - i * .6) * .08 : 0;
        }
        // Raíz (cuerpo): posición y giro de la animación + cojera.
        const raiz = c.raiz.clone(), giro = rq.clone();
        if (rotas) {
            const lado = new T.Vector3(); for (let i = 0; i < 8; i++) if (c.rotas & (1 << i)) { const an = i * Math.PI / 4 + .18; lado.x += Math.sin(an); lado.z += Math.cos(an); }
            lado.normalize().applyAxisAngle(ARRIBA, c.rumbo);
            const cae = Math.min(.18, .06 * rotas) * (1 + .5 * Math.max(0, Math.sin(c.fase)));
            raiz.y -= cae; raiz.addScaledVector(lado, .12 * rotas);
            c.raiz.addScaledVector(lado, .08 * rotas * dt);   // deriva de la trayectoria hacia el lado roto
            giro.premultiply(new T.Quaternion().setFromAxisAngle(ARRIBA.clone().cross(lado).normalize(), .12 * rotas));
        }
        this.fk(c, raiz, giro);
        if (c.mordida) {
            const m = c.mordida; m.t += dt; const w = Math.sin(Math.PI * Math.min(1, m.t / m.dur));   // 1 a mitad: el impacto
            if (m.t >= m.dur) c.mordida = null; else this.ikBoca(c, raiz, giro, m.p, w);
        }
    }

    /** Cinemática directa desde la raíz: cada parte gira con la rotación acumulada de sus juntas (ay, az). */
    private fk(c: Criatura, raiz: T.Vector3, giro: T.Quaternion): void {
        const acum: T.Quaternion[] = [], pivote: T.Vector3[] = [];
        c.partes.forEach((p, i) => {
            const d = p.def, o = c.proc[i];
            if (d.padre < 0) { acum[i] = giro.clone(); o.p.copy(p.local).applyQuaternion(giro).add(raiz); o.q.copy(giro).multiply(p.localQ); pivote[i] = raiz; return; }
            const h = Math.hypot(p.ay, p.az);
            const rl = h < 1e-6 ? new T.Quaternion() : new T.Quaternion().setFromAxisAngle(p.ejePlano.clone().multiplyScalar(p.ay).addScaledVector(p.ejeNormal, p.az).normalize(), h);
            // La junta está en d.a; el padre la lleva consigo (su punto en el mundo sale de su propia transformación).
            const qp = acum[d.padre], pp = c.partes[d.padre];
            const ja = d.padre === 0 && c.tipo === 'arana' ? d.a.clone().sub(pp.local).applyQuaternion(qp).add(c.proc[0].p)
                : pp.def.b.clone().sub(pp.local).applyQuaternion(qp).add(c.proc[d.padre].p);
            const q = qp.clone().multiply(rl); acum[i] = q;
            o.p.copy(p.local).sub(d.a).applyQuaternion(q).add(ja); o.q.copy(q).multiply(p.localQ);
        });
    }

    private bocaDe(c: Criatura, pz: PoseParte[]): T.Vector3 {
        if (c.tipo === 'arana') return new T.Vector3(0, 0, .55).applyQuaternion(pz[0].q).add(pz[0].p);
        const d = c.partes[15].def; return new T.Vector3(0, d.a.distanceTo(d.b) / 2 + d.r, 0).applyQuaternion(pz[15].q).add(pz[15].p);
    }

    /** IK de la mordida, mezclada por w (1 = la boca toca el blanco). Araña: el cuerpo se lanza (las patas lo siguen
     *  rígidas). Gusano: CCD sobre las juntas 8..15 (longitudes intactas) y, si no llega, embestida de la raíz. */
    private ikBoca(c: Criatura, raiz: T.Vector3, giro: T.Quaternion, blanco: T.Vector3, w: number): void {
        if (c.tipo === 'arana') {
            const off = blanco.clone().sub(this.bocaDe(c, c.proc)).multiplyScalar(w);
            for (const o of c.proc) o.p.add(off); return;
        }
        const pts = c.partes.map((p, i) => p.def.a.clone().sub(p.local).applyQuaternion(c.proc[i].q.clone().multiply(p.localQ.clone().invert())).add(c.proc[i].p));
        const punta = () => this.bocaDe(c, c.proc);
        // Embestida: lo que falte en horizontal más allá del alcance lo pone la raíz.
        const alcance = pts[8].distanceTo(punta()) * .95, falta = Math.max(0, pts[8].distanceTo(blanco) - alcance);
        if (falta > 0) { const h = blanco.clone().sub(pts[8]).setY(0).normalize().multiplyScalar(falta); for (const o of c.proc) o.p.add(h); }
        for (let it = 0; it < 12; it++) for (let j = 15; j >= 8; j--) {
            const pj = c.partes[j].def.a.clone().sub(c.partes[j].local).applyQuaternion(c.proc[j].q.clone().multiply(c.partes[j].localQ.clone().invert())).add(c.proc[j].p);
            const a = punta().sub(pj).normalize(), b = blanco.clone().sub(pj).normalize();
            const r = new T.Quaternion().setFromUnitVectors(a, b);
            for (let k = j; k < 16; k++) { c.proc[k].p.sub(pj).applyQuaternion(r).add(pj); c.proc[k].q.premultiply(r); }
        }
        void pts; void raiz; void giro;
        // Mezcla por w con la pose sin IK (la IK es la meta del cuadro de impacto).
        if (w < 1) {
            const sin = nuevaPose(16); const guard = c.proc; c.proc = sin; this.fk(c, raiz, giro); c.proc = guard;
            for (let i = 0; i < 16; i++) { c.proc[i].p.lerpVectors(sin[i].p, c.proc[i].p, w); c.proc[i].q.copy(sin[i].q).slerp(c.proc[i].q, w); }
        }
    }

    // ── física ──────────────────────────────────────────────────────────────────────────────────────────────────────
    private masCercana(c: Criatura, pt: T.Vector3): number {
        let k = 0, best = Infinity;
        c.proc.forEach((o, i) => { const d = o.p.distanceToSquared(pt); if (d < best) { best = d; k = i; } });
        return k;
    }

    private motores(c: Criatura, dt: number): void {
        const J = this.J;
        if (c.estado === 'muriendo') {
            c.reloj += dt; const f = Math.max(0, 1 - c.reloj / FUNDIDO_MUERTE);
            for (const p of c.partes) {
                p.aut = Math.min(p.aut, f);
                if (p.junta) { this.limiteTorque(p); if (f === 0 && p.junta.GetSwingMotorState() !== J.EMotorState_Off) { p.junta.SetSwingMotorState(J.EMotorState_Off); p.junta.SetTwistMotorState(J.EMotorState_Off); } }
            }
            if (c.reloj > SEG_CADAVER) { c.estado = 'cadaver'; this.congelar(c); }
            return;
        }
        if (c.mano) { this.rv.Set(c.mano.p.x, c.mano.p.y, c.mano.p.z); this.qj.Set(0, 0, 0, 1); this.bi.MoveKinematic(c.mano.body.GetID(), this.rv, this.qj, dt); }
        else {
            // Vuelta a la procedural: la física manda hasta VUELTA[0] y se funde a 0 hasta VUELTA[1] (smoothstep, sin saltos).
            c.tGolpe += dt; const e = Math.max(0, c.tGolpe - c.retener), f = 1 - suave(VUELTA[0], VUELTA[1], e);
            for (const p of c.partes) { p.fis = p.pico * f; p.aut = Math.min(1, p.aut + dt / VUELTA[1]); }
        }
        for (const p of c.partes) {
            if (!p.junta) continue;
            this.limiteTorque(p);
            const h = Math.hypot(p.ay, p.az);
            if (h < 1e-5) this.qj.Set(0, 0, 0, 1); else { const s = Math.sin(h / 2) / h; this.qj.Set(0, p.ay * s, p.az * s, Math.cos(h / 2)); }
            p.junta.SetTargetOrientationCS(this.qj);
        }
        // Raíz: PD hacia la pose procedural del cuerpo, con su autoridad (el golpe la suelta y vuelve).
        const r = c.partes[0], a = r.aut; if (a <= .01 || c.mano) return;
        const tp = c.proc[0].p, tq = c.proc[0].q.clone();
        const pos = r.body.GetPosition(), q = r.body.GetRotation(), lv = r.body.GetLinearVelocity(), av = r.body.GetAngularVelocity();
        const k = 14, g = Math.min(1, a * a * a * .25);
        const vx = (tp.x - pos.GetX()) * k, vy = (tp.y - pos.GetY()) * k, vz = (tp.z - pos.GetZ()) * k;
        const cq = new T.Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
        const e = tq.multiply(cq.invert()); if (e.w < 0) { e.x = -e.x; e.y = -e.y; e.z = -e.z; e.w = -e.w; }
        const ang = 2 * Math.acos(Math.min(1, e.w)), sn = Math.sqrt(Math.max(1e-9, 1 - e.w * e.w)), w = ang * k * .6 / sn;
        this.v.Set(lv.GetX() + (vx - lv.GetX()) * g, lv.GetY() + (vy - lv.GetY()) * g, lv.GetZ() + (vz - lv.GetZ()) * g);
        this.v2.Set(av.GetX() + (e.x * w - av.GetX()) * g, av.GetY() + (e.y * w - av.GetY()) * g, av.GetZ() + (e.z * w - av.GetZ()) * g);
        this.bi.SetLinearAndAngularVelocity(r.id, this.v, this.v2);
    }

    private contarBits(n: number): number { let k = 0; while (n) { k += n & 1; n >>= 1; } return k; }

    private limiteTorque(p: Parte): void {
        const t = p.torque * p.aut * p.aut;
        for (const m of [p.junta!.GetSwingMotorSettings(), p.junta!.GetTwistMotorSettings()]) { m.mMaxTorqueLimit = t; m.mMinTorqueLimit = -t; }
    }

    private dormir(c: Criatura): void {
        const J = this.J;
        for (const p of c.partes) { this.bi.SetObjectLayer(p.id, CAPA_DORMIDA); this.bi.SetMotionType(p.id, J.EMotionType_Kinematic, J.EActivation_DontActivate); this.bi.DeactivateBody(p.id); if (p.junta) p.junta.SetEnabled(false); p.fis = p.pico = 0; }
        c.estado = 'dormida';
    }

    private congelar(c: Criatura): void {
        const J = this.J;
        for (const p of c.partes) { this.bi.SetObjectLayer(p.id, CAPA_DORMIDA); this.bi.SetMotionType(p.id, J.EMotionType_Kinematic, J.EActivation_DontActivate); this.bi.DeactivateBody(p.id); if (p.junta) p.junta.SetEnabled(false); }
    }

    /** Despierta en la pose procedural de este cuadro (la física arranca donde está la animación: sin salto). */
    private despertar(c: Criatura): void {
        const J = this.J; this.v.Set(0, 0, 0);
        c.partes.forEach((p, i) => {
            const o = c.proc[i]; this.rv.Set(o.p.x, o.p.y, o.p.z); this.qj.Set(o.q.x, o.q.y, o.q.z, o.q.w);
            this.bi.SetPositionRotationAndVelocity(p.id, this.rv, this.qj, this.v, this.v);
            this.bi.SetMotionType(p.id, J.EMotionType_Dynamic, J.EActivation_Activate); this.bi.SetObjectLayer(p.id, CAPA_MOVIL);
            if (p.junta) { p.junta.SetEnabled(true); p.junta.SetSwingMotorState(J.EMotorState_Position); p.junta.SetTwistMotorState(J.EMotorState_Position); }
            p.aut = 1; p.fis = p.pico = 0; const mp = p.body.GetMotionProperties(); mp.SetLinearDamping(.1); mp.SetAngularDamping(.3);
            p.junta?.SetMaxFrictionTorque(c.tipo === 'arana' ? .3 : 1);
        });
        c.estado = 'activa'; c.retener = 0; c.tGolpe = 0;
    }

    /** Reaparece (banco del frenesí): viva, entera y procedural. */
    revivir(id: string, x: number, z: number, rumbo = 0): void {
        const c = this.crs.get(id); if (!c) return; c.raiz.set(x, 0, z); c.rumbo = rumbo; c.ultimoGolpe = -99; c.rotas = 0; c.mordida = null;
        this.procedural(c, 0); this.dormir(c); if (!this.lod) this.despertar(c);
    }
}
