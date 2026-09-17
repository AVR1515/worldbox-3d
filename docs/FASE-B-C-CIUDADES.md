# Continuación B/C: ciudades y guerra (8 de septiembre de 2026)

## B: recorridos añadidos

- B-04: una orden de ejército conservada tras firmar la paz podía seguir derribando murallas. Regresión reproducida antes del cambio al invocar el asedio antes de resincronizar el ejército. El motor habitual llama a _syncArmies antes de _updateSieges: se trata de un refuerzo ante órdenes obsoletas, no de un fallo confirmado en el recorrido normal de la interfaz. El asedio comprueba la relación actual, pertenencia y rol de soldados, guarniciones e IDs repetidos.
- Recorrido Edge con cuatro ciudades, dos imperios, 56 casas y 24 edificios productivos: guardado inicial, declaración y movilización, brecha, cargar, conquista, cargar, paz, reconstrucción mediante 62 segundos del motor completo y carga final. Llegada de tropas y evacuación controladas; marcha autónoma se verifica por separado.
- Marcha autónoma aprobada en Edge con semilla 4421: movilizar desde una ciudad amurallada, avanzar sin teletransportar tropas, acercarse a menos de 15 unidades del centro enemigo y adquirir objetivo de combate en un máximo de 120 s simulados. No se exige una victoria aleatoria ni se confunde contacto con conquista completa autónoma.
- Economía: prueba de mineral finito → mina → taller/herrería → equipo. Comprueba consumo, agotamiento, recursos no negativos y que restaurar la civilización no duplique equipo, cobros o bonificaciones.
- Escenario reutilizable: `tests/fixtures/mature-world.js`. Terreno plano elevado con agua en el borde, sin vegetación ni minerales. No representa todavía un mundo natural ni una sesión envejecida.

## C: método y estado de medición

Equipo efectivo comprobado en el piloto: NVIDIA GeForce GTX 1650 Ti mediante ANGLE/D3D11, Edge 152, ventana 1920 × 1080, resolución interna 1,25, Ultra y AO al 50 %. Semilla de aleatoriedad 12345. Cuatro ciudades maduras en paz y todos los sistemas de GameSession conectados. Envejecimiento, hambre, reproducción, enfermedad, diplomacia aleatoria y desastres desactivados para estabilizar la carga.

- 500 criaturas civilizadas, mapa 132.
- 1.500 criaturas: 900 civilizadas (320 humanos, 200 elfos, 200 orcos, 180 enanos), 355 herbívoros y 245 peces, mapa 240.
- Cada muestra: 30 s de calentamiento + 120 s de registro; tres repeticiones independientes por población. Un solo navegador/mundo activo. El perfil previo de isla con criaturas se conserva como escenario distinto: no comparar sus cifras como antes/después de una optimización.
- Medidas: mediana/p95/p99 de cuadro, CPU de simulación, actualización visual y envío de render; llamadas de dibujo de todas las pasadas; tareas >50 ms; memoria JS aproximada cuando el navegador la expone; tiempo simulado/real y tiempo descartado. CPU de render no equivale a tiempo GPU.
- El arnés guarda `ultra-report.json` tras cada muestra para conservar resultados parciales si se interrumpe.

Ejecución reproducible en PowerShell (Node y herramientas locales en PATH):

```powershell
$env:WB3D_BENCHMARK='1'
$env:WB3D_SCENARIO='mature'
$env:WB3D_POPULATIONS='500,1500'
$env:WB3D_AO_RESOLUTIONS='0.5'
$env:WB3D_WARMUP_MS='30000'
$env:WB3D_SAMPLE_MS='120000'
$env:WB3D_REPETITIONS='3'
node node_modules/@playwright/test/cli.js test tests/e2e/ultra-benchmark.spec.js
```

## Resultados

Línea base completa, antes de C-04:

| Población | Mediana de cuadro (3 muestras) | p95 (3 muestras) | Simulación/real | CPU de render: medianas |
| --- | --- | --- | --- | --- |
| 500 | 16,7 / 16,7 / 16,7 ms | 33,4 / 33,4 / 33,4 ms | 1,000 / 1,000 / 1,000 | 13,3 / 14,9 / 14,5 ms |
| 1.500 | 50 / 50 / 50 ms | 66,7 / 66,8 / 66,8 ms | 0,999 / 0,996 / 0,999 | 30,8 / 33,8 / 34,5 ms |

Fuentes: `evidence/ultra-mature-before-500.json` y `evidence/ultra-mature-before-1500.json`. No cumplen los objetivos Ultra de p95 25/40 ms, incluso en paz. La carga de 1.500 conserva entre 99,6 % y 99,9 % del ritmo de simulación, pero presenta 861–1.258 tareas largas por muestra y unas 729 llamadas de dibujo medianas. La memoria JS final varía con la recolección de basura; no permite afirmar una fuga.

C-04 elimina el recorrido repetido de transformaciones entre las pasadas de color y SSAO. Se actualiza después de colocar cielo/estrellas, se reutilizan las matrices y se restaura la política original con `finally`, también ante errores. No cambia resolución, sombras, materiales, AO ni simulación. Una prueba dirigida observa dos actualizaciones antes del cambio y una después. Se comprobó el caso sin postproceso y la política manual de matrices. Validación: 189 unitarias, 24 de navegador y compilación aprobadas; captura `evidence/ultra-single-transform.png` revisada visualmente. El aviso de paquete >500 kB sigue presente.

**C-05 retomado por otra IA el 8 de septiembre, ~18:10–18:45.** Se completó la muestra 3 de 500 (dos veces, para descartar una anomalía puntual) y las tres muestras de 1.500 pendientes. Resultado: **inconsistente, no una mejora limpia.** Tabla completa (medianas de cuadro, p95, CPU de render mediana):

