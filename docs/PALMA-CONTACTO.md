# Contacto de palma (`src/contacto/palma.ts`) · r850, 17/11/2026

Una mano que se apoya **en** la superficie de cualquier cuerpo
(una araña, un gusano, una criatura de 5,5 u o un cuerpo desconocido) sin atravesarlo ni quedarse lejos.
El juego usa una copia de este módulo (la fuente manda: se cambia aquí y se copia).

## Estado del arte (una pasada, al diseñar)

| Trabajo | Qué dice | Qué tomamos |
|---|---|---|
| Ho, Komura y Tai 2010, *Spatial Relationship Preserving Character Motion Adaptation* (malla de interacción) | La relación entre dos cuerpos se conserva si se codifica en la geometría de los dos, no en el mundo. | El contacto vive en el **marco local del hueso** que lo lleva (la cabeza): si la criatura tiembla, se inclina o se eleva, el punto la sigue. |
| Villegas et al. 2021, *Contact-Aware Retargeting of Skinned Motion* | Contactos definidos sobre la **superficie de la malla con piel**, no sobre el esqueleto; penalización de interpenetración. | El punto sale de la malla del cuadro (raycast a la `SkinnedMesh` con sus huesos) con su normal; la medida es la misma geometría. |
| Witkin y Popović 1995 (*motion warping*); Unreal Motion Warping | Deformar la raíz para que el clip llegue a un blanco. | El warp de la raíz hasta la distancia a la que llega el brazo, con smootherstep (sin tirón). El `v2Warp` del director cierra lo que falte. |
| Starke et al. 2019 (*Neural State Machine*), Zhang et al. 2021 (*ManipNet*) | Síntesis de interacción consciente de la geometría (sensores de volumen, distancias mano–objeto). | Solo la idea de sensar la forma real del otro en tiempo de ejecución. Sin red, sin datos. |

## Lo que mejoramos (lo nuevo)

1. **Ancla por lo que el cuerpo trae, en cascada:** `socket_mouth` → `mouth` → `socket_head` → `head` → una pista del juego (el ojo
   dominante de la araña, la boca del gusano) → la caja (arriba y al frente). Funciona con un cuerpo que nunca vimos.
2. **Cruce de entrada más cercano al ancla** a lo largo de la mirada, no el primer impacto: una pata delante de la cara no gana.
   Solo cuentan las caras que miran a quien toca.
3. **Servo de contacto en lazo cerrado:** el IK mueve la punta de la mano, pero lo que importa es la **palma**. Cada cuadro el
   objetivo se corrige con la palma que se **vio** el cuadro anterior (ganancia 0,55, tope 0,45 u). La orientación de la mano, el
   clip, el warp y el clamp al suelo quedan dentro del lazo; nada de eso hay que modelarlo.
4. **Ajuste de altura con el compañero:** si la cara cae fuera de la banda cómoda del brazo (de −0,72 a +0,42 brazos desde el
   hombro), la criatura se eleva (la corriente la levanta) o inclina la cabeza (pitch resuelto por bisección), y Y se inclina.
5. **La medida es la misma pieza:** distancia firmada palma–superficie por raycast a lo largo de la normal, en la ventana de contacto.

## Coste

Un raycast al cuerpo cada 3 cuadros (re-proyección) y otro cada 2 en la ventana de contacto (medida). La lista de mallas se arma
una vez. Sin reservas por cuadro. Solo dentro de la escena de parry (el mundo está en pausa).

## Medido (banco del mapa, una pasada sobre lab-r850)

Las cifras están en las notas internas del juego (no incluidas).

## Para Unreal

- El ancla y la proyección: `USkeletalMeshComponent::GetSocketLocation` + `LineTraceSingle` con `bTraceComplex` contra el
  Physics Asset o la malla (con `bReturnFaceIndex` y la normal); el punto en el espacio del hueso con `GetBoneTransform`.
- El warp: Motion Warping (`UMotionWarpingComponent`, `Skew Warp`) con el blanco = el punto menos el alcance del brazo.
- El servo: Control Rig, nodo de *Full Body IK* o `Two Bone IK` con el efector en la palma (un socket `palm_R`), más la corrección
  del cuadro anterior como variable del rig.
