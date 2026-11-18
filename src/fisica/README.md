# fisica — cuerpo activo en Jolt (M4)

Decisión de Daniel (17/11): **la marcha es 100 % la procedural**; Jolt (jolt-physics 1.1.1, MIT) entra solo a demanda.
Cada parte tiene una autoridad física `fis` 0..1 que mezcla la pose de salida entre la procedural (0) y la de Jolt (1):

| Suceso | Qué hace |
|---|---|
| Golpe de un jugable (`hit`) | despierta la criatura en su pose procedural, impulso EN el punto de contacto; las patas del lado golpeado ceden (motores flojos + su parte del impulso). `fis` = 1 hasta 0,1 s y se funde a 0 hasta 0,55 s (smoothstep); los motores persiguen la procedural todo el rato, así que no hay salto. Luego duerme. |
| Muerte (`kill`) | física completa; motores → 0 en 0,35 s; cadáver congelado a los 4 s |
| Agarre y lanzamiento | física completa mientras dure y 0,7 s de vuelo tras soltar; si sigue viva, vuelta a la procedural |
| Mordida | IK sobre la pose procedural (cuerpo de la araña / CCD en el cuello del gusano), sin física |
| Pata rota | la marcha procedural cojea (esa pata casi quieta y recogida, el cuerpo baja y se inclina, cadencia irregular, deriva), sin física |

Solo están despiertas en Jolt las golpeadas, muertas o agarradas; las demás no le cuestan nada. Aún **no está en el
juego**: se prueba en `lab/jolt/` (`npx vite --config lab/jolt/vite.config.ts`).

## API (lo que el juego llamará detrás de la bandera)

```ts
const fis = await MundoFisico.crear();   // { lod: false } = las 25 despiertas siempre (solo para el banco)
fis.sala(medio) | fis.caja(centro, medias)          // suelo (1 u de grosor) y paredes de la sala
fis.agregar(enemyId, 'arana' | 'gusano', x, z, rumbo)
fis.objetivo(enemyId, x, z, rumbo, fase?)           // cada cuadro: la raíz de EnemyThree (la IA manda dónde está)
fis.hit(enemyId, point, dir, impulse)               // = golpe(): el evento de contacto del ataque del jugable
fis.parry(enemyId, dir, impulso?)                   // tambaleo: empuje en el cuerpo, patas a media autoridad
fis.kill(enemyId, point?, dir?, impulse?)           // = matar(): física completa → ragdoll
fis.romperPata(enemyId, i)                          // desmembrar: la pata cae y la araña cojea
fis.morder(enemyId, puntoDelBlanco, seg?)           // la boca persigue el cuerpo del blanco durante la mordida
fis.agarrar(enemyId, punto) / fis.mano(enemyId, p) / fis.soltar(enemyId)   // agarre con PointConstraint y lanzamiento
fis.paso(dt) → ms                                   // procedural de todas + motores + Step (solo si hay despiertas)
fis.pose(enemyId, out) → [{p, q}]                   // pose de salida (procedural ⊕ Jolt por fis) para la piel
fis.poseProcedural(id) / fis.poseFisica(id) / fis.fisica(id)   // para medir
fis.boca(enemyId), fis.velocidad(enemyId, i), fis.estado(enemyId), fis.quitar(enemyId)
```

**Lo que el juego tiene que dar:** la raíz de cada criatura por cuadro (`objetivo`), el punto/dirección/impulso real
de cada impacto (hoy `takeDamage` solo lleva daño), las cajas de las paredes de la
sala, y llamar `paso` una vez por cuadro de lógica (durante el hit-stop no se da paso).

## Cómo encaja con CreatureModel (creature-presentation.ts)

| Física (`pose()[k]`) | CreatureModel |
|---|---|
| Araña k = 0 (caja .5×.2×.5 en y .58) | `parts[0]` cuerpo (esfera .58×.25×.58) |
| Araña k = 1 + 3i + s (s = 0 muslo, 1 tibia, 2 garra) | `segments[3i + s]` (upper, lower, claw de `legs(i)`) |
| Junta muslo–tibia / tibia–garra de la pata i | `parts[1 + 2i]` rodilla / `parts[2 + 2i]` pie |
| Gusano k = 0..15 (cápsulas r .2 / .26) | `parts[k]` (y la cadena de huesos de WormSkin que los sigue) |

La piel lee `pose()`; mientras `fis` = 0 es exactamente la procedural (medido: 0 cm, 0°). En el juego, la procedural
de CreatureModel sustituirá a la de este módulo (`procedural()`), y los motores perseguirán sus ángulos. El ragdoll Verlet de `execution/bone-ragdoll.ts` y las muertes shock/dissolve siguen; esto sustituye la
parte «cae de verdad» (fall/launch) cuando la bandera está. AUDITORIA F0 #9 (dirección de la reacción): sale del
punto de impacto. #10 (el gusano estira 17 % y se hunde): juntas duras + LinearCast + suelo grueso → estira ≤ 0,5 %.

Simplificación del prototipo: el gusano se crea con la espiral abierta en línea (tubo en el suelo + cuerpo alzado);
la marcha procedural es una zancada sencilla en la cadera. En el juego, los objetivos de los motores saldrán de la
pose de CreatureModel.

Criterios de aceptación y números: `lab/jolt/CRITERIOS.md`.
