# anymove (patch-gg/anymove): qué es y qué nos aporta

Estudio de Claude, 17/11/2026, sobre el commit `8b42c48` (12/11/2026). Clonado solo para leerlo, en el scratchpad; no se
ejecutó nada.

## Qué hace
Convierte **un video generado por IA** en una animación para **cualquier criatura riggeada**, con alas, colas y ocho patas incluidas. El truco es el método de @CanItCode:
1. **Modelo y esqueleto.** Se parte de un modelo 3D y su esqueleto. Cada extremidad se pinta de un color, para que izquierda y derecha nunca se confundan.
2. **Video con dos cámaras.** Un modelo de video (MiniMax H3 Max en fal.ai, unos 0,26 USD por 5 s) filma la criatura **desde dos cámaras en el mismo cuadro**: de frente a la izquierda y de lado a la derecha, a partir de un texto («la araña se alza y muerde»).
3. **Lector de articulaciones.** Se entrena un lector solo para esa criatura (DINOv2, 2.200 poses aleatorias renderizadas en Blender, unos 20 min de GPU). Encuentra cada articulación en las dos vistas, cuadro a cuadro.
4. **Paso a 3D.** Una articulación está a la misma altura en las dos vistas, así que el par la fija en 3D: el frente da el lado a lado y el perfil, de la nariz a la cola.
5. **Ajuste del rig.** El rig se ajusta a esos puntos, ignora los desvíos y exporta un **GLB a 24 fps**, con bucles y root motion.

## Lo que mide de verdad (su README)
- **Spider gigante** (8 patas): error del lector de 2,9 / 3,6 px. Acuerdo entre vistas: alzarse 0,99, morder 0,96 y saltar 0,89.
- **Costes:** unos **3 USD por movimiento usable** (hacen falta unos 7 clips por movimiento; pasa el 58 %) y **unos 17 USD por criatura nueva** con 5 movimientos.
- **Pies:** patinan **1–2 cm por paso**; ellos no los clavan, y nuestro bloqueo de pies sí.

## Lo que no sirve (lo dicen ellos)
- **Caminar con 8 patas:** las vistas no coinciden en qué patas están arriba. Encaja con lo que eligió Daniel: la marcha de la araña sigue siendo nuestra, procedural.
- Tumbarse, alas de ave, latigazos de cola y carreras rápidas.
- **Una animación solo vale para la criatura para la que se hizo:** cada modelo necesita su propio lector.
- Sus mallas pesan 55-60 k triángulos con texturas 4K. **No aplica a nosotros:** usaríamos nuestros modelos.

## Requisitos y licencias
- **Código:** Apache-2.0, apto para uso comercial.
- **Video:** MiniMax H3 tiene una *community licence* propia y el uso por fal.ai pasa por los términos de fal. **Hay que leer las dos antes de vender lo que salga.** Su README avisa de que lo generado no hereda automáticamente ninguna licencia.
- **GPU para entrenar el lector:** unos 12 GB con batch 20. **Nuestra RTX 3070 tiene 8 GB.** `mocap/train.py` acepta el batch como argumento, así que con batch 8-10 probablemente cabe (más lento); está sin probar. Leer y ajustar piden mucho menos. La alternativa es alquilar una H100 (unos 10 min por criatura).
- **Herramientas:** Blender 5.x, Python 3.11 y una cuenta de **fal.ai** con saldo (decisión y pago de Daniel).
- **Agentes:** es un **plugin de Claude Code** con 7 skills (rig, film, reader, capture, pack, lora). Un agente puede llevarlo de punta a punta, con sus controles de calidad.

## Qué nos aporta (y qué no)
**Nos aporta lo que ninguna biblioteca tiene: gestos grandes para criaturas que no son humanas.**
- **Araña y araña madre:** alzarse, morder, abalanzarse y amenazar. Hoy son procedurales o no existen.
- **Gusano:** embestida y alzarse.
- **Robots y drones:** gestos de máquina.
- **Hormigas humanoides** (médico, enfermera, guardias): «mirar hacia arriba con miedo», agarrar, encogerse. Faltaban para las cinemáticas, y el cuarto brazo sale del mismo rig.
- **Jefes y escenas únicas.**

**No sustituye a qdt-motion:** los golpes que tocan al blanco, los pies clavados y la física siguen siendo nuestros. anymove da **el clip base** de un gesto y nuestra pila lo adapta en el juego: warping al blanco, IK de la mordida, pies y Jolt a demanda.

## Validación a detalle (17/11): qué hace falta de verdad

**No hacen falta la cuenta de pago y la tarjeta de 12 GB a la vez.** Son dos pasos distintos:

| Paso | Qué pide | ¿Lo tenemos? |
|---|---|---|
| Leer las articulaciones de un clip y ajustar el rig | GPU modesta. El ajuste corre hasta en CPU (unos 90 s el rugido del dragón) | **Sí**, la 3070 |
| Entrenar el lector de nuestra araña (una vez por criatura) | Unos 12 GB con batch 20 (por defecto 24). `train.py` usa bf16 (la 3070, Ampere, lo admite) y acepta el batch como argumento | **Probablemente sí** con batch 8-10. Sin probar |
| Renderizar 2.200 poses en Blender (Cycles con GPU) | Blender **5.x**. En el PC viejo hay 4.2 y 4.3 | Hay que instalar Blender 5.x (gratis, portable) |
| Python | 3.11. En el PC viejo hay 3.12 | venv 3.11 con uv (gratis) |
| **Fabricar videos nuevos** con dos cámaras | Un modelo de video. Ellos usan MiniMax H3 Max en fal.ai (0,26 USD el clip de 5 s, unos 7 clips por movimiento bueno) | **Es lo único que cuesta** |

