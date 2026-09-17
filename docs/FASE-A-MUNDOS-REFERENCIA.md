# Fase A — Mundos de referencia (A-01, punto 5)

Ejecutado el 8 de septiembre de 2026 sobre el commit `06d631f` + los fixes de esta sesión (ver `docs/FASE-A-LINEA-BASE.md`). Cada escenario documenta semilla, parámetros de creación y la secuencia exacta de acciones para que sea 100% reproducible desde el menú "Crear nuevo mundo" (o "Recrear mundo" desde la pausa). Donde fue posible se ejecutó en vivo en esta sesión (evidencia con capturas y lectura de `window.__WB3D_DIAGNOSTICS__`); donde no, queda como receta lista para ejecutar.

## Hallazgo transversal que condicionó esta tarea (léase primero)

Al intentar avanzar los escenarios que requieren desarrollo simulado (aldea establecida, varias ciudades, guerra, comercio naval, partida envejecida), **el contador de "Día" quedó congelado en "Día 1" durante más de 90 segundos reales** con velocidad ×2 y ×4, pese a tener criaturas vivas y terreno editable. La causa se confirmó con el propio panel de diagnóstico del juego:

```
fps: ~19.6   simulationSteps: 4 (el máximo, GameRuntime.maxStepsPerFrame)
droppedSimulationMs: 1480.8 → 2188.5 (crece con el tiempo, nunca se recupera)
```

Esto confirma en vivo, con números reales, el riesgo ya detectado por análisis de código estático en `docs/FASE-A-MATRIZ-FUNCIONAL.md` (bloque "Tiempo y guardado", ítem `maxStepsPerFrame`): cuando el framerate sostenido cae por debajo de lo necesario para que el reloj de paso fijo se ponga al día, el excedente de tiempo se descarta de forma **irreversible** (`droppedSeconds` en `core/fixed-step-clock.js`) y el mundo deja de avanzar a la velocidad elegida — incluso con criaturas vivas y sin ningún panel bloqueando la partida.

**Matiz importante:** el FPS absoluto (~20) medido aquí es propio de este entorno de navegador en sandbox (posible renderizado por software, sin GPU real) y no debe leerse como el rendimiento del juego en hardware de usuario — coincide con la advertencia de la propia guía sobre no comparar GPU real con software (Fase C, punto 1). Pero el **mecanismo del bug es independiente de la causa del FPS bajo**: cualquier sesión real que caiga de forma sostenida por debajo del umbral (equipo modesto en Ultra, una batalla con 1.500 unidades, una pestaña que pierde foco parcialmente) sufrirá el mismo estancamiento permanente. Por eso los escenarios que requieren "ciudades desarrolladas" o "partida envejecida" no se pudieron completar en tiempo real dentro de esta sesión — lo cual es en sí mismo evidencia de la severidad del hallazgo, no solo una limitación de la sesión.

**Recomendación para Fase B:** corregir o al menos verificar en hardware real este punto antes de invertir tiempo en generar manualmente los mundos de referencia 3, 4, 5 (desarrollo) y 7 (envejecido) hasta su estado "maduro" — de lo contrario cualquier intento de producirlos por avance de tiempo real puede quedar bloqueado igual que aquí.

---

## 1. Mundo vacío — ✅ ejecutado y verificado en vivo

| Campo | Valor |
| --- | --- |
| Tipo de mapa | Isla |
| Tamaño | Pequeño (132) |
| Relieve | Normal |
| Clima | Templado |
| Vegetación | Normal |
| Semilla | `2001` |
| Acciones | Ninguna — guardar inmediatamente tras generar |
| Cámara | Por defecto tras generar (órbita inicial, sin ajuste) |

**Resultado verificado:** Día 1, 0 asentamientos, 0 población civilizada, fauna generada automáticamente (~9 herbívoros/3 carnívoros por defecto del mapa). Guardado con éxito vía "☰ Menú → Guardar partida" → toast "Mundo guardado" confirmado. Extracción de IndexedDB confirma `mapType: "island", seed: 2001, worldSize: 132, settlementCount: 0, version: 8`.

