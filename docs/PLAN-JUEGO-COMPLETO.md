# WB3D: guía para llegar a una versión completa y jugable

Fecha de inicio: 8 de septiembre de 2026. Base revisada: proyecto web v0.8.0.

**Este documento contiene solo lo pendiente.** El trabajo ya completado (con su evidencia, commits y hallazgos) vive en [`HISTORIAL-PROGRESO.md`](HISTORIAL-PROGRESO.md) y los informes que enlaza — léelo si necesitas contexto de por qué algo está como está, pero no hace falta para saber qué sigue.

## Regla de continuidad

Actualizar este archivo al terminar cada bloque de trabajo, antes de finalizar la respuesta: mover lo completado a `HISTORIAL-PROGRESO.md` (con su commit y una frase de qué se hizo), y dejar aquí solo el estado vigente y el próximo paso reproducible. Esto permite continuar con otra sesión sin releer todo el historial.

## Estado vigente (12 de septiembre de 2026, ~13:45)

**Fase A completa. Fase B y C en curso — ver detalle abajo. D en adelante no iniciadas.** C-07 a C-10, B-07/C-11, el transporte económico de punta a punta, desastres/terreno en vivo (corrección Y rendimiento) y la conquista autónoma cerrados. **Los objetivos de rendimiento Ultra (500 y 1.500 criaturas) se cumplen de forma reproducible y con amplio margen en paz, guerra sostenida activa y desastres sostenidos activos** (p95 ≈17 ms en las tres condiciones), **producción→transporte marítimo autónomo→llegada→uso ya tiene un recorrido de punta a punta en vivo**, **terremoto/bomba/meteorito/tornado/lluvia ácida/desastre natural autónomo ya se corrieron en vivo sobre ciudades activas sin corrupción ni degradación medible**, y **la conquista autónoma quedó confirmada de punta a punta** — con un ejército del tamaño adecuado (movilizado por la función real del juego, sin tocar ningún mecanismo), la ciudad cae sola en ~2 minutos simulados; el bloqueo que B-07/C-11 había dejado sin resolver era tamaño de fuerza, no un problema estructural de la IA de asedio — ver `HISTORIAL-PROGRESO.md` para el detalle completo. **Esto no cierra Fase C ni B del todo**: solo quedan ciudades envejecidas 30-60 min real (rendimiento y corrección) — ver "Pendientes adicionales" en Fase C abajo.

**Aparte de esta guía:** el 12 de septiembre se encontró y se aceptó (sin revisión de código, a pedido del usuario) ~2 días de trabajo sin commit de otra sesión, resolviendo un problema de rendimiento real reportado por el usuario en un escenario de archipiélago con vegetación (7 FPS medidos) — no relacionado con la cadena C-07 a C-12, que usa un escenario sin árboles a propósito. Commit `3473f9d`; detalle en `HISTORIAL-PROGRESO.md` → "Trabajo paralelo ajeno a esta guía".

Validación de referencia: 199 pruebas unitarias (40 archivos), 29/29 e2e con 2 omitidas (los dos benchmarks optativos, gateados por `WB3D_BENCHMARK`/`WB3D_FOREST_BENCHMARK`), compilación aprobada. Comando: `corepack pnpm test:unit && corepack pnpm test:e2e && corepack pnpm build` (ver "Entorno" abajo para el PATH).

### Pendiente de decisión del usuario

- **Catálogo 1.0**: la propuesta de qué entra/queda fuera está en [`FASE-A-COMPARACION-WORLDBOX.md`](FASE-A-COMPARACION-WORLDBOX.md), comparada contra el changelog de WorldBox. Nadie ha confirmado esa lista todavía — Fase F no debería darse por bien delimitada sin esto.

## Objetivo y alcance

Conseguir un simulador de mundos 3D coherente, atractivo y estable: crear un mundo, poblarlo, observar civilizaciones, intervenir, guardar y continuar partidas largas sin bloqueos ni deterioro progresivo del rendimiento.

Esta guía planifica el trabajo; no certifica que el juego actual esté completo ni que sus errores estén corregidos.

