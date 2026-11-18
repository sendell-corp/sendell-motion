# M4 — criterios de aceptación (Daniel, 17/11/2026)

Esquema: la marcha es 100 % procedural y Jolt entra solo a demanda (golpe, muerte, agarre). Se mide con
`lab/jolt/criterios.ts` y el banco `lab/jolt/banco.mjs` (Chrome 157 headless, en un PC con Windows y RTX 3070, 17/11).

| # | Criterio | Meta | Medido | ¿Cumple? |
|---|---|---|---|---|
| 1 | Reacción por zona | desvío de las garras frente a la procedural, en el marco del cuerpo: lado golpeado / opuesto ≥ 2 | 50,5 / 23,7 cm → 2,13 (media de 4 orientaciones, 20 N·s) | sí |
| 2 | Pata rota → cojea (procedural) | marcha asimétrica | entera 0,94 pisadas/s, 30/30 por lado, 58 cm, deriva 0 · pata 2 rota 0,50 pisadas/s, 8/20 (lado roto/sano), 50,7 cm, deriva 18,6 cm en 8 s | sí |
| 3 | Muerte física | ragdoll entero, ≤ 2 cm dentro de suelo o pared, reposo < 4 s | 0 cm en el suelo y en la pared (la colisión va 3,5 cm por fuera de la pieza visible) · reposo: araña 0,9 s, gusano 2,9 s | sí |
| 4 | Agarre y lanzamiento | articulación física; velocidad de salida; no atraviesa | PointConstraint con mano cinemática; lanzada a 6 m/s → sale a 5,78 m/s; 0,8 cm en el suelo, pared 0 | sí |
| 5 | Mordida (IK, sin física) | distancia boca–cuerpo en el impacto ≤ 5 cm | araña 0 cm · gusano 0,7 cm | sí |
| 6 | Reposo físico = procedural | diferencia de pose ≈ 0 sin golpe | sin golpe 0 cm, 0° · tras un golpe vuelve a 0 en 0,55 s y 1 s después 0 cm, 0° · costura de la mezcla ≤ 2,6 cm/cuadro (la marcha sola mueve 3,2) | sí |

## Coste en el frenesí (20 arañas + 5 gusanos, 60 s a 60 Hz, golpe cada 0,4 s)

| | p50 | p95 | p99 | despiertas de media |
|---|---|---|---|---|
| Las 25 despiertas siempre | 9,8 ms | 11,8 ms | 13,6 ms | 25 |
| Solo las golpeadas/muertas (el esquema) | 1,3 ms | 1,9 ms | 2,4 ms | 3,8 |

El tiempo medido incluye la pose procedural de las 25 más Jolt. Meta de anim + física: p95 ≤ 4 ms.