**MiniMax H3 (17/11, fuentes secundarias; falta leer el LICENSE de Hugging Face).**
- Licencia comunitaria propia, no de código abierto.
- Uso comercial gratis por debajo de unos 20 M USD al año.
- Según una fuente, la licencia estándar **excluye a EE. UU., la UE, el Reino Unido y Corea** y pide un permiso aparte. No está claro si eso se refiere a dónde está quien la usa o a dónde se vende.
- Prohíbe destilar otros modelos con sus salidas, así que **no usar la LoRA**.
- En fal.ai cada modelo lleva su propia licencia, con un distintivo de «Commercial use».

**Antes de pagar hay que leer en directo** el LICENSE de MiniMax H3 en Hugging Face, la ficha del modelo en fal (que tenga el distintivo comercial) y los términos de fal.

**Otras fuentes de video:**
- **El método no depende de MiniMax:** sirve cualquier modelo que mantenga las dos vistas sincronizadas. A ellos Seedance 2.5 les desincronizó un trote.
- **Una suscripción de video que Daniel ya pague** se podría probar con el mismo cuadro de referencia de dos vistas (`tools/compose_ref.py`), revisando sus términos.
- **Correr H3 en local no es viable:** son 33 B de parámetros.

**Encaje con nuestro rig.** Su `build_rig.py` construye su propio esqueleto desde `rig.json`. Para que la salida pase 1:1 a nuestra araña, `rig.json` debe usar los nombres y las posiciones de nuestros huesos; si no, hay que retargetear después. Eso se comprueba en la fase 1.

**Plan de validación por coste:**
- **Fase 0 (0 USD):** en el PC viejo, venv 3.11, torch cu128, requisitos y Blender 5.x portable. Correr su ejemplo, el rugido del dragón con su lector y su clip, hasta sacar el GLB. Prueba que leer y ajustar funcionan en nuestra máquina.
- **Fase 1 (0 USD):** nuestra araña.
  - `prep` y un `rig.json` con nuestros huesos;
  - el dataset de 2.200 poses;
  - entrenar el lector con batch 8-10 en la 3070, midiendo la memoria de video y su examen en cm.
  Responde a la pregunta de la tarjeta sin gastar.
- **Fase 2 (con el sí de Daniel):** clips de video. Primero las licencias; luego unos 10-20 USD en fal, o la suscripción que ya tenga si sus términos lo permiten.
- **Fase 3:** captura, GLB, clip en nuestra araña, y medición en el banco y en /comparar.

## La variante «nuestra», con pocas dependencias de terceros (idea del 17/11, por verificar)

anymove tiene tres piezas. Solo una es de terceros y de pago:
1. **El video con dos vistas** (MiniMax en fal): de pago y con licencia dudosa.
2. **El lector de articulaciones:** DINOv2 (Apache-2.0) entrenado en local con renders de Blender. Es nuestro.
3. **La triangulación con dos vistas y el ajuste del rig:** código Apache-2.0, todo local.

Cómo cambiar la pieza 1:
- **Humanoides (A, Y, Lars, médicos):** **dos teléfonos**, uno de frente y otro de lado, o uno solo con un espejo a 90°. Daniel hace el gesto una vez. El lector puede ser **MediaPipe Pose** (Apache-2.0; está por verificar que el modelo de pose sea comercial), sin entrenar nada, más la misma triangulación y nuestro retarget. Es captura de movimiento casera y gratis. A diferencia de los modelos que descartamos (GVHMR, WHAM: SMPL no comercial), aquí no hay modelo de cuerpo con licencia.
- **Criaturas (araña, gusano, robots):** un **modelo de video abierto que corra en local**.
  - Wan 2.x (Apache-2.0): hay versiones pequeñas que corren con unos 8 GB.
  - LTX-Video, que tiene licencia propia.

  Se le pasa el mismo cuadro de referencia de dos vistas. **Por verificar:** la licencia exacta, la memoria en la 3070 en modo imagen a video y si mantiene las dos vistas sincronizadas. A anymove, Seedance le falló en eso; un modelo pequeño puede fallar más.
- **Gestos de criatura sin video:** el lab de qdt-motion ya hace poses con IK y física. Un agente puede componer «alzarse» o «abalanzarse» como objetivos de IK sobre la pose procedural, sin generar nada.

**Orden sugerido:**
1. Fases 0 y 1 de arriba, gratis.
2. Probar Wan local con el cuadro de dos vistas de nuestra araña, gratis.
3. Solo si eso no alcanza, fal.

Para los humanoides: un primer gesto con dos teléfonos de Daniel y MediaPipe.

## Piloto propuesto (si Daniel aprueba el gasto)
- **Criatura:** la araña de Q.D.T. (la nuestra, ya riggeada), con 3 gestos: alzarse amenazando, mordisco y abalanzarse.
- **Coste:** unos 10–20 USD de fal.ai.
- **GPU:** la 3070 del PC viejo, con batch reducido.
- **Medición:** el banco (mordida boca-cuerpo, deslizamiento, lectura) y /comparar contra lo de hoy.
- **Antes de gastar:** leer la licencia de MiniMax H3 y los términos de fal para uso comercial de lo generado.