Dirección propuesta: realismo estilizado, con terreno creíble, materiales naturales, personajes vestidos y animados, y edificios reconocibles. Mantener la claridad desde la vista aérea y reservar detalle para primeros planos. El realismo debe venir también del comportamiento: caminar hacia una tarea, producir, transportar, consumir, combatir y reaccionar al entorno.

La versión 1.0 tendrá un catálogo de funciones cerrado en la fase A. Inspirarse en WorldBox no implica perseguir indefinidamente todas sus actualizaciones. Cada diferencia se clasifica como función incluida, adaptación propia o ampliación posterior.

## Orden de ejecución

| Fase | Resultado | Prioridad | Depende de | Estado |
| --- | --- | --- | --- | --- |
| A | Inventario completo, alcance y escenarios reproducibles | Crítica | — | ✅ Completa |
| B | Simulación y guardado fiables; errores graves resueltos | Crítica | A | 🔶 En curso |
| C | Rendimiento Ultra medido y optimizado | Crítica | A; repetir tras B | 🔶 En curso |
| D | Terreno, biomas y agua más naturales | Alta | B y C | ⬜ No iniciada |
| E | Modelos, materiales y animación coherentes | Alta | C y D | ⬜ No iniciada |
| F | Funciones faltantes y profundidad de civilización | Alta | A, B y C | ⬜ No iniciada |
| G | Interfaz, sonido y experiencia completa | Alta | Integrar durante D–F | ⬜ No iniciada |
| H | Equilibrio, resistencia y compatibilidad | Crítica para publicar | B–G | ⬜ No iniciada |
| I | Versión 1.0 distribuible y verificada | Crítica para publicar | H | ⬜ No iniciada |

Cada fase termina con una demostración jugable, pruebas relevantes y comparación con la línea base. Una regresión de guardado, comportamiento o rendimiento bloquea su cierre.

## Fase B — Corregir la simulación y los errores existentes

Pendiente principal: los recorridos completos por sistema (no solo bugs puntuales ya corregidos, ver historial). Auditar por recorrido de punta a punta, además de por módulo:

| Sistema | Casos obligatorios | Estado |
| --- | --- | --- |
| Mundo | Generación con varias semillas, mapa plano, islas, ríos, límites del mapa; modificar terreno bajo caminos y edificios; actualizar navegación y selección. | ✅ Recorrido en vivo + cobertura de test existente — ver `HISTORIAL-PROGRESO.md` |
| Vida | Nacimiento, crecimiento, hambre, alimentación, reproducción, envejecimiento y muerte; herencia válida y ausencia de entidades o referencias huérfanas. | ⬜ Sin recorrido dedicado |
| IA y rutas | Destino inaccesible, objetivo muerto, puente terrestre destruido, puerta bloqueada, costa modificada, ruta naval interrumpida y recuperación sin bucles. | 🟡 "Destino inaccesible" corregido; el resto de casos sin recorrido explícito |
| Economía | Recurso extraído → transporte → almacén → producción → uso; impedir inventarios negativos, duplicación y consumo de recursos inexistentes. | ✅ Recorrido de punta a punta en vivo — producción, transporte marítimo autónomo, llegada, persistencia y uso — ver `HISTORIAL-PROGRESO.md` |
| Asentamientos | Fundación, expansión, parcelas, construcción, mejora, destrucción y reconstrucción; comprobar terreno, accesos y propietarios. | ⬜ Sin recorrido dedicado |
| Guerra | Reclutamiento, órdenes, daño, asedio, retirada, paz, conquista y rebelión; reconciliar unidades, edificios y relaciones. | ✅ Asedio/conquista/paz/reparación y marcha autónoma aprobados; combate sostenido de 150 s verificado sin errores (B-07/C-11); conquista como desenlace 100 % autónomo confirmada (ver historial) |
| Poderes y estados | Activación, radio, coste computacional, apilamiento, duración, inmunidades, limpieza y persistencia de cada poder. | 🟡 Desastres (terremoto/bomba/meteorito/tornado/lluvia ácida/desastre natural autónomo) con recorrido en vivo aprobado — corrección Y costo computacional bajo carga sostenida, ver historial; el resto de poderes (curar, poseer, teletransportar, clima no destructivo) sin recorrido dedicado |
| Tiempo | Pausa, velocidades disponibles, pestaña en segundo plano y reanudación sin saltos destructivos ni divergencias injustificadas. | 🟡 El bug más grave (estancamiento del reloj) corregido; pausa/pestaña en segundo plano sin recorrido sistemático |
| Guardado | Ida y vuelta con todos los sistemas activos; migraciones; archivos incompletos, versión futura, cuota agotada y recuperación de respaldo. | 🟡 Cobertura de test amplia (ver historial); recorrido manual de punta a punta sin hacer |

