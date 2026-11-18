# Estado del arte (M0, 16/11/2026)

Sendell no encontró ningún proyecto three.js que junte golpe al blanco, contacto 3D, cuerpo activo y pies clavados. Esa
combinación es la que podemos hacer primero. Estas son las piezas sueltas que hay. La licencia se comprobó en cada
repositorio (API de GitHub, `license`) **antes** de abrir el código. En M0 no se abrió el código de ninguna.

| Pieza | Licencia (comprobada) | Qué tomamos | Qué no |
|---|---|---|---|
| sketchpunklabs/ossos · npm `@vinxi/ossos` 0.0.3 | MIT (repo y npm) | Referencia y, si encaja, código con su aviso MIT para `ik/` (solvers de dos huesos y de cadena, IK procedural sobre three.js). Va primero en M1. | No dependemos del paquete npm 0.0.3, que está casi abandonado: copiamos y adaptamos con atribución. |
| JoltPhysics.js (jrouwe/JoltPhysics.js, motor jrouwe/JoltPhysics) | MIT | Ya es dependencia (`jolt-physics` 1.1.1). Las demos de ragdoll cinemático y de ragdoll con motores son la base directa de `fisica/` en M4: ragdoll con motores que persiguen la pose. | Nada que evitar. Antes de M4 hay que medir el tamaño del WASM en el AAB. |
| sweriko/ai4anim-webgpu | **CC BY-NC 4.0 (no comercial)** | Solo ideas: motion matching neuronal en el navegador sobre WebGPU. | **Nada de código, ni pesos, ni datos.** No se abre el código. |
| sebastianstarke/AI4Animation | Sin licencia en el repo (todos los derechos reservados) | Solo ideas de los artículos (fases, MANN). | Nada de código ni de datos entrenados. |
| jsantell/THREE.IK | MIT | Referencia vieja de FABRIK con restricciones. | No lo usamos como dependencia: está sin mantener y es anterior a three r1xx. |
| sneha-belkhale/procedural-ik-crawler | Sin licencia en el repo (todos los derechos reservados) | Solo la idea: patas procedurales con objetivo de paso y arco para las arañas. | Nada de código. |
| Hilo «Procedural Leg IK In Three.js + Rapier» (discourse.threejs.org) | Contenido del foro, sin licencia de código explícita | La técnica de paso procedural para arañas, con raycast al suelo. | No se pega código del hilo. Se reescribe para Jolt. |
| cinevva.com, «When an animation has to touch the world» (13/09/2026) | Artículo, con derechos de autor | Ideas para `contacto/` y `warping/`: el contacto con el mundo como restricción. | Nada de texto ni de código. **En M0 no se leyó**: queda pendiente leerlo al diseñar M1 y M3. |

Regla: solo MIT, Apache-2.0 o CC0 entran como código (README). Todo lo NC o sin licencia queda solo como idea.

## Lo que se rescata (Sendell, 17/11/2026)

**De ai4anim-webgpu (CC BY-NC: solo ideas, sin código):**
- Actualizar todos los agentes por lotes en un solo paso, con malla instanciada, para las hordas. Es la meta del LOD de animación de las arañas.
- Separar la capa de objetivo (adónde quiero ir y mirar) de la capa de pose (cómo se mueve el cuerpo).

**De Cinevva, «When an animation has to touch the world» (sin código; ideas aplicadas en `pies/` e `ik/` desde M2):**
- El ancla del pie se guarda en coordenadas LOCALES del soporte (plataforma, cuerpo, ascensor), no del mundo. → `pies/` `soporte`.
- La altura de la pelvis se acota al alcance de TODAS las piernas apoyadas, y el suavizado va dentro de ese rango. → `pies/` `acotarPelvis`.
- Un plano de apoyo por pie: la punta del tarso más la normal del suelo. → `pies/` `PlanoApoyo`.
- Se predice dónde aterriza el pie un paso antes. → `pies/` `prediccion`.
- El efector es la PUNTA del arma o de la garra, con un offset fijo. → `ik/` `puntaEfector`.
- Antes del golpe se avisa «fuera de alcance». → `ik/` `alcanza`.
- Se mide el drift del pie en el mundo durante el apoyo. → `pies/` `driftCm` y el banco de `/comparar`.