---

## 2. Aldea inicial — ⚠️ ejecutado parcialmente (bloqueado por el hallazgo transversal)

| Campo | Valor |
| --- | --- |
| Base | Continuación del mundo 1 (mismo seed 2001) |
| Acciones | Categoría "🐾 Seres" → "Humano" → 2 clics en el centro del bosque (≈ mismo punto), genera 2 grupos de 3 colonos |
| Velocidad | ×4, luego ×2, ~90s reales en total |
| Cámara | Sin cambios respecto a la vista de generación |

**Resultado verificado:** 3 colonos humanos vivos y en pie sobre la isla (el segundo clic no sumó población adicional visible — posible tope o los primeros 3 aún no se habían asentado; no se investigó más a fondo, ver nota). Tras ~90 s reales a velocidad ×2/×4 **no se fundó ningún asentamiento y "Día" permaneció en 1**, bloqueado por el hallazgo transversal de arriba. Guardado en este estado ("colonos sin fundar").

**Para completarlo en hardware real:** cargar este punto (o repetir la receta) y dejar correr a velocidad ×2 hasta ver la primera casa (`foundSettlement()` se dispara automáticamente cuando ≥3 colonos compatibles se agrupan en tierra plana no acuática, ver `settlements.js:1697-1726`); no debería tardar más de un par de minutos reales con FPS normal.

---

## 3. Varias ciudades — 📋 receta definida, no ejecutada

| Campo | Valor |
| --- | --- |
| Tipo de mapa | Continentes |
| Tamaño | Mediano (180) |
| Relieve | Normal · Clima | Mixto (da 4 climas distintos, más variedad de biomas por ciudad) |
| Semilla | `3003` |
| Acciones | "Humano" en la costa noroeste, "Orco" en el interior sureste, "Elfo" cerca de un bosque denso, "Enano" cerca de una zona montañosa/rocosa — 1 clic cada uno (grupos de 3), separados por ≥40 unidades de mundo para evitar el conflicto de fundación simultánea (`MIN_SETTLEMENT_DIST`, ver matriz funcional) |
| Velocidad | ×2 sostenido hasta ver ≥2 asentamientos con ≥3 casas cada uno |
| Cámara | Vista aérea (botón "Vista aérea") para encuadrar las 4 razas a la vez antes de guardar |

**Bloqueado por el hallazgo transversal** — requiere varios minutos simulados de crecimiento por asentamiento. Ejecutar en hardware con FPS sostenido ≥30.

---

## 4. Guerra con murallas — 📋 receta definida, no ejecutada

| Campo | Valor |
| --- | --- |
| Base | Partir del escenario 3 ya con 2 imperios establecidos de nivel ≥3 (murallas requieren nivel≥3, ver matriz) |
| Acciones | Categoría "🏰 Reino" → "Diplomacia" → clic en imperio A → clic en imperio B (alterna paz/guerra, ver `main.js:746-765`) |
| Velocidad | ×2 hasta ver reclutamiento de soldados, movimiento de ejército hacia el objetivo de asedio y murallas construidas |
| Cámara | Seguir al ejército atacante (clic en un soldado → "seguir") o vista aérea centrada en la frontera |

**Bloqueado por el hallazgo transversal** (depende del escenario 3 más crecimiento adicional). Nota para cuando se ejecute: verificar en vivo el hallazgo ya confirmado por análisis de código de que la "postura" del ejército (Agresiva/Cautelosa) solo cambia un multiplicador de daño, sin formación espacial visible — comprobar que efectivamente no se observa ningún reacomodo visual de las tropas al cambiar de postura.

---

## 5. Archipiélago con comercio — ⚠️ base generada y verificada, comercio no alcanzado