Proceso por error: reproducir → reducir el escenario → localizar la causa → corregir → añadir una prueba que habría fallado antes → repetir el recorrido completo. Registrar esperado, observado, gravedad, partida y resultado.

Prioridades: P0 pérdida de partidas o imposibilidad de jugar; P1 sistema central roto o bloqueo frecuente; P2 comportamiento incorrecto con alternativa; P3 defecto cosmético. Revisar entradas de nombres e importaciones para que datos inválidos o texto con etiquetas no corrompan estado ni ejecuten contenido.

**Cierre:** cero P0/P1 conocidos en los recorridos centrales; cada corrección tiene evidencia y los guardados de referencia conservan sus relaciones y contenidos.

## Fase C — Recuperar rendimiento, especialmente Ultra

**Objetivos Ultra de cuadro cumplidos en paz, guerra sostenida y desastres sostenidos (C-07 a C-10, B-07/C-11 y C-12, ver historial) — Fase C no cerrada todavía, ver "Pendientes adicionales" abajo.** Medido y perfilado de forma limpia y reproducible, primero en `mature-flat-peace` (el escenario usado desde C-03), luego con guerra activa entre los dos imperios (`WB3D_WAR=1`, combate autónomo sostenido) y luego con desastres activos (`WB3D_DISASTERS=1`, terremotos/bombas/meteoritos forzados en rotación cada 20 s sobre las 4 ciudades). Cadena de causas y arreglos: C-08 perfiló por subsistema/categoría; C-09 localizó y corrigió el costo por nodo de la búsqueda A* en `js/navigation.js` (arreglos tipados en vez de `Map`; menos llamadas redundantes a `traversalCost()`); C-10 localizó y corrigió el costo del paso AO/SSAO (`RenderSystem._patchAoVisibilityOverride()` en `js/render-system.js` — `THREE.SSAOPass` hacía dos recorridas completas de la escena por fotograma solo para ocultar los 1-2 objetos `Points` que existen en todo el juego); B-07/C-11 y C-12 confirmaron que esas optimizaciones se sostienen bajo carga de combate y de desastres real, sin arreglos adicionales necesarios (C-12 encontró un efecto menor: micro-cortes de fotograma de 100-150 ms en el instante de cada impacto grande, ~0,05 % del tiempo total — no bloquea el objetivo). Ninguno de los cambios de C-09/C-10 alteró comportamiento ni calidad visual, solo costo — verificado en cada caso con los tests relevantes antes de medir.

**Resultado final medido (mismo protocolo en las 4 rondas — GPU discreta confirmada, 3 repeticiones, 30 s de calentamiento + 120 s de muestra):**

- **500 criaturas: mediana 16,7 ms, p95 16,8-17,0 ms en paz, guerra y desastres** (objetivo ≤25 ms — cumple incluso el objetivo más estricto de "Alta", p95 ≤22 ms, estando en calidad Ultra).
- **1.500 criaturas: mediana 16,7 ms, p95 17,0 ms constante en paz; 17,0/33,3/17,0 ms con guerra activa y con desastres activos** (objetivo ≤40 ms — antes de esta sesión: 83,2-99,9 ms; la 2ª repetición cae en el mismo escalón de cuantización de fotogramas ya documentado, no una regresión).
- **Con guerra activa, bajas reales y consistentes en las 6 repeticiones (23-47)** confirman combate sostenido genuino, no una guerra declarada e inactiva — pero **ninguna ciudad cambió de dueño en los 150 s de partida de ninguna corrida**, así que la conquista como desenlace puramente autónomo (sin forzar el asedio) sigue sin confirmarse.
- **Con desastres activos, 8 desastres forzados y 44/56 casas restantes idéntico en las 6 repeticiones** confirman daño real y consistente — con un único hallazgo menor: 3 micro-cortes de fotograma (100-154 ms) por corrida en el instante de cada impacto grande, ~0,05 % del tiempo total (`droppedSeconds` 0,05-0,08 s por corrida de 150 s, la primera vez que aparece un valor distinto de cero en esta cadena de mediciones) — no bloquea el objetivo Ultra.

