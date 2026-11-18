# qdt-motion · Plan para que el combate de Q.D.T. sea físico, preciso y único

Pedido de Daniel, 16/11/2026: atacar a fondo las tres causas de que las animaciones se vean mal, sacarle el máximo al stack
(three.js, Capacitor, Electron, Jolt WASM) y probarlo en el juego **sin romper el frenesí de la pelea**.

Base: los informes de investigación A–E y la auditoría F0 (internos), y lo que F1 ya demostró dentro del juego: el zarpazo toca a 5 cm y los pies quedan a 0 cm.

## Las tres causas y su respuesta

| Causa | Respuesta | Módulo |
|---|---|---|
| **1. Los movimientos no saben a quién golpean.** Cada clip es una grabación fija. | **Golpe consciente del blanco:** se elige la variante por la altura, el tamaño y el ángulo del blanco. Después, *motion warping*: la raíz avanza y gira lo justo y la cadena del brazo o la pierna llega por IK a un punto real del cuerpo del blanco **en el cuadro de impacto**. | `apuntado/`, `warping/`, `ik/` |
| **2. El juego vive en 2D.** Círculos en el suelo y daño por temporizador. | **Híbrido 2D + 3D:** la navegación y el movimiento siguen en el plano, que funciona y es barato, y **el combate pasa a 3D**. Cápsulas de golpe por hueso que barren entre cuadros, cápsulas de daño por parte del cuerpo, y eventos de contacto con punto, normal y velocidad. El daño, la pausa, las chispas y el sonido salen de ese contacto. | `contacto/` |
| **3. Esqueletos simples.** Sin dedos, sin giro de muñeca y sin cuerpo físico. | **Esqueleto H2** (unos 56 huesos, compatible con los 18 nombres de hoy y con UE5 Mannequin y VRM) más **cuerpo físico activo en Jolt**: cada hueso grande tiene un cuerpo rígido con motores que persiguen la pose animada. Al golpe, cede donde recibe el impacto y se recupera; al morir, cae de verdad. | `esqueleto/`, `fisica/` |

## La pila de animación (en orden, cada cuadro)

1. **Base:** el clip, de la biblioteca propia, CC0 o Kimodo, con mezcla e inercialización.
2. **Capas aditivas:** respirar, mirar (cuello y ojos al punto de interés), inclinarse hacia el blanco, encogerse al recibir un golpe y cojear si hay herida. Cada capa con su máscara por hueso.
3. **Warping:** la raíz y la orientación se ajustan dentro de la ventana de anticipación, con topes de distancia y de grados por segundo.
4. **IK:** dos huesos con polo para brazos y piernas, cadenas FABRIK para patas de criatura y para el cuarto brazo de las hormigas, y dedos por pose de agarre.
5. **Pies clavados:** bloqueo de Daniel Holden (MIT) y ajuste de zancada a la velocidad real.
6. **Física:** Jolt mezcla la pose animada con el cuerpo activo (autoridad por hueso, de 0 a 1).
7. **Contacto:** barrido de cápsulas que emite los eventos que consume el juego.

Todo con **LOD de animación**: los dedos, la IK fina y la física completa solo cerca de la cámara, y lo de lejos más barato.

## Lo que nos haría únicos

- **Cada golpe es una coreografía en pareja en tiempo real**, como hoy el parry, pero para todos los golpes.
- **Todas las especies con cuerpo activo:** humanos, hormigas, arañas, gusanos y robots.
- **Las heridas cambian cómo se mueve el cuerpo:** pata rota, brazo colgando, cojera.
- **Agarres y remates como articulaciones físicas de verdad.**
- **Repetición exacta** de la pelea para la cámara de seguridad y las cinemáticas.
- **Todo en el navegador y en el móvil.**

## Cuidar el frenesí (regla de oro)

Nada de esto puede hacer la pelea más lenta ni menos responsiva. Por eso se hace en dos capas:

1. **Verdad visual, sin cambiar las reglas del juego.**
   - El golpe sigue contando con el mismo cono y el mismo tiempo de hoy.
   - Lo único que cambia es que la animación se deforma para que **se vea** el contacto.
   - Riesgo de jugabilidad: cero. Es lo que ya hizo F1 con el zarpazo.
