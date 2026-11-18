import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MundoFisico, type PoseParte } from '../../src/fisica/cuerpo-activo';
import { montarFrenesi, correrBanco } from './frenesi';
import { medirCriterios } from './criterios';

const $ = (id: string) => document.getElementById(id)!;
const qs = new URLSearchParams(location.search);

if (qs.get('banco')) {
    // Banco sin dibujo: lo corre el PC viejo en Chromium headless y lee window.__res.
    const seg = +(qs.get('s') || 60);
    $('st').textContent = 'midiendo…';
    const sin = await correrBanco(false, seg), con = await correrBanco(true, seg);
    const criterios = await medirCriterios();
    (window as any).__res = { sin, con, criterios, ua: navigator.userAgent };
    $('st').textContent = JSON.stringify((window as any).__res);
    document.title = 'BANCO-OK';
} else await lab();

async function lab() {
    const ren = new T.WebGLRenderer({ antialias: true }); ren.setPixelRatio(Math.min(2, devicePixelRatio)); ren.setSize(innerWidth, innerHeight);
    ren.shadowMap.enabled = true; document.body.appendChild(ren.domElement);
    const esc = new T.Scene(); esc.background = new T.Color(0x15171b);
    const cam = new T.PerspectiveCamera(50, innerWidth / innerHeight, .1, 200); cam.position.set(0, 6, 9);
    const ctl = new OrbitControls(cam, ren.domElement); ctl.target.set(0, .5, 0); ctl.update();
    esc.add(new T.HemisphereLight(0xffffff, 0x334, 1.2));
    const sol = new T.DirectionalLight(0xffffff, 2); sol.position.set(5, 10, 4); sol.castShadow = true; sol.shadow.camera.left = sol.shadow.camera.bottom = -12; sol.shadow.camera.right = sol.shadow.camera.top = 12; esc.add(sol);
    const suelo = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshStandardMaterial({ color: 0x2a2d33 })); suelo.rotation.x = -Math.PI / 2; suelo.receiveShadow = true; esc.add(suelo);
    esc.add(new T.GridHelper(20, 20, 0x444, 0x333));
    const matA = new T.MeshStandardMaterial({ color: 0x8a5a44, roughness: .6 }), matG = new T.MeshStandardMaterial({ color: 0xb0484a, roughness: .5 });
    const matM = new T.MeshStandardMaterial({ color: 0x555a66, roughness: .8 }), matH = new T.MeshStandardMaterial({ color: 0xff754a, emissive: 0x551100 });

    let mundo: MundoFisico; let tick: ((dt: number) => number) | null = null; let lodOn = true; let modo: 'uno' | 'fren' = 'uno';
    const vistas = new Map<string, { g: T.Group; ms: T.Mesh[]; pose: PoseParte[] }>();
    const muestras: number[] = [];

    async function montar() {
        for (const v of vistas.values()) esc.remove(v.g); vistas.clear(); muestras.length = 0;
        if (modo === 'fren') { const f = await montarFrenesi(lodOn); mundo = f.mundo; tick = f.tick; }
        else {
            mundo = await MundoFisico.crear({}); mundo.sala(10); tick = null;
            mundo.agregar('arana', 'arana', -2, 0, 0); mundo.agregar('gusano', 'gusano', 2.5, 0, 0);
        }
        for (const id of mundo.ids) {
            const g = new T.Group(); const mat = mundo.tipo(id) === 'arana' ? matA : matG;
            const ms = mundo.formas(id).map(f => {
                const geo = f.caja ? new T.BoxGeometry(f.caja.x * 2, f.caja.y * 2, f.caja.z * 2) : new T.CapsuleGeometry(f.r, f.media * 2, 4, 10);
                const m = new T.Mesh(geo, mat); m.castShadow = true; m.userData.id = id; g.add(m); return m;
            });
            esc.add(g); vistas.set(id, { g, ms, pose: [] });
        }
    }

    const ray = new T.Raycaster(), ptr = new T.Vector2(); let abajo = { x: 0, y: 0 };
    ren.domElement.addEventListener('pointerdown', e => { abajo = { x: e.clientX, y: e.clientY }; });
    ren.domElement.addEventListener('pointerup', e => {
        if (Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) > 5) return;   // fue un arrastre de cámara
        ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, cam);
        const hit = ray.intersectObjects([...vistas.values()].flatMap(v => v.ms))[0]; if (!hit) return;
        const id = hit.object.userData.id as string, d = ray.ray.direction, imp = +($('imp') as HTMLInputElement).value;
        if (e.shiftKey) mundo.matar(id, hit.point, d, imp); else mundo.golpe(id, hit.point, d, imp);
        const marca = new T.Mesh(new T.SphereGeometry(.06), matH); marca.position.copy(hit.point); esc.add(marca); setTimeout(() => esc.remove(marca), 400);
    });
    const boton = (id: string, f: () => void) => $(id).addEventListener('click', f);
    boton('b-uno', async () => { modo = 'uno'; $('b-uno').classList.add('on'); $('b-fren').classList.remove('on'); await montar(); });
    boton('b-fren', async () => { modo = 'fren'; $('b-fren').classList.add('on'); $('b-uno').classList.remove('on'); await montar(); });
    boton('b-lod', async () => { lodOn = !lodOn; $('b-lod').classList.toggle('on', lodOn); if (modo === 'fren') await montar(); });
    boton('b-rev', () => montar());
    boton('b-pata', () => { for (const id of mundo.ids) if (mundo.tipo(id) === 'arana') mundo.romperPata(id, 2); });
    boton('b-morder', () => { for (const id of mundo.ids) { const b = mundo.boca(id); mundo.morder(id, { x: b.x, y: b.y - .1, z: b.z + .7 }, .35); } });
    boton('b-matar', () => { for (const id of mundo.ids) mundo.matar(id); });
    boton('b-parry', () => {
        let best = '', bd = Infinity; for (const id of mundo.ids) { const p = mundo.pose(id)[0].p; const d = p.length(); if (d < bd && mundo.estado(id) !== 'cadaver') { bd = d; best = id; } }
        if (best) { const p = mundo.pose(best)[0].p.clone().setY(0).normalize(); mundo.parry(best, { x: p.x, y: .2, z: p.z }); }
    });
    ($('imp') as HTMLInputElement).oninput = e => { $('impv').textContent = (e.target as HTMLInputElement).value; };

    await montar();
    let acum = 0, ult = performance.now();
    const bucle = () => {
        const ahora = performance.now(); acum = Math.min(.1, acum + (ahora - ult) / 1000); ult = ahora;
        while (acum >= 1 / 60) { muestras.push(tick ? tick(1 / 60) : mundo.paso(1 / 60, { x: 0, y: 0, z: 0 })); if (muestras.length > 600) muestras.shift(); acum -= 1 / 60; }
        for (const [id, v] of vistas) { mundo.pose(id, v.pose); v.pose.forEach((o, i) => { v.ms[i].position.copy(o.p); v.ms[i].quaternion.copy(o.q); }); }
        const s = [...muestras].sort((a, b) => a - b), q = (f: number) => (s[Math.floor(f * (s.length - 1))] ?? 0).toFixed(2);
        $('st').textContent = `física p50 ${q(.5)} ms · p95 ${q(.95)} ms · activas ${mundo.activas()}/${mundo.ids.length}`;
        ren.render(esc, cam); requestAnimationFrame(bucle);
    };
    addEventListener('resize', () => { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); ren.setSize(innerWidth, innerHeight); });
    bucle();
}