**Hallazgo aparte, no bloqueante pero a tener en cuenta:** a 1.500 criaturas la cola de rutas (`navigation.processQueue()`, `NAV_QUEUE_NODE_BUDGET=8000` nodos/tick, sin tocar en ninguna de estas optimizaciones) tiene una carga pendiente crónica (mediana ~3.390, p95 ~5.046 solicitudes en cola) — la demanda sostenida sigue superando el presupuesto por tick, así que una criatura individual puede tardar varios segundos simulados en obtener ruta bajo esta población. No confirmado como problema de jugabilidad visible; candidato a investigar si se reporta lentitud de movimiento con mucha población (ver `HISTORIAL-PROGRESO.md`).

Comando de medición limpia reutilizable (PowerShell, con Node en el PATH — ver "Entorno" abajo; **verificar primero el campo `"gpu"` del JSON resultante** — debe decir `NVIDIA GeForce GTX 1650 Ti`, no `Intel`; si no, fijar la preferencia de GPU de Edge — ver `HISTORIAL-PROGRESO.md` → "Notas de diagnóstico" para el procedimiento):
```powershell
$env:WB3D_BENCHMARK='1'; $env:WB3D_SCENARIO='mature'; $env:WB3D_AO_RESOLUTIONS='0.5'
$env:WB3D_WARMUP_MS='30000'; $env:WB3D_SAMPLE_MS='120000'; $env:WB3D_REPETITIONS='3'
$env:WB3D_POPULATIONS='500,1500'
corepack pnpm exec playwright test tests/e2e/ultra-benchmark.spec.js
# Agregar $env:WB3D_WAR='1' para guerra sostenida activa, o $env:WB3D_DISASTERS='1' para desastres
# sostenidos activos (ver B-07/C-11 y C-12 en el historial) — no combinar los dos en la misma corrida.
```
Herramientas de perfilado disponibles para el próximo trabajo de rendimiento (añadidas en C-08/C-09/B-07-C-11/C-12, ver historial): `WB3D_PROFILE_SYSTEMS=1` agrega percentiles por subsistema de simulación (`systemMs`) y por fase interna de `creatures.js` (`creatureMs`, incluye `navQueue`/`navQueueLength`) al reporte; `WB3D_SHADOWS=0`/`WB3D_AO=0`/`WB3D_BLOOM=0`/`WB3D_AA=0` aíslan cada categoría de render; `WB3D_WAR=1` declara guerra sostenida entre los dos imperios en vez de paz; `WB3D_DISASTERS=1` fuerza una rotación de desastres moderados sobre las 4 ciudades cada 20 s simulados.

### Medir antes de decidir (metodología general, para cualquier medición futura)

1. Medir en el equipo donde se reporta el problema. Fijar resolución física, escala, navegador, perfil y partida; registrar GPU efectiva y evitar comparar GPU real con renderizado por software.
2. Usar mundos pequeños, medianos y grandes, 500 y 1.500 criaturas, ciudades maduras, guerra, desastres, vista aérea y primer plano. Medir partida recién iniciada y tras 30–60 minutos.
3. Dar 30 segundos de calentamiento y registrar al menos 120 segundos, con tres repeticiones. Separar carga inicial de juego sostenido.
4. Registrar tiempos de cuadro medianos, p95 y p99, tareas largas, memoria, llamadas de dibujo y tiempo real frente al simulado.
5. Separar CPU (IA, rutas, economía, interfaz) de GPU (sombras, agua, vegetación y postproceso). Desactivar un efecto por vez usando los controles existentes.

### Objetivos (a validar en hardware declarado, no garantías universales)