2. **Verdad física, que sí cambia reglas.**
   - El daño sale del contacto real, con red de seguridad: si no hay contacto en la ventana, cuenta el cono de siempre.
   - Va detrás de su propia bandera.
   - Solo entra si el banco del frenesí sale igual o mejor.

**Banco del frenesí** (escena fija con 20 arañas y 5 gusanos, combo continuo, igual antes y después):
- **Coste por cuadro:** p95 de animación + física ≤ 4 ms en el PC, y ≤ 8 ms medido en un teléfono real.
- **Latencia:** del botón al impacto, igual o menor que hoy.
- **Golpes por minuto:** igual o mayor.
- **Combos sin cortes:** porcentaje igual o mayor.
- **Pausas de impacto:** con tope acumulado (no más de 150 ms de pausa por segundo de combate), menos pausa en cada golpe de un combo y solo en los dos actores.
- **Cancelaciones y ventanas de entrada:** idénticas.

## Cómo se organiza el código

- **Este repositorio** es un **paquete TypeScript** (three.js + jolt-physics) con los módulos de arriba, un **laboratorio** propio (página con escena, deslizadores y medidas) y el **banco** (las metas de F0/F1 y las del frenesí, sin ventana).
- **El juego lo importa** detrás de una bandera propia. Lo que F1 ya hizo dentro del juego se mueve aquí poco a poco, para no tener dos copias.
- **Ningún cambio llega a lo publicado sin el sí de Daniel.** Se prueba en el canal lab.

## La página de comparación (privada, para Daniel)

- **Dónde:** una ruta privada del laboratorio del juego (no se incluye en este repositorio).
- **Qué muestra:** por personaje y acción, tres columnas que se reproducen juntas.
  - **Hoy:** el clip actual.
  - **Biblioteca:** el clip CC0 o de Kimodo equivalente, retargeteado. Por ejemplo, el dash de Proyecto Y frente a la esquiva lateral CC0, o los golpes recibidos de la biblioteca frente a los de hoy.
  - **Biblioteca + pila:** con IK, pies clavados y capas.
- **Medidas debajo de cada columna:** deslizamiento, contacto y tiempos.
- **Voto:** cada fila tiene un botón «me quedo con esta», que se guarda para que el agente aplique la elección en la siguiente ronda.
- **Solo reemplazos lógicos:** el agente propone la equivalencia y Daniel la vota.

## Fases (cada una medida antes y después en el banco)

| Fase | Qué | Lo que Daniel ve |
|---|---|---|
| M0 | Repositorio, banco del frenesí, página de comparación con los clips de hoy contra la biblioteca CC0 | La comparación para votar |
| M1 | Golpe consciente del blanco y warping para todos los golpes básicos de A, Y y Lars contra cada tamaño de criatura (verdad visual) | Todos los golpes tocan, sin cambiar la pelea |
| M2 | Capas aditivas (mirar, inclinarse, respirar, encogerse) y pies clavados en todos los actores | Personajes más vivos |
| M3 | Contacto 3D por cápsulas, que emite eventos y sustituye las chispas y la pausa por temporizador | Chispas, pausa y sonido donde se toca |
| M4 | Jolt: cuerpo activo en arañas y gusanos primero (lo más visible), luego en humanoides; muertes con física | Reacciones según dónde pegas |
| M5 | Esqueleto H2 con dedos en A, Y y Lars; agarres; Kimodo para los clips que falten | Manos y agarres creíbles |
| M6 | Heridas que cambian el movimiento y repetición exacta | Lo único |
| M7 | Verdad física (daño por contacto) detrás de su bandera, solo si el banco del frenesí lo aguanta | Decisión de Daniel tras jugarlo |

## Lo no verificado

- El rendimiento en un teléfono real, que nunca se ha medido.
- El tamaño de Jolt en el AAB (~1-2 MB, según el informe C).
- Kimodo en la RTX 3070 con fijación de mano y pies: necesita un puente de 1–2 días.