| Población | Muestra | Mediana cuadro | p95 cuadro | CPU render (mediana) | Tareas largas (cuenta / total ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| 500 | 1 (ChatGPT, `after-500-partial`) | 16,7 ms | 17,8 ms | 10,6 ms | 9 / 527 |
| 500 | 2 (ChatGPT, `after-500-partial`) | 16,7 ms | 17,1 ms | 10,2 ms | 2 / 119 |
| 500 | 3 (esta sesión, `after-500-sample3`) | 16,7 ms | 33,4 ms | 13,3 ms | 77 / 4359 |
| 500 | 3-retry (esta sesión, `after-500-sample3-retry`) | 16,7 ms | 33,4 ms | 13,5 ms | 59 / 3183 |
| 1.500 | 1 (esta sesión, `after-1500`) | 50,0 ms | 99,9 ms | 27,0 ms | 1042 / 71552 |
| 1.500 | 2 (esta sesión, `after-1500`) | 49,9 ms | 66,8 ms | 26,4 ms | 815 / 49877 |
| 1.500 | 3 (esta sesión, `after-1500`) | 50,0 ms | 83,3 ms | 28,4 ms | 1050 / 65918 |

Comparado con la línea base antes de C-04 (500: p95 33,4 ms constante, CPU render 13,3–14,9 ms; 1.500: p95 66,7–66,8 ms constante, CPU render 30,8–34,5 ms):

- **La mediana de cuadro no empeoró en ningún caso** (500: siempre 16,7 ms; 1.500: siempre ≈50 ms, igual que antes de C-04).
- **La CPU de render mediana mejora de forma consistente en 1.500** (27,0/26,4/28,4 ms frente a 30,8/33,8/34,5 ms antes) — la parte que C-04 realmente toca (evitar recorrer transformaciones dos veces) sigue rindiendo, incluso en las muestras con más ruido.
- **El p95/p99 de cuadro completo empeoró o quedó igual** en las 5 muestras de esta sesión frente a las 2 primeras de ChatGPT, con un salto grande en el conteo de tareas largas (de 2–9 tareas a 59–1050). Esto no encaja con el propio cambio de código (`js/render-system.js`, revisado de nuevo aquí: solo evita una segunda propagación de matrices, nunca puede añadir trabajo) ni con un cambio de escenario (misma semilla, mismas ciudades, mismas leyes desactivadas).
- Comprobado con `nvidia-smi` inmediatamente después de la serie de 1.500: GPU a 53 °C, reloj en 300 MHz (de un máximo de 2100 MHz), 14 % de uso — es decir, en reposo total, sin señal de estar todavía limitada por temperatura en ese instante. Tampoco se encontró ningún proceso `msedge`/`node` con uso de CPU anómalo compitiendo por la GPU. **La causa del ruido queda sin determinar**: es compatible con acumulación de carga térmica *durante* las pruebas (que se disipa en segundos al terminar, por lo que `nvidia-smi` en reposo no la detectaría) tras una sesión larga de pruebas encadenadas (línea base completa + repeticiones de `performance.spec.js` + los cinco benchmarks de esta tanda, todos en la misma máquina sin pausa), pero no se confirmó con monitoreo simultáneo.

**Conclusión honesta de C-05:** la implementación de C-04 es correcta y ya validada funcionalmente (sección anterior); su beneficio en CPU de render es real y se sostiene incluso bajo ruido de sesión, pero **no hay una comparación limpia y reproducible de p95/p99 a población alta** que permita declarar cumplido el objetivo Ultra de 1.500 (p95 ≤40 ms) — ni antes ni después de C-04 se cumple ese objetivo en ningún conjunto de muestras recogido hasta ahora. No se declara C cerrada. Evidencia: `evidence/ultra-mature-after-500-sample3.json`, `evidence/ultra-mature-after-500-sample3-retry.json`, `evidence/ultra-mature-after-1500.json` (además de `evidence/ultra-mature-after-500-partial.json` ya existente).

**Recomendación para quien continúe:** repetir la comparación completa (500 y 1.500, 3 repeticiones cada una) partiendo de un sistema recién reiniciado e inactivo, sin ninguna otra suite de pruebas ejecutada antes en la misma sesión, e idealmente con `nvidia-smi --query-gpu=temperature.gpu,clocks.current.graphics,utilization.gpu --format=csv -l 5` corriendo en paralelo en otra terminal para capturar el estado térmico/de reloj *durante* la medición, no solo después.

## C-06 — murallas agrupadas en InstancedMesh (completado, 8 de septiembre ~19:10)

La optimización candidata que quedaba pendiente al cerrar C-05: `js/settlements.js` creaba un `THREE.Mesh` por tramo de muralla (~70 por ciudad de nivel máximo, cientos en total con varias ciudades amuralladas), la fuente más probable de las ~725-740 llamadas de dibujo constantes en todas las muestras del benchmark, antes y después de C-04 (que no las tocaba). Ahora dos `THREE.InstancedMesh` globales (`wallSegmentMesh`/`wallGateMesh`) sustituyen esos objetos, mismo patrón ya usado para casas (`HOUSE_CAP`/`allocHouseSlot`). Cumplido lo que pedía esta misma nota en la entrega anterior: los datos de tramos/puertas que usa la navegación se mantuvieron separados (`settlements.walls` sigue siendo `id -> {children: [...]}`, cada child un descriptor ligero con posición/orientación/`userData.isGate`, no un `Object3D` real — navegación, `dumpWalls()` y los tests de murallas existentes no necesitaron cambios); el modelo real descargado tarde se actualiza correctamente (más simple que antes: un solo swap de geometría/material por tipo de pieza en el constructor, no un callback por muralla); solo se liberan slots de instancia al derribar (`removeWall`); orientación, puertas, terreno, carga y asedio se revalidaron con `tests/e2e/city-walls.spec.js` y `tests/e2e/war-journey.spec.js` (ambas reescritas donde hacía falta, mismas garantías de corrección, ver detalle en el commit `dd476c1`). El aspecto no cambió — mismo modelo, mismo material, mismas posiciones, verificado por captura y por los mismos tests de orientación/gaps que ya existían.

**No se midió todavía el impacto en p95/p99** — la reducción de llamadas de dibujo (~292 → 2 en la escena de 4 ciudades maduras) es una garantía geométrica directa del cambio, no algo que necesite remedirse para confirmarse, pero cuánto mejora eso el percentil de cuadro completo (que es lo que decide si se cumple el objetivo Ultra) sigue sin medir limpiamente — ver C-07 abajo.

## C-07 — medición Ultra limpia, con C-06 ya aplicado (completado, 10 de septiembre de 2026 ~09:00-09:20)

Repetición de 500 y 1.500 criaturas (3 repeticiones cada una), máquina inactiva (GPU en 51 °C/0 % antes de empezar), `nvidia-smi --query-gpu=timestamp,temperature.gpu,utilization.gpu,clocks.sm,power.draw --format=csv -l 5` corriendo en paralelo durante toda la ventana (~16 min).

**Incidente durante la corrida — GPU incorrecta en el primer intento:** la primera corrida de 500 criaturas usó `Intel(R) UHD Graphics` en vez de la `NVIDIA GeForce GTX 1650 Ti` esperada (campo `"gpu"` del reporte). Resultado descartado, no guardado en `docs/evidence/`. Diagnóstico: `HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences` no tenía entrada para `msedge.exe`, así que Windows eligió la GPU integrada esa vez (comportamiento no determinista del cambio automático de gráficos híbridos — no depende de nada que este proyecto controle). Corregido fijando la preferencia explícitamente:
```powershell
$edgePath = (Get-Item "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe").FullName
New-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences" -Name $edgePath -Value "GpuPreference=2;" -PropertyType String -Force
```
Verificado con una corrida corta (`WB3D_WARMUP_MS=2000`, `WB3D_SAMPLE_MS=3000`, `WB3D_REPETITIONS=1`) antes de repetir la serie completa. Detalle completo en `HISTORIAL-PROGRESO.md` → "Notas de diagnóstico".

**Resultados de la serie limpia (GPU correcta confirmada en las 6 muestras):**

| Población | Mediana | p95 | Objetivo p95 | ¿Cumple? |
| --- | --- | --- | --- | --- |
| 500 | 16,7 ms (las 3 repeticiones) | 33,3 ms (las 3 repeticiones) | ≤25 ms | No |
| 1.500 | 33,4 / 33,4 / 49,9 ms | 83,2 / 83,2 / 99,9 ms | ≤40 ms | No |

- **Térmico/reloj durante toda la corrida:** temperatura máxima 66 °C (muy por debajo de cualquier umbral de throttling de esta GPU), reloj estable en 1200-1400 MHz bajo carga activa, caída a 300 MHz/0 % en los huecos entre repeticiones — comportamiento saludable, sin evidencia de throttling.
- **Desglose simulación vs. render a 1.500** (del propio reporte, `simulationMs`/`renderCpuMs`): p95 de simulación 44,8-52,8 ms; p95 de render (CPU) 35,3-43,9 ms. Pesan de forma comparable — ninguno domina claramente. 700-800 "long tasks" por corrida (48-57 s de bloqueo del hilo principal sobre 120 s de ventana).
- **`simulatedRealRatio`:** 0,98-0,995 a 1.500 (cumple ≥0,95); ≈1,000 a 500. `droppedSeconds` pequeño mientras aparece a 1.500 (0,6-2,3 s) — consistente con algunos fotogramas superando `maxFrameSeconds` (0,1 s) en `core/fixed-step-clock.js`, no un bug.
- **Confirmación cruzada con C-05:** los números de 500 criaturas de esta corrida (mediana 16,7 ms, p95 33,3-33,4 ms) coinciden casi exactamente con `ultra-mature-after-500-sample3.json`/`-retry.json` de C-05 (mediana 16,7 ms, p95 33,4 ms), que ya estaban en la GPU correcta. Esto confirma que estos números son reales y reproducibles entre sesiones — el rendimiento insuficiente no es ruido. También descarta el problema de selección de GPU como explicación del "ruido sin explicar" que C-05 reportó como inconcluso, ya que las muestras de C-05 ya tenían la GPU correcta registrada; esa causa queda descartada específicamente para C-05.

Evidencia: `evidence/ultra-c07-500-gpufix.json`, `evidence/ultra-c07-1500-gpufix.json`.

**Conclusión:** C-07 completado. **Ningún objetivo Ultra se cumple**, confirmado con medición limpia, reproducible, sin ruido térmico ni de GPU. C sigue abierta. Ver C-08 abajo.

## C-08 — perfilado por subsistema y por categoría de render a 1.500 (completado, 10 de septiembre de 2026 ~09:25-09:32)

Herramienta añadida para hacerlo reproducible en vez de medir a mano una sola vez: `GameRuntime` acepta ahora `runtime.profileSystems = true` (por defecto `false`, cero coste extra en juego normal — commit ver más abajo) y expone `runtime.lastSystemTimings` con el tiempo de cada subsistema (`world`, `creatures`, `settlements`, `civilization`, `statuses`, `cataclysms`, `ships`) del último `update()`. El benchmark (`tests/e2e/ultra-benchmark.spec.js`) lo activa con `WB3D_PROFILE_SYSTEMS=1` y agrega percentiles por subsistema en el campo `systemMs` del reporte. También se añadieron `WB3D_SHADOWS`, `WB3D_AO`, `WB3D_BLOOM`, `WB3D_AA` (todos `1` por defecto, poner en `0` para desactivar) para aislar categorías de render usando los controles gráficos ya existentes (`RenderSystem.setGraphics`/`setShadows`), sin tocar nada del motor de render.

**Perfilado de simulación** (1.500 criaturas, escena madura, 20 s de calentamiento + 60 s de muestra, `WB3D_PROFILE_SYSTEMS=1`):

| Subsistema | p95 (ms) | p99 (ms) |
| --- | --- | --- |
| **creatures** | **28,4** | **44,7** |
| settlements | 0,1 | 1,1 |
| civilization | 0 | 2,9 |
| world | 0,1 | 0,2 |
| statuses/cataclysms/ships | 0 | ~0,1 cada uno |

`simulationMs` total de esa corrida: p95 28,6 ms. **`creatures.update()` concentra prácticamente el 100 % del tiempo de simulación** — el resto de subsistemas es insignificante. No hace falta seguir perfilando dónde está el cuello de botella de simulación: está en `js/creatures.js` (probablemente IA/decisión y pathfinding por criatura, sin confirmar aún qué parte interna exactamente). Evidencia: `evidence/ultra-c08-systems-1500.json`.

**Aislamiento de categorías de render** (1.500 criaturas, 15 s de calentamiento + 30 s de muestra cada una, partiendo de `renderCpuMs` p95 basal ≈26,4 ms/179 llamadas con todo activado — ver la corrida de arriba):

| Configuración | `renderCpuMs` p95 | Δ vs. basal | Llamadas de dibujo p95 |
| --- | --- | --- | --- |
| Todo activado (basal) | 26,4 ms | — | 179 |
| Sombras desactivadas | 23,2 ms | −3,2 ms (−12 %) | 150 |
| **AO/SSAO desactivado** | **13,0 ms** | **−13,4 ms (−51 %)** | **103** |
| Bloom + antialias desactivados | 23,1 ms | −3,3 ms (−12 %) | 151 |

**El paso de oclusión ambiental (`SSAOPass`, ya a resolución 0,5 vía `WB3D_AO_RESOLUTIONS`) es, por mucho, el mayor costo de render — la mitad del `renderCpuMs` total y ~76 de las 179 llamadas de dibujo, más del doble del costo de sombras o de bloom+antialias juntos.** Desactivarlo también bajó el `frameMs` p95 completo de 50,1 ms a 33,4 ms en esa corrida — justo en el borde del objetivo Ultra de 1.500 (≤40 ms). Evidencia: `evidence/ultra-c08-noshadows-1500.json`, `evidence/ultra-c08-noao-1500.json`, `evidence/ultra-c08-nobloomaa-1500.json`.

**Conclusión de C-08:** dos candidatos concretos y medibles para la siguiente optimización, ya no una elección a ciegas:

- **C-09 (simulación, mayor impacto potencial):** optimizar el bucle de actualización de `js/creatures.js` a 1.500 criaturas — perfilar dentro del propio archivo (DevTools o instrumentación puntual) qué parte consume los ~28 ms de p95: decisión de IA, búsqueda de camino, consultas de `SpatialIndex`, u otra cosa.
- **C-10 (render, impacto ya cuantificado):** reducir el costo del paso de AO/SSAO — evaluar radio/muestras del kernel, una resolución aún menor que 0,5, o un método más barato de oclusión de contacto — sin perder la calidad visual mínima aceptable. Esto solo no alcanza el objetivo de 1.500 (mediana seguiría en 33,4 ms, límite del objetivo ≤33,3 ms) pero es una mejora real y de bajo riesgo mientras se ataca C-09.

No se implementó ninguna optimización todavía — C-08 era perfilar, no optimizar. Ver "Próximo paso concreto" de Fase C en `PLAN-JUEGO-COMPLETO.md`.

## C-09 — perfilado fino de `js/creatures.js` e intento de optimización revertido (10 de septiembre de 2026 ~09:45-10:10)

**Perfilado por fase dentro de `CreatureManager.update()`.** Misma herramienta que C-08 (opt-in, sin costo cuando está apagada): `creatures.profileDetail = true` mide por separado `navQueue` (`navigation.processQueue()`), `settlementIndex` (`_refreshSettlementIndex()`), `spatialRebuild` (los dos `spatialIndex.rebuild()` del método), `decide` (llamadas a `_decide()`), `mainLoop` (el bucle completo por criatura, incluye `decide`) y `cleanup`/`projectiles`. Expuesto en el benchmark vía el mismo `WB3D_PROFILE_SYSTEMS=1`, campo `creatureMs` del reporte.

Resultado (1.500 criaturas, escena madura, 20 s de calentamiento + 60 s de muestra):

| Fase | p95 (ms) | p99 (ms) |
| --- | --- | --- |
| **navQueue** (`navigation.processQueue()`) | **21,2** | **24,1** |
| mainLoop (resto: movimiento, alimentación, enfermedad, actualización de instancias) | 4,5 | 6,1 |
| spatialRebuild (los 2 `rebuild()` por tick, juntos) | 0,6 | 0,8 |
| decide (IA, dentro de mainLoop) | 0,3 | 0,4 |
| settlementIndex | 0 | 0,1 |
| cleanup / projectiles | 0 | 0 |

`simulationMs` total de esa corrida: p95 26,2 ms. **`navigation.processQueue()` —el drenado de la cola de solicitudes de ruta A*, limitado por `NAV_QUEUE_NODE_BUDGET=8000` nodos por tick— es prácticamente todo el costo de simulación**, no la decisión de IA ni el resto del bucle de movimiento como se sospechaba en C-08. Evidencia: `evidence/ultra-c09-detail-1500.json`.

**Intento de optimización (revertido): presupuesto de tiempo real además del de nodos.** Como un conteo de nodos no dice nada sobre el costo real en milisegundos en esta máquina, se añadió un segundo parámetro `timeBudgetMs` a `NavigationGrid.processQueue()` (verificado antes de empezar una nueva búsqueda, no interrumpe una en curso) y se llamó con `NAV_QUEUE_TIME_BUDGET_MS = 8`. Antes de darlo por bueno, se corrió `tests/e2e/war-journey.spec.js` (recorrido de marcha autónoma, población 240, con contención real de la cola de rutas) 4 veces: **2 de 4 fallaron** (`minimumDistance` 21-24 en vez de <15 — los soldados no llegaban a tiempo). Comparado contra la misma prueba en el código sin este cambio, corrida 6 veces (3 antes + 3 después de revertir): **0 de 6 fallos**. Confirmado que el presupuesto de 8 ms —que recorta el rendimiento de la cola a aproximadamente un tercio del anterior (de ~3 búsquedas completas por tick a ~1)— sí regresiona un escenario real con contención moderada, no solo el caso extremo de 1.500 en paz que se estaba midiendo. **Revertido** (`js/navigation.js`, `js/creatures.js`) antes de este commit; conservado solo el perfilado (`profileDetail`, sin cambio de comportamiento).

**Conclusión de C-09:** limitar el *rendimiento* de la cola de pathfinding no es un candidato seguro sin mucho más ajuste y prueba — reduce el pico (p95/p99) a costa de aumentar la latencia bajo carga sostenida, y esa latencia sí importa para jugabilidad (una criatura sin ruta resuelta simplemente no se mueve). El candidato real y de bajo riesgo para continuar es **reducir el costo por nodo** de la propia búsqueda A*, sin cambiar su comportamiento:

- `findPathGrid()` (`js/navigation.js`) usa `Map` para `costs` y `cameFrom`, indexados por un entero de grilla ya acotado (`world.idx()`) — sustituir por arreglos tipados (`Float32Array`/`Int32Array` del tamaño de la grilla, con un esquema de "generación" para no tener que limpiarlos entre búsquedas) debería ser sustancialmente más rápido que operaciones de `Map` por cada nodo visitado, sin cambiar el resultado del algoritmo.
- El chequeo de corte de esquina en movimientos diagonales llama a `traversalCost()` hasta 2 veces extra por cada una de las 4 direcciones diagonales — hasta 16 llamadas a `traversalCost()` por nodo expandido en vez de 8. `traversalCost()` no es trivial (consulta lava/hielo/agua/bioma/altura). Vale la pena medir cuánto de eso es evitable con memoización o reordenando el chequeo.

Ninguno de los dos implementado todavía — queda como el siguiente paso concreto de C-09, ahora con la causa raíz identificada con precisión en vez de "optimizar `creatures.js` en general".

### C-09 (continuación) — reducir el costo por nodo del A*: implementado y medido (10 de septiembre de 2026 ~10:30-11:20)

Los dos candidatos identificados arriba, implementados juntos en `js/navigation.js` sin cambiar el comportamiento del algoritmo (mismos resultados, solo más rápido):

1. **`costs`/`cameFrom` como arreglos tipados en vez de `Map`.** `_ensureSearchBuffers()` reserva `Float64Array`/`Int32Array` del tamaño de la grilla (`world.verts²`) una sola vez y los reutiliza entre búsquedas con un contador de "generación" (`_searchGen`) en vez de limpiarlos cada vez — una celda solo es válida si su generación coincide con la búsqueda actual.
2. **Costos ortogonales reutilizados en el chequeo diagonal.** `DIRECTIONS` se separó en `ORTHOGONAL_DIRECTIONS`/`DIAGONAL_DIRECTIONS`; los 4 costos ortogonales se calculan primero y se guardan, y el chequeo de corte de esquina de cada diagonal reutiliza esos valores en vez de volver a llamar `traversalCost()` — de hasta 16 llamadas por nodo expandido a 8.

Verificación de corrección antes de medir: los 8 tests unitarios de `navigation.test.js` (comportamiento del algoritmo) pasan sin cambios; `war-journey.spec.js`/`city-walls.spec.js` corridos 2 veces cada uno, 6/6 — la marcha autónoma bajó de ~20-22 s a ~13,2-13,3 s de duración real de la prueba (arribo más rápido, mismo resultado).

**Medición limpia antes/después (mismo protocolo que C-07: GPU discreta confirmada, 3 repeticiones, 30 s de calentamiento + 120 s de muestra):**

| Población | Métrica | Antes (C-07/evidence/ultra-c07-\*-gpufix.json) | Después (evidence/ultra-c09-clean-\*.json) | Objetivo Ultra | ¿Cumple ahora? |
| --- | --- | --- | --- | --- | --- |
| 500 | mediana | 16,7 ms | 16,7 ms | ≤16,7 ms | Sí (ya cumplía) |
| 500 | p95 | 33,3 ms (las 3 rep.) | **17,0 ms** (las 3 rep.) | ≤25 ms | **Sí — antes no cumplía** |
| 1.500 | mediana | 33,4/33,4/49,9 ms | **33,3 ms (las 3 rep.)** | ≤33,3 ms | **Sí — antes fallaba en la 3ª rep.** |
| 1.500 | p95 | 83,2/83,2/99,9 ms | **33,4/50,0/33,4 ms** | ≤40 ms | Parcial — 2 de 3 repeticiones cumplen; la 2ª da 50,0 ms |
| 1.500 | `simulationMs` p95 | 44,8-52,8 ms | **15,6-15,8 ms** | — | −65 % |
| 1.500 | `longTasks` por corrida | 723-803 (48-57 s bloqueados) | **33-37 (2,2-2,5 s bloqueados)** | — | −95 % |

**A 500 criaturas el objetivo Ultra ahora se cumple por completo, de forma reproducible en las 3 repeticiones.** A 1.500, la mediana ya cumple siempre y el p95 cumple en 2 de 3 repeticiones — la 2ª corrida dio exactamente 50,0 ms, el doble de 33,3/3×16,7, consistente con el patrón de cuantización de fotogramas por VSync/composición ya documentado en este entorno (no una regresión distinta). Ningún `droppedSeconds` en ninguna repetición; `simulatedRealRatio` ≈1,000 en todas.

**Hallazgo nuevo, no una regresión de este cambio: la cola de rutas tiene una carga pendiente crónica a 1.500 criaturas.** El campo `creatureMs.navQueueLength` (añadido junto con este trabajo) mostró mediana ~3.390 y p95 ~5.046 solicitudes en cola durante la corrida de perfilado — `NAV_QUEUE_NODE_BUDGET` (sin cambios, 8000 nodos/tick) sigue siendo insuficiente para la demanda sostenida de 1.500 criaturas, esta optimización solo abarató el costo de procesar ese mismo presupuesto, no aumentó cuánto se procesa por tick. Esto implica que criaturas individuales pueden tardar varios segundos simulados en obtener una ruta resuelta bajo esta población — no confirmado como problema de jugabilidad visible, pero es un candidato a investigar si se reporta lentitud de movimiento con muchas criaturas. Evidencia: `evidence/ultra-c09-detail-1500.json` (perfilado con calentamiento corto), `evidence/ultra-c09-clean-500.json`, `evidence/ultra-c09-clean-1500.json` (medición limpia final).

**Conclusión:** Fase C muy cerca de cerrar. 500 cumple del todo; 1.500 cumple mediana siempre y p95 en la mayoría de las repeticiones — falta terminar C-10 (AO/SSAO, todavía sin tocar) para llevar el margen de 1.500 más lejos del límite y volver el p95 consistente en vez de depender de qué repetición caiga en qué escalón de cuantización.

## C-10 — reducir el costo del paso de AO/SSAO: implementado y medido (10 de septiembre de 2026 ~11:30-13:00)

**Diagnóstico antes de tocar código.** Un script de auditoría desechable (no comprometido al repositorio) confirmó que la escena base a 1.500 criaturas ya es liviana en régimen estable — 131 llamadas de dibujo sin AO tras aplicar LOD/culling (`runtime.updateVisuals()`), coherente con lo ya medido en C-08 (103). No había geometría sin agrupar que valiera la pena convertir a `InstancedMesh` — ese margen ya se agotó en C-04/C-06. El costo de AO no viene de dibujar más objetos de los necesarios, sino de **cómo `THREE.SSAOPass` decide qué ocultar antes de su pasada de normales**: `overrideVisibility()`/`restoreVisibility()` (código de la librería, `node_modules/three/examples/jsm/postprocessing/SSAOPass.js`) hacen cada una un `scene.traverse()` completo — dos veces por fotograma — solo para ocultar objetos `Points`/`Line` (necesario porque `MeshNormalMaterial` no sabe representarlos con sentido). Auditoría del proyecto completo: **existen exactamente dos objetos `Points` en todo el juego** (`render.stars`, el campo de estrellas; `world.rainMesh`, la lluvia) y **ningún `Line`**. Medido de forma aislada (`render()` repetido 60 veces sobre la misma escena de 1.500 criaturas, sin tocar nada más): con el `overrideVisibility`/`restoreVisibility` de la librería, mediana 9 ms por `render()`; parcheados a no-ops, mediana 5,1 ms — **~4 ms por fotograma recorriendo ~12.235 objetos dos veces para encontrar 1-2**.

**Arreglo:** `RenderSystem._patchAoVisibilityOverride()` (`js/render-system.js`) reemplaza esos dos métodos de la instancia de `SSAOPass` (no la clase — no afecta nada fuera de este proyecto) por una versión que cachea la lista corta de objetos `Points`/`Line`, refrescada cada 90 fotogramas en vez de en cada uno — el conjunto solo cambia en eventos raros (el clima regenera `rainMesh`), así que unos fotogramas de margen alrededor de un cambio así (en el peor caso, un objeto `Points` recién creado no se oculta durante la pasada de normales por unos fotogramas) es un costo aceptable e imperceptible a cambio de evitar la recorrida completa casi siempre. Mismo patrón ya usado en este archivo para parchear `ssaoMaterial.fragmentShader`/`output.material.fragmentShader`.

Verificación antes de medir: 191/191 tests unitarios sin cambios; `graphics.spec.js`, `landscape-fixes.spec.js`, `ocean.spec.js` (5/5) — cubren específicamente Ultra, sombras y agua; comprobación visual en vivo con Ultra activado (AO real): terreno, sombras de contacto y agua se ven correctos, sin errores de consola. No se pudo forzar de forma fiable la noche en el panel de previsualización (`requestAnimationFrame` suspendido, limitación ya documentada) para confirmar visualmente la interacción con el campo de estrellas — mitigado por el razonamiento de corrección arriba (la caché se puebla en el primer fotograma, antes de que exista ninguna ventana de desincronización).

**Medición limpia final (mismo protocolo de C-07/C-09, 3 repeticiones cada población, GPU confirmada):**

| Población | Mediana | p95 | p99 | Objetivo p95 | ¿Cumple? |
| --- | --- | --- | --- | --- | --- |
| 500 | 16,7 ms (las 3 rep.) | 16,8/16,9/16,9 ms | 17,0/17,0/17,1 ms | ≤25 ms | **Sí, con amplio margen** |
| 1.500 | 16,7 ms (las 3 rep.) | **17,0 ms (las 3 rep.)** | 33,3-33,4 ms | ≤40 ms | **Sí, con amplio margen** |

- **500 criaturas ahora cumple incluso el objetivo más estricto de "Alta" (p95 ≤22 ms) estando en calidad Ultra** — antes (C-09) 17,0 ms de mediana en p95; ahora 16,8-16,9 ms, la diferencia ya es ruido de medición.
- **1.500 criaturas: p95 consistente en las 3 repeticiones por primera vez** (antes, C-09: 33,4/50,0/33,4 ms) — ya no depende de en qué escalón de cuantización de fotogramas caiga la corrida.
- `longTasks` por corrida: 0-1 a 500 (antes 9-45), 0-4 a 1.500 (antes 33-37 tras C-09; 723-803 antes de C-09). `droppedSeconds` en 0 y `simulatedRealRatio` ≈1,000 en las 6 repeticiones.
- `renderCpuMs` p95: 6,8-9,7 ms a 500 (antes 14,1-15,7 ms sin este cambio); 12,8-14,0 ms a 1.500 (antes 23,4-26,4 ms tras C-09 solo).

Evidencia: `evidence/ultra-c10-quick-1500.json` (corrida de verificación rápida), `evidence/ultra-c10-clean-500.json`, `evidence/ultra-c10-clean-1500.json` (medición final).

**Conclusión de C-10 y de Fase C (escenario de paz medido):** ambos objetivos Ultra (500 y 1.500 criaturas) se cumplen de forma reproducible y con amplio margen en el escenario `mature-flat-peace` que se viene usando desde C-03. **Esto no cierra Fase C por completo** — la propia guía ya señalaba antes de esta sesión que el perfil maduro no sustituye conquista autónoma/combate prolongado, desastres, cambios de terreno en vivo, ciudades envejecidas 30-60 min real ni otras cámaras (ver "Pendientes para cerrar B/C" abajo, sin cambios). Rendimiento bajo guerra sostenida específicamente sigue sin medir con estas optimizaciones aplicadas.

## B-07/C-11 — rendimiento bajo guerra sostenida (completado, 10 de septiembre de 2026 ~13:15-14:00)

**Extensión del benchmark en vez de una herramienta nueva.** `tests/e2e/ultra-benchmark.spec.js` gana `WB3D_WAR=1`: activa la ley de diplomacia (`declareWar()`/`raiseSoldiers()` son no-op sin ella — `js/settlements.js`), declara guerra entre los dos imperios de `populateMatureWorld`, moviliza soldados en ambos bandos y aplica el mismo parche que `war-journey.spec.js` (`makePeace = () => false`) para que el sorteo de paz de `updateDiplomacy()` no termine la guerra antes de que acabe la ventana de medición. A diferencia de C-07–C-10, aquí no se controla manualmente la llegada de tropas ni se fuerza el asedio — el combate ocurre puramente por `runtime.update()` en cada fotograma, así que esto también sirve como prueba de resistencia de "conquista autónoma sostenida", no solo de rendimiento.

**Verificación antes de medir:** corrida corta (15 s calentamiento + 60 s muestra) a 1.500 confirmó combate real sin errores (8 bajas) y rendimiento sin cambio aparente frente a paz; corrida en modo paz sin `WB3D_WAR` revalidada para confirmar que la extensión no rompió el camino existente.

**Medición limpia (mismo protocolo de C-07/C-09/C-10, GPU confirmada, 3 repeticiones cada población, `WB3D_WAR=1`):**

| Población | Mediana | p95 | p99 | Objetivo p95 | Bajas por repetición | ¿Cambió de dueño alguna ciudad? |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 16,7 ms (las 3 rep.) | 16,9/17,0/17,0 ms | 17,0 ms (las 3 rep.) | ≤25 ms | 35, 47, 37 | No |
| 1.500 | 16,7 ms (las 3 rep.) | 17,0/**33,3**/17,0 ms | 17,1/33,4/19,0 ms | ≤40 ms | 23, 23, 33 | No |

- **Ambas poblaciones cumplen el objetivo Ultra con guerra activa, sin degradación medible frente al escenario de paz** (C-10: 500→16,8-16,9 ms; 1.500→17,0 ms constante). La 2ª repetición de 1.500 dio p95 33,3 ms — el mismo escalón de cuantización de fotogramas ya documentado, no una regresión (sigue muy por debajo de 40 ms).
- `longTasks` en 0 y `droppedSeconds` en 0 en las 6 repeticiones; `simulatedRealRatio` ≈1,000.
- **Bajas consistentes en las 6 corridas (23-47) confirman combate real y sostenido**, no una guerra declarada que queda inactiva.
- **Ninguna ciudad cambió de dueño en ninguna corrida** (150 s de partida: 30 s de calentamiento + 120 s de muestra). No es una falla — `tests/e2e/war-journey.spec.js` ya prueba que asedio→brecha→conquista→paz→reparación funcionan correctamente cuando se fuerzan (`_updateSieges(60)`); lo que esta corrida no confirma es que ese desenlace ocurra **de forma puramente autónoma** dentro de esa ventana de tiempo real. Podría ser simplemente que 150 s de partida real no alcanzan (un asedio puede tardar más en converger de forma natural) — no confirmado como problema, candidato a una corrida de duración mayor si se necesita esa confirmación específica.

Evidencia: `evidence/ultra-c11-war-smoke-1500.json` (verificación), `evidence/ultra-c11-war-clean-500.json`, `evidence/ultra-c11-war-clean-1500.json` (medición final).

**Conclusión:** el hueco de rendimiento bajo guerra en la tabla de objetivos de Fase C queda cerrado — ambas poblaciones cumplen con amplio margen. Desastres, cambios de terreno en vivo y ciudades envejecidas 30-60 min real siguen sin medir (rendimiento ni corrección) — ver "Pendientes para cerrar B/C" abajo, actualizado.

## Transporte económico de punta a punta (completado, 10 de septiembre de 2026 ~14:15-14:50)

**Qué faltaba, exactamente.** Una investigación previa a escribir código (agente de exploración, sin cambios de código) mapeó la economía completa y su cobertura existente: mina→ore/piedra→equipo (`tools`/`weapons`/`armor`) ya estaba bien cubierto (`tests/unit/civilization-phase4.test.js`); la salida de un barco de comercio (descuenta `goods` del origen) también (`tests/unit/ship-launches.test.js`). El hueco real y concreto: **nada comprobaba la llegada** del barco — que `destination.resources.goods` y el oro de ambas ciudades realmente se acrediten al desembarcar (`js/ships.js` → `_finishShip()`) — ni el tramo de producción (taller/herrería convirtiendo materia prima en bienes) junto con ese transporte.

**Nuevo test:** `tests/e2e/economy-transport.spec.js`. Dos ciudades costeras separadas por un canal de agua corto (mundo hecho a mano para garantizar muelle y ruta náutica reales, no el escenario `mature-flat` que es interior sin costa). Origen con un taller (`workshop`) y madera/piedra sembradas; destino con un mercado (`market`). Todo corre en vivo por `session.runtime.update()` — **el barco de comercio no se lanza a mano**: se deja que el propio temporizador autónomo de `ShipManager._tryServiceLaunch()` decida cuándo zarpar, igual que en una partida real. La prueba se limita a detectar el lanzamiento y la llegada, no a forzarlos.

Iteración durante el desarrollo (documentada para no repetir la investigación): el primer intento sembró las ciudades en nivel 3, lo que dejó que `_desiredBuilding()` (construcción automática) añadiera también un `market` en el propio origen — ese mercado competía por los mismos `goods` que el taller producía, y los bienes nunca llegaban a acumularse. Bajar el nivel de las ciudades a 1 excluye los edificios de `minLevel:2` (mercado, herrería, cuartel) de la construcción automática sin afectar los edificios añadidos a mano para la prueba.

**Recorrido verificado en una sola corrida en vivo:**
1. **Producción:** el taller convierte madera+piedra en `goods` con el tiempo (`civilization-system.js` → `_runProduction()`).
2. **Transporte autónomo:** `ShipManager` decide por su cuenta zarpar un barco de comercio real una vez hay `goods` suficientes — confirmado, no forzado.
3. **Llegada (el hueco real):** el destino recibe `goods` (`+= cargamento*0,65`) y ambas ciudades reciben oro (`origen += cargamento*0,7`, `destino += cargamento*0,15`) — confirmado con valores reales (`evidence` en el `testInfo.attach` del test, no un archivo aparte).
4. **Persistencia a mitad de camino:** guardar y recargar justo después de la llegada no pierde ni duplica los bienes recién recibidos (`goodsAfterReload` idéntico a antes de recargar, con tolerancia de punto flotante).
5. **Uso:** el mercado de destino convierte esos bienes importados en oro (`resources.gold` sigue subiendo tras el uso).
6. **Invariante en cada tick de todo el recorrido:** ningún recurso de ninguna ciudad se vuelve negativo.

Verificado 5 veces seguidas sin cambios (semilla fija, plenamente determinista) antes de darlo por bueno. Suite completa revalidada: 191/191 unitarios, 25/25 e2e (1 omitida).

**Conclusión:** cierra el hueco de "transporte económico de punta a punta" documentado en Fase B — extracción→producción→transporte→llegada→uso funcionan juntos, en vivo, de forma autónoma y sin fugas de recursos. Queda pendiente extender esta cobertura a escenarios con más de dos ciudades/rutas simultáneas y a la ruta de pesca (`_launchFishingShip`, ya cubierta por separado en `ship-launches.test.js` pero no en este recorrido combinado) si se necesita más adelante.

## Desastres y cambios de terreno en vivo — corrección (completado, 10 de septiembre de 2026 ~14:55-15:15)

**Qué faltaba, exactamente.** Investigación previa (agente de exploración, sin cambios de código): `tests/unit/phase6-7.test.js` ya cubre `detonate()`/`earthquake()`, pero contra un `world` completamente simulado (`terraform`, `igniteInRadius`, etc. son todos `vi.fn()` — nunca se toca terreno real). **Ningún test corría un desastre durante una ciudad activa y poblada** (nada estructuralmente parecido a `war-journey.spec.js`/`economy-transport.spec.js` existía para esto). Tres huecos concretos adicionales: `_naturalDisaster()` (el disparador aleatorio autónomo, con sus 3 ramas: terremoto/incendio/meteorito) nunca se había ejecutado en ninguna prueba; la ley `naturalDisasters` (el interruptor que lo activa/desactiva) tampoco; y `js/vfx.js` (`tornado`/`lluvia ácida`) solo tenía una prueba de humo ("no lanza error al existir en el catálogo de la interfaz"), nunca de su daño/movimiento real.

**Nuevo test:** `tests/e2e/disaster-journey.spec.js`. Escena madura de 4 ciudades (`populateMatureWorld`), todo en vivo por `runtime.update()`. Recorrido:

1. **Terremoto** (`cataclysms.earthquake()`) cerca de una ciudad activa: deforma terreno real, daña casas (14→3) sin destruirla — sigue en la lista de asentamientos.
2. **Bomba** (`cataclysms.detonate()`): cráter adicional, más daño (3→2 casas), ciudad todavía en pie.
3. **Meteorito** (`world.meteorImpact()`, fuera de `CataclysmSystem`): impacto directo verificado por separado.
4. **Detonación final de radio grande** sobre la misma ciudad ya debilitada: la derriba por completo — confirma la rama `removeSettlement()` cuando pierde su última casa (`cataclysm-system.js` → `_damageBuildings()`), no solo el caso "sobrevive dañada".
5. **Tornado** (`vfx.spawnTornado()`/`updateTornadoes()`, sin cobertura previa de daño real): 8 s simulados cerca de otra ciudad — casas reducidas (14→10), sin errores.
6. **Lluvia ácida** (`vfx.applyAcidRain()`, ídem): daño instantáneo confirmado en 33 criaturas dentro del radio.
7. **`_naturalDisaster()` — sus 3 ramas nunca ejecutadas en ninguna prueba:** forzadas una por una fijando `Math.random()` a un valor conocido antes de cada llamada (restaurado después) en vez de confiar en el temporizador de 100-240 s — confirmado que la rama de terremoto deforma terreno real, y que las 3 ramas corren sin lanzar error.
8. **Ley `naturalDisasters` — el interruptor en sí, nunca probado:** con la ley apagada y el temporizador casi en cero, `update()` no lo reinicia (confirma el corte temprano en `cataclysm-system.js:84`); con la ley encendida, sí se reinicia a 100-240 s.
9. **Persistencia a mitad de desastre:** una mina armada y el temporizador de desastre a mitad de cuenta sobreviven guardar/recargar sin perderse ni duplicarse.
10. **Invariante en cada tick de todo el recorrido:** ningún recurso se vuelve negativo/no-finito y ninguna criatura termina con posición o salud `NaN` — el `world.navigationRevision` sube (confirma que la invalidación de navegación sí se dispara tras los cambios de terreno).

Verificado 5 veces seguidas sin cambios (semilla fija, plenamente determinista). Suite completa revalidada: 191/191 unitarios, 26/26 e2e (1 omitida).

**Conclusión:** cierra la mitad de corrección de "desastres y cambios de terreno en vivo". Falta la mitad de rendimiento — ver medición de C-12 abajo.

## C-12 — rendimiento bajo carga de desastres sostenida (completado, 10 de septiembre de 2026 ~15:20-16:00)

**Extensión del benchmark, mismo patrón que `WB3D_WAR` (B-07/C-11).** `tests/e2e/ultra-benchmark.spec.js` gana `WB3D_DISASTERS=1`: activa la ley `naturalDisasters` y fuerza una secuencia rotativa de desastres moderados (terremoto → bomba → meteorito → terremoto) sobre las 4 ciudades de la escena madura, uno cada 20 s simulados, empezando en t=0 (activo durante el calentamiento también, igual que la guerra) en vez de esperar al temporizador autónomo de `_naturalDisaster()` (100-240 s, con probabilidad real de no disparar ni una vez dentro de la ventana de muestra). Magnitud elegida para dañar sin arrasar cada ciudad en un solo golpe — el objetivo es medir carga *sostenida*, no que una ciudad desaparezca a mitad de la corrida y reduzca la población/complejidad que se está midiendo.

**Medición limpia (mismo protocolo que C-07/C-09/C-10/C-11, 3 repeticiones cada población, GPU confirmada):**

| Población | Mediana | p95 | p99 | Objetivo p95 | Bajas por desastre | Casas restantes |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 16,7 ms (las 3 rep.) | 17,0 ms (las 3 rep.) | 17,0 ms (las 3 rep.) | ≤25 ms | — | 44/56 (las 3 rep., idéntico) |
| 1.500 | 16,7 ms (las 3 rep.) | 17,0/**33,3**/17,0 ms | 17,1/33,4/33,3 ms | ≤40 ms | — | 44/56 (las 3 rep., idéntico) |

- **Ambas poblaciones cumplen el objetivo Ultra bajo desastres sostenidos, sin degradación medible frente a paz o guerra** — los mismos números que ya se venían viendo (17,0 ms constante, con el mismo escalón ocasional de cuantización de fotogramas a 33,3 ms en 1.500, ya documentado, no algo nuevo de los desastres).
- **8 desastres forzados por corrida en las 6 repeticiones** (30 s de calentamiento + 120 s de muestra ÷ 20 s + el disparado en t=0), **44 de 56 casas restantes, idéntico en las 6** — confirma que los desastres realmente corrieron y dañaron de forma consistente, sin depender del azar.
- **Hallazgo nuevo, honesto y menor: los desastres causan micro-cortes de fotograma puntuales, invisibles en los percentiles pero reales.** 3 `longTasks` por corrida en las 6 repeticiones (antes 0 en paz, 0 en guerra a 500, 0-4 en guerra a 1.500), de 101-154 ms cada uno — coincide con el momento exacto de cada impacto grande (reconstrucción de malla de terreno + tormenta de recálculo de rutas por la invalidación de navegación). A 1.500, esto se traduce en `droppedSeconds` de 0,066-0,083 s por corrida de 150 s (~0,05 % del tiempo total) — la primera vez que aparece un valor de `droppedSeconds` distinto de cero en toda esta cadena de mediciones (C-07 a C-11 siempre dieron 0). `simulatedRealRatio` se mantiene en 0,999 en las 6 repeticiones, muy por encima del objetivo ≥0,95 — el efecto es real pero minúsculo en términos absolutos, no un problema de presupuesto de fotograma.

Evidencia: `evidence/ultra-c12-disasters-smoke-1500.json` (verificación), `evidence/ultra-c12-disasters-clean-500.json`, `evidence/ultra-c12-disasters-clean-1500.json` (medición final).

**Conclusión:** cierra la mitad de rendimiento de "desastres y cambios de terreno en vivo" — Fase C no necesita ningún arreglo adicional para sostener el objetivo Ultra bajo desastres. El único hallazgo (micro-cortes puntuales de 100-150 ms en el momento exacto de cada impacto) queda documentado como algo a tener en cuenta si se reporta una sensación de "tirón" perceptible durante desastres reales en juego, pero no bloquea el cierre de este pendiente — su efecto acumulado (0,05 % del tiempo) está muy por debajo de cualquier objetivo medido.

## Conquista autónoma confirmada (completado, 12 de septiembre de 2026 ~13:00-13:45)

**La pregunta abierta por B-07/C-11:** ¿150 s de guerra sostenida simplemente no alcanzan, o la conquista autónoma está estructuralmente bloqueada? Investigado antes de escribir código (agente de exploración, sin cambios): `army.order='siege'` se fija de inmediato al declarar guerra, pero el asedio real solo avanza cuando ≥2 soldados están a ≤7 unidades del centro de la ciudad (`_updateSieges`, `civilization-system.js`); `_decideSoldier` (`creatures.js`) hace que un soldado persiga cualquier civilizado enemigo a ≤10 unidades, lo que puede distraerlo de converger en el objetivo; y la captura final exige que esa zona de 7 unidades quede con **cero defensores vivos, incluidos civiles** — una barra alta para el tamaño de fuerza natural que usó B-07/C-11 (`raiseSoldiers()` solo moviliza 2-4 aldeanos por llamada, y esa fue la única llamada que hizo el benchmark).

**Diagnóstico empírico antes de comprometer una conclusión:** en vez de asumir cuál de las dos hipótesis era cierta, se corrió un experimento aislando la única variable sospechosa (tamaño de fuerza) sin tocar ningún mecanismo del juego — `raiseSoldiers()` llamado 25 veces seguidas en vez de una sola vez (sigue siendo la función real de movilización, sin atajos), dejando todo lo demás (marcha, decisión de combate, proximidad de asedio, ruptura de muros, limpieza de defensores, captura) correr puramente por `runtime.update()`. Resultado con 88 soldados movilizados: **la ciudad cayó sola en 2 minutos simulados** — 15 atacantes cerca del objetivo en el minuto 1 (asedio en 19,6 de salud), defensores caen a 0 y muros se rompen en el minuto 2, cambio de dueño confirmado. Repetido 3 veces, idéntico en las 3 (semilla fija).

**Conclusión: confirmado que la conquista autónoma funciona de punta a punta sin ninguna fase forzada** — el bloqueo de B-07/C-11 era tamaño de fuerza insuficiente (2-4 soldados vs. cientos de residentes defendiendo), no un problema estructural de la IA o los mecanismos de asedio/captura. Nuevo test permanente `tests/e2e/autonomous-conquest.spec.js`: mismo patrón de movilización real (sin tocar mecanismos), 15 minutos simulados de margen (la caída real ocurrió en 2), con invariante de recursos válidos en cada tick y verificación explícita de que la ciudad cambió de dueño (no que simplemente desapareció por otra vía). Verificado 4 veces (1 + 3 repeticiones) sin cambios.

**No se tocó `_decideSoldier` ni ningún otro mecanismo de combate/asedio** — el hallazgo no requirió ni sugiere un arreglo de balance; la IA converge, rompe muros y limpia defensores correctamente dado un ejército del tamaño adecuado. Queda como posible trabajo de diseño de juego (no de esta guía de corrección) si se decide que las guerras deberían resolverse con fuerzas más pequeñas/naturales en partidas reales — eso es una decisión de balance, no un bug confirmado.

## Pendientes para cerrar B/C

Ciudades envejecidas durante 30–60 minutos reales (rendimiento y corrección); otras cámaras y comparación de costes CPU/GPU. El perfil maduro no sustituye estos recorridos. No declarar B/C completas ni pasar a D por tener una suite corta aprobada.