| Escenario a 1920 × 1080, escala de pantalla registrada | Meta | Estado |
| --- | --- | --- |
| Alta, 500 criaturas y ciudades activas | Mediana ≤16,7 ms; p95 ≤22 ms | ✅ Cumple (medido en Ultra, más estricto) |
| Ultra, 500 criaturas | Mediana ≤16,7 ms; p95 ≤25 ms en equipo objetivo Ultra | ✅ Cumple en paz y en guerra sostenida (16,7 / 16,8-17,0 ms) |
| Ultra, 1.500 criaturas y guerra | Mediana ≤33,3 ms; p95 ≤40 ms | ✅ Cumple, paz y guerra sostenida (16,7 / 17,0-33,3 ms — sigue muy por debajo del objetivo) |
| Simulación a velocidad normal | Avance simulado/real ≥0,95 fuera de pausas y cargas | ✅ Cumple (≈1,000 en las 12 mediciones de C-10/B-07-C-11) |
| 20 ciclos de crear/cargar/salir | Sin aumento sostenido de recursos tras calentamiento y limpieza | ✅ Cubierto por `world-lifecycle.spec.js` (no reevaluado en esta sesión de rendimiento) |

**Cierre:** informes antes/después para la misma partida y cámara; las metas acordadas se cumplen y la calidad sigue siendo comparable. Si el hardware no permite el objetivo, declarar límites concretos y ajustar el diseño del perfil.

### Pendientes adicionales para cerrar B/C juntas

Ciudades envejecidas durante 30–60 minutos reales (rendimiento y corrección); extender el recorrido económico (ya verificado de punta a punta con dos ciudades) a más de dos ciudades/rutas simultáneas si hace falta esa confianza adicional; otras cámaras y comparación de costes CPU/GPU. El perfil maduro (`tests/fixtures/mature-world.js`) no sustituye estos recorridos — es terreno plano sin vegetación/minerales con envejecimiento/hambre/reproducción/desastres desactivados. **D no debe darse por desbloqueada con la suite corta.**

## Fase D — Dar realismo al mapa

1. Crear una escena visual de referencia con costa, río, pradera, bosque, montaña y aldea; fijar iluminación y cámara para comparaciones.
2. Mejorar relieve a varias escalas: silueta continental, colinas, valles y detalle local; mantener consistencia entre superficie visual, colocación y navegación.
3. Introducir variación de humedad y temperatura independiente de la altura para que los mapas planos también tengan biomas variados. Validar distribución con varias semillas, sin exigir todos los biomas en todos los mapas.
4. Mezclar materiales de tierra, arena, roca y vegetación según pendiente, humedad y altura; controlar repetición de textura y coste de sombreado.
5. Refinar orillas, profundidad aparente, riberas y transiciones de río a mar; comprobar inundaciones y cambios por terraformación.
6. Distribuir vegetación y rocas en agrupaciones naturales, respetando carreteras, parcelas y recursos de simulación.

**Cierre:** variedad visible desde la vista general, suelo convincente de cerca, ausencia de elementos flotantes y navegación consistente; sin regresión del presupuesto gráfico de C.

## Fase E — Modelos y animación

1. Inventariar cada recurso: procedencia/licencia, uso, peso, triángulos, materiales, texturas, huesos, animaciones y variantes. Separar archivos fuente de recursos que se distribuyen.
2. Preparar primero una familia visual completa: humano vestido, casa, edificio productivo, árbol y roca. Probar una aldea con ella antes de sustituir todo el catálogo.
3. Priorizar personajes civilizados, edificios con siluetas distintas y fauna frecuente; después criaturas fantásticas y variantes de edad, equipo y especie.
4. Sustituir esqueletos de edición pesados por esqueletos aptos para juego. Añadir reposo, caminar, trabajar, atacar y morir; sincronizar velocidad de animación y desplazamiento.
5. Crear niveles de detalle: animación completa cerca, actualización reducida a distancia y representación económica en vista aérea. Comprobar selección, sombras y transiciones.
6. Unificar escala, orientación, apoyo en el suelo, materiales y colores; añadir equipo visible sin multiplicar excesivamente las llamadas de dibujo.
7. Extraer piezas útiles de paquetes grandes. Como presupuestos de partida, evaluar personajes cercanos de 3–10 mil triángulos, 1–2 materiales y esqueletos de hasta unos 60 huesos; ajustar según mediciones, no tratarlos como garantías.