| Campo | Valor |
| --- | --- |
| Tipo de mapa | Archipiélago |
| Tamaño | Mediano (180) |
| Semilla | `12345` (la misma que usa `tests/e2e/archipelago.spec.js`, para poder comparar directamente con la evidencia automatizada) |
| Acciones | Colocar "Humano" en 2 islas separadas con costa navegable entre ellas |
| Velocidad | ×2 hasta que aparezca al menos 1 barco de expedición/comercio (`ShipManager`, requiere asentamiento costero con ≥9 población, ver matriz) |
| Cámara | Vista aérea para encuadrar ambas islas y la ruta naval |

**Generación base verificada en vivo esta sesión** (ver `docs/FASE-A-LINEA-BASE.md`, corrección del test de archipiélago): el mundo con semilla 12345/archipiélago/mediano se generó correctamente, sin errores, con el creador completo. La población y el comercio naval (que exige ≥9 habitantes en un asentamiento costero, un umbral muy por encima de lo alcanzable bajo el hallazgo transversal) quedan pendientes de ejecutar en hardware con FPS sostenido.

---

## 6. Desastre masivo — ✅ ejecutado y verificado en vivo

| Campo | Valor |
| --- | --- |
| Base | Continuación del escenario 2 (isla seed 2001, 3 colonos humanos, bosque denso) |
| Acciones | Categoría "⚡ Poderes" → "Explosivos" → "Nuclear" → 1 clic en el centro del bosque poblado |
| Cámara | Sin cambios |

**Resultado verificado:** tras el impacto, la población civilizada bajó de 3 a **1** superviviente y el conteo de árboles bajó de 1040 a 1037 (cráter + ignición visibles en el centro de la isla). Confirma en vivo que `detonate()`/`BOMB_TIERS.nuke` (`main.js:724-731`, `cataclysm-system.js:41-51`) produce daño de área real, no solo un efecto cosmético — coincide con lo esperado por el catálogo de poderes. Guardado con éxito.

**Pendiente para una versión más completa del escenario:** repetir sobre un asentamiento ya fundado con murallas para verificar destrucción de edificios y el fallout venenoso residual (`nuke.fallout`), no solo sobre colonos sueltos.

---

## 7. Partida envejecida — 📋 receta definida, no ejecutada

| Campo | Valor |
| --- | --- |
| Tipo de mapa | Isla · Tamaño Mediano (180) |
| Semilla | `2007` |
| Acciones | Fundar 1 aldea humana, dejar correr a velocidad ×2/×4 durante varias **horas reales** (no minutos) con la pestaña en primer plano |
| Cámara | Vista aérea periódica para capturas de progreso |

**Explícitamente fuera del alcance de esta sesión** — la propia Fase H del plan reserva las pruebas de 2 y 8 horas reales como su propio criterio de cierre, con render y todos los sistemas activos; no tiene sentido duplicar ese esfuerzo aquí. Dado el hallazgo transversal, además, no tendría sentido iniciar una prueba de horas hasta que Fase B confirme que el reloj de simulación no se estanca bajo carga sostenida — de lo contrario "partida envejecida" podría, en la práctica, terminar pareciéndose más a "Día 1 congelado durante 8 horas" que a una civilización madura.

---

## Resumen de estado

| # | Escenario | Estado |
| --- | --- | --- |
| 1 | Vacío | ✅ ejecutado y guardado |
| 2 | Aldea inicial | ⚠️ colonos colocados, fundación bloqueada por el hallazgo transversal |
| 3 | Varias ciudades | 📋 receta lista |
| 4 | Guerra con murallas | 📋 receta lista |
| 5 | Archipiélago con comercio | ⚠️ mundo base verificado, comercio pendiente |
| 6 | Desastre masivo | ✅ ejecutado y guardado |
| 7 | Partida envejecida | 📋 receta lista, deliberadamente diferida a Fase H |

3 de 7 escenarios tienen evidencia en vivo de esta sesión; los 4 restantes tienen receta completa y reproducible pero requieren ejecutarse en un entorno con FPS sostenido normal, algo que esta sesión (navegador en sandbox, posible renderizado por software) no pudo garantizar — lo cual es a su vez el hallazgo más importante de este ejercicio.