**Cierre:** catálogo 1.0 cubierto o con sustitutos definitivos coherentes, personajes sin deslizamiento evidente, edificios distinguibles y escenas de 500/1.500 unidades dentro de presupuesto.

## Fase F — Completar funciones y profundidad

La [página oficial de cambios de WorldBox](https://www.superworldbox.com/changelog), consultada el 8 de septiembre de 2026, sirve como referencia verificable de sistemas como reinos, alianzas, culturas, idiomas, religiones, subespecies, clanes y familias, además de historia, selección y órdenes. Registrar la plataforma y versión de referencia en la matriz; no confundir novedades históricas con funciones actuales idénticas en todas las plataformas. **Ver "Pendiente de decisión del usuario" arriba antes de cerrar el alcance de esta fase.**

| Bloque | Situación inicial en WB3D | Trabajo previsto |
| --- | --- | --- |
| Reinos, alianzas, guerras y rebeliones | Hay sistemas y pruebas | Validar sucesión, relaciones, conquistas, causas y consecuencias observables. |
| Familias, genes, clanes y subespecies | Hay implementación declarada | Comprobar herencia, genealogía, pertenencias y persistencia; evaluar herramientas de edición. |
| Culturas, idiomas y religiones | Emergentes según documentación | Verificar efectos reales y completar inspección y edición manual. |
| Órdenes de ejércitos | Existen objetivo, retirada y posturas | Verificar ejecución real. Una bonificación de daño no equivale a una formación espacial; separar ambos conceptos (confirmado: la postura actual es solo un multiplicador de daño, ver `FASE-A-MATRIZ-FUNCIONAL.md`). |
| Desarrollo de civilización | Producción y edificios existentes | Diseñar progresión y desbloqueos; el árbol tecnológico es propuesta propia pendiente de diseño, no una supuesta equivalencia automática con WorldBox actual. |
| Edificios e historia | Escuelas, templos, libros y emblemas pendientes | Definir función, productores, consumidores, interfaz y guardado de cada añadido. |
| Catálogo de biomas, seres, poderes y leyes | Catálogos locales disponibles | Comparación elemento por elemento; identificar ausencias reales y cerrar qué cubre 1.0. |
| Eras, planes/rituales, favoritos y otras herramientas avanzadas | No auditado integralmente | Investigar referencia y código antes de declararlos ausentes o comprometer su implementación. |

Orden recomendado: resolver sistemas parciales → completar información y control del jugador → progresión y edificios → contenido adicional del catálogo acordado. Cada función nueva debe tener reglas, interfaz, respuesta visual, guardado/migración, pruebas y presupuesto de coste.

**Cierre:** ninguna función comprometida para 1.0 figura como ausente o parcial; las diferencias deliberadas frente al original quedan documentadas.

## Fase G — Hacer que jugar sea claro y agradable

1. Revisar el recorrido crear → poblar → observar → intervenir → guardar → reanudar.
2. Mostrar por qué una unidad está hambrienta, una ciudad no construye o un ejército no llega; conectar inspector, eventos y mapa.
3. Unificar selección, seguimiento de entidades, filtros, capas, historial y atajos. Evitar activar poderes al interactuar con paneles.
4. Revisar cámara, zoom, colisiones visuales, tacto, escalado de texto y pantallas pequeñas. No depender solo del color.
5. Incorporar ambiente, efectos espaciales, volumen por categoría, silencio y pausa coherentes. Respetar la activación de audio requerida por el navegador.
6. Completar tutorial breve, mensajes de error útiles y confirmaciones para pérdida de partida; verificar autosave y recuperación si entran en el alcance.

**Cierre:** una persona nueva completa el recorrido principal sin ayuda externa; controles y estados son comprensibles en los dispositivos admitidos.

## Fase H — Equilibrio y resistencia

1. Ejecutar mundos completos durante 2 horas reales y una prueba nocturna de 8 horas reales con render y todos los sistemas activos. Mantener aparte las pruebas aceleradas de tiempo simulado.
2. Repetir al menos cinco semillas por escenario: prosperidad, escasez, guerra, islas, clima extremo y recuperación tras desastres.
3. Comprobar población, recursos, producción y expansión: sin crecimiento ilimitado accidental, estancamiento permanente ni extinción sistemática bajo condiciones favorables.
4. Probar carga bajo guerra, cambio de calidad, creación repetida de mundos, redimensionado, pérdida de foco y fallos de recursos. Registrar memoria, errores y rendimiento al inicio y al final.
5. Validar los navegadores prometidos, con Edge/Chrome como primera base; incorporar Firefox y Safari a la matriz si se distribuirá para ellos. Las pruebas automáticas de motor no sustituyen toda la comprobación en dispositivos reales.
6. Realizar sesiones de juego exploratorio y registrar problemas de claridad, aburrimiento, bloqueos y comportamientos incoherentes.

**Cierre:** cero P0/P1, ninguna corrupción de partida, sin fugas sostenidas y resultados de rendimiento reproducibles. Cada P2 restante debe tener impacto y decisión explícitos de lanzamiento.

## Fase I — Preparar y publicar 1.0

1. Congelar contenido; dedicar el tramo final a correcciones.
2. Construir el paquete de producción y probarlo servido desde una carpeta limpia, también bajo una subruta. Comprobar rutas de modelos, texturas, audio y workers.
3. Excluir material fuente y paquetes sin usar; verificar licencias y atribuciones de los recursos distribuidos.
4. Revisar guardados anteriores, importación/exportación, recuperación y errores de almacenamiento en la versión final.
5. Publicar requisitos medidos, límites de mapa/población por perfil, controles, versión y problemas menores conocidos.
6. Conservar paquete anterior y procedimiento de reversión; hacer una última partida completa en el destino de publicación.

**Cierre:** paquete reproducible, recursos presentes, catálogo acordado completo y todos los criterios de lanzamiento satisfechos.

## Cómo ejecutar y dar seguimiento a la guía

Crear una tarea por resultado comprobable. Cada tarea incluye: identificador, fase, prioridad, dependencias, escenario inicial, cambio esperado, prueba de aceptación, medición antes/después y estado. No mezclar una actualización del motor con un reemplazo masivo de modelos y cambios de IA en una sola entrega.

### Próximas tareas, en orden

- [ ] **B-06**: recorridos completos por sistema de la tabla de Fase B — priorizar Mundo, Vida, Asentamientos y Poderes/estados (⬜ sin ningún recorrido dedicado todavía).
- [ ] **B-07/C-11 (continuación)**: rendimiento bajo guerra sostenida, combate real, transporte económico de punta a punta, desastres/terreno en vivo y conquista autónoma ya verificados (ver Fase C arriba) — falta: **medir rendimiento y corrección bajo ciudades envejecidas 30-60 min real** (sin empezar, único pendiente de este bloque).
- [ ] **D/E-01**: crear una aldea y entorno de referencia con el estilo visual final.
- [ ] **F-01**: implementar la primera función parcial prioritaria con su recorrido completo (depende de confirmar el catálogo 1.0 — ver "Pendiente de decisión del usuario").

Las estimaciones de esfuerzo se harán después de cerrar B y C. La amplitud real de las funciones parciales y el trabajo artístico todavía no están suficientemente medidos para prometer una fecha de finalización.

La versión estará lista para jugarse en su totalidad cuando todo el alcance 1.0 sea accesible y verificable, las partidas largas sean estables, guardar y continuar sea fiable, y los perfiles gráficos cumplan sus objetivos en hardware declarado.

## Entorno de esta máquina

PowerShell, Edge instalado, Node en `C:\Program Files\nodejs` (puede no estar en el PATH de la sesión de herramientas):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:WB3D_BENCHMARK=''  # asegurar que el benchmark largo esté desactivado para la suite normal
corepack pnpm test:unit
corepack pnpm test:e2e
corepack pnpm build
```

`corepack pnpm <comando>` funciona directamente — no hace falta `corepack enable` (falla con `EPERM` sin permisos de administrador). Más detalles de entorno y diagnósticos ya resueltos, para no repetir investigación: [`HISTORIAL-PROGRESO.md`](HISTORIAL-PROGRESO.md).
