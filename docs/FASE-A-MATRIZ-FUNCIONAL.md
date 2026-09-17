# Fase A — Matriz funcional (A-02)

Auditoría de código estático realizada el 8 de septiembre de 2026 sobre el commit `06d631f`. **Esto NO es una verificación en vivo**: es lectura de código y cruce con pruebas automatizadas existentes. Ningún estado de esta tabla debe leerse como "probado jugando" hasta que se complete un recorrido manual en navegador (pendiente, ver `docs/FASE-A-LINEA-BASE.md`).

Estados usados: **código completo + test específico** / **código completo, sin test directo** / **parcial** / **sospechoso de bug** / **posible placeholder o ausente**.

---

## Poderes divinos y cataclismos (52 poderes del catálogo `power-system.js`)

| Poder(es) | Comportamiento esperado | Archivo:línea de implementación | Límites/coste/radio | Evidencia de test | Estado inferido |
|---|---|---|---|---|---|
| `inspect` | Muestra info de criatura/casa/imperio bajo cursor o bioma/temperatura/altura/mineral de la celda | `main.js:1533-1552` (`inspectAt`), dispatch `main.js:773-775` | Sin radio (puntual) | e2e `game.spec.js:150-177` (click humo, sin error) | código completo, sin test directo de contenido |
| `raise` / `lower` | Sube/baja terreno con pincel | `main.js:611-612` → `world.terraform()` `world.js:1586` | radio = `brushSize`, delta ±0.9 | e2e smoke test | código completo, sin test específico |
| `water` | Inunda la zona con agua | `main.js:613` → `world.floodWater()` `world.js:1674` | radio = `brushSize` | e2e smoke test | código completo, sin test específico |
| `tree` (Bosque) | Planta árboles en el área | `main.js:614` → `world.plantTreesInRadius()` `world.js:1736` | radio = `brushSize*0.8` | e2e smoke test | código completo, sin test específico |
| `biome_forest` / `biome_dry` / `biome_swamp` | Pinta bioma (humedad objetivo) | `main.js:615-617` → `world.paintBiome()` `world.js:1709` | radio = `brushSize`, moisture 0.92/0.04/0.9 | e2e smoke test | código completo, sin test específico |
| `fire` | Incendia vegetación del área | `main.js:618` → `world.igniteInRadius()` `world.js:1740` | radio = `brushSize*0.8` | e2e smoke test | código completo, sin test específico |
| `rain` | Inicia lluvia global temporal | `main.js:619-622` → `world.startRain(24)` `world.js:1288` | duración fija 24s | e2e smoke test | código completo, sin test específico |
| `frost` (Congelar) | Enfría terreno + aplica estado `frozen` | `main.js:623-626` → `world.applyCold()` + `statuses.applyInRadius(...,'frozen')` `status-system.js:67` | radio = `brushSize*1.2`, amount 38 | ninguna directa; `frozen` no cubierto en `phase6-7.test.js` (a diferencia de blessed/shielded/poisoned) | código completo, sin test directo |
| `heat` (Calentar) | Sube temperatura del terreno | `main.js:627` → `world.applyHeat(...,false)` | radio = `brushSize*1.2`, amount 32 | e2e smoke test | código completo, sin test específico |
| `lava` | Calienta a punto de lava + mata criaturas cercanas | `main.js:628-631` → `world.applyHeat(...,85,true)` + `creatures.killAllInRadius()` | radio calor `brushSize` / muerte `brushSize*0.35` | e2e smoke test | código completo, sin test específico |
| `erase` (Borrar) | Elimina criaturas/árboles/casas en radio; despuebla si queda sin casas | `main.js:732-745` | radio = `brushSize*0.5` | e2e smoke test | código completo, sin test específico |
| `lightning` (Rayo) | Incendia punto + mata criaturas + VFX | `main.js:632-637` → `igniteInRadius` + `killAllInRadius` + `vfx.flashLightning()` | radio fijo 1.2/1.3 | e2e smoke test | código completo, sin test específico |
| `meteor` | Cráter + incendio + muerte + VFX | `main.js:638-641` → `world.meteorImpact()` `world.js:1752-1754` | radio impacto `brushSize` / muerte `brushSize*1.2` | también usado por `_naturalDisaster` (`cataclysm-system.js:71`) sin test directo | código completo, sin test específico |
| `spawn_herb/carn/boar/bear` | Genera fauna vía `creatures.spawn()` | `main.js:643-655` (helper `spawnGroup` `main.js:602-609`) | cant. 2-3, spread 1.5, toast si límite alcanzado | `wildlife-cap.test.js` cubre el límite de población (indirecto) | código completo, sin test directo del poder |
| `spawn_fish` | Igual, exige agua bajo cursor | `main.js:649-653` | cant. 4, spread 1.1 | e2e smoke test | código completo, sin test específico |
| `spawn_human/orc/elf/dwarf` | Genera civilizaciones jugables | `main.js:656-667` | cant. 3, spread 1.5 | `founding-and-hunger.test.js`, `civilization-phase4/5.test.js` cubren fundación (no el poder en sí) | código completo, sin test directo del poder |
| `spawn_dragon/demon/skeleton/mage/fairy/ghost/alien`, `zombie` | Genera criaturas de fantasía/no-muertos | `main.js:668-674`, `701-703` | cant. 1-3 | e2e smoke test | código completo, sin test directo |
| `control` (Poseer) | Toma/suelta control directo de criatura | `main.js:1514-1531` (`tryPossessAt`) | sin radio | e2e smoke test | código completo, sin test directo |
| `heal` (Bendecir) | Cura + estado `blessed` | `main.js:675-678` | radio = `brushSize` | `phase6-7.test.js:50-62` testea `blessed` en `StatusSystem` directamente | código completo + test del estado subyacente (no del dispatch) |
| `poison` | Aplica `poisoned` (daño por turno) | `main.js:679` | radio = `brushSize` | `phase6-7.test.js:50-62` | código completo + test del estado |
| `shield` | Aplica `shielded` (vida bonus) | `main.js:680` | radio = `brushSize` | `phase6-7.test.js:50-62,77-89` (incluye soak de 8h) — el más cubierto | código completo + test específico |
| `madness` (Locura) | Aplica `madness` (movimiento errático) | `main.js:681` | radio = `brushSize` | ninguna directa (solo en catálogo `STATUS_DEFINITIONS`) | código completo, sin test directo del efecto |
| `curse` (Maldición) | Aplica `cursed` (penaliza daño/velocidad) | `main.js:682` | radio = `brushSize` | ninguna directa (no en `phase6-7.test.js`) | código completo, sin test directo del efecto |
| `clone` | Clona hasta 4 copias conservando traits/genoma | `main.js:683-696` | radio = `brushSize`, amount `clamp(round(brushSize/2),1,4)` | e2e smoke test | código completo, sin test directo del comportamiento |
| `plague` | Infecta criaturas del área | `main.js:697-700` → `creatures.infectInRadius()` | radio = `brushSize` | e2e smoke test | código completo, sin test directo |
| `tornado` | Tornado móvil: daña, tala árboles, destruye casas | `main.js:704-707` → `vfx.spawnTornado/updateTornadoes` `vfx.js:88-143` | vida 16-24s, radio daño ~1.8-2 | e2e smoke test (solo "no lanza error") | código completo, sin test directo de daño/movimiento |
| `acidrain` | Daña 50% vida máx. + destruye árboles | `main.js:708-711` → `vfx.applyAcidRain()` | radio = `brushSize*1.3` | e2e smoke test | código completo, sin test directo |
| `magnet` (Imán) | Atrae criaturas cercanas | `main.js:712-713` → `creatures.pullInRadius()` | radio = `brushSize*1.3` | e2e smoke test | código completo, sin test directo |
| `earthquake` | Deforma terreno, daña criaturas, destruye edificios | `main.js:715-719` → `cataclysms.earthquake()` `cataclysm-system.js:53-62` | radio = `brushSize*2.2` | ninguna directa del método | código completo, sin test directo |
| `landmine` | Mina que arma en 2s y detona al pasar una criatura | `main.js:720-723` → `cataclysms.placeMine()` | requiere terreno firme | `phase6-7.test.js:64-73` testea armado + detonación | código completo + test específico |
| `bomb/tnt/megabomb/nuke/antimatter` | Cráter + ignición + daño + destrucción; `nuke` deja fallout venenoso | `main.js:724-731` → `cataclysms.detonate()`; tiers en `power-system.js:56-62` | radios crecientes 0.5→6.2 | `phase6-7.test.js:31-47` solo valida el catálogo `BOMB_TIERS`, no invoca `detonate()` por tier | **parcial** — catálogo testeado, `detonate()` no cubierto de forma aislada |
| `diplomacy` | Selecciona 2 imperios con clics sucesivos, alterna guerra/paz | `main.js:746-765` → `settlements.declareWar/makePeace` | radio detección fijo 30 | e2e smoke test (un clic, no verifica flujo de 2 clics) | código completo, sin test directo del flujo completo |
| Cataclismos naturales opcionales | Evento aleatorio cada 100-240s si `laws.naturalDisasters !== false` | `cataclysm-system.js:64-73,84-89` | desactivable por ley | `phase6-7.test.js:76-89` **desactiva explícitamente** esta rama para el test de 8h | código completo, **nunca ejercitado por ningún test** |

**Riesgos detectados en este bloque:** los 52 poderes tienen implementación real localizable — ninguno es un placeholder vacío. El único cobertor transversal es un e2e que solo detecta excepciones al activar cada poder, no corrección de efecto (radios, daño, duración). `madness`, `cursed` y los métodos `earthquake()`/`detonate()` (usados por 5 poderes de explosivos) carecen de test unitario directo pese a su complejidad. Los cataclismos naturales aleatorios están explícitamente apagados en la única prueba de estabilidad prolongada, así que 8h simuladas nunca ejercitan ese camino.

---

## Mundo y terreno

| Función | Comportamiento esperado | Archivo:línea | Datos persistidos | Evidencia de test | Estado inferido |
|---|---|---|---|---|---|
| `generateBaseTerrain()` — altura base por tipo de mapa (island/continents/ring) | fBm + warp + falloff radial/anular según `mapType`, exponente `mountainExp` según `mountainLevel` | world-generation.js:96-177 | `world.height` | `creator-options.test.js:6-13` (solo compara máx. altura entre mountainLevel 0 vs 2) | código completo, sin test directo de la forma/falloff específica |
| `placeArchipelago()` / `archipelagoHeight()` | Islas de archipiélago separadas por canales | world-generation.js:29-94 | `world.height` | `archipelago.test.js:24-67`, `archipelago.spec.js:3` (e2e, **falla**, ver línea base) | código completo + test unitario específico |
| Compresión de relieve en preset "llano" (`mountainLevel===0`) | Aplana el interior sobre `waterLevel+1` a factor 0.24 | world-generation.js:166-168 | `world.height` | ninguna | **sospechoso de bug/limitación**: comprime la altura máxima muy por debajo del umbral `alpine` (world.js:425) — confirma que en mapas planos el bioma alpino es prácticamente inalcanzable |
| Ruido de humedad independiente de la altura | `moistNoise.fbm` da variedad de bioma sin depender del relieve | world-generation.js:172-174 | `world.moisture` | `creator-options.test.js:14-31` | código completo + test indirecto (mitiga parcialmente el problema anterior) |
| `regionalClimate()` — clima "mixto" en 4 cuadrantes | Divide el mapa en ártico/templado/tropical/árido por ángulo | world-generation.js:6-11 | derivado, no persistido | `creator-options.test.js:14-31` | código completo + test específico |
| Generación vía Web Worker (`generateAsync`) | Delega a `world-generation.worker.js` con fallback síncrono | world.js:358-375 | — | ninguna | código completo, sin test — ruta usada en producción sin cobertura de equivalencia con el camino síncrono |
| `_classifyBiome()` | Clasifica bioma por altura/temperatura/humedad/pantano | world.js:418-438 | `world.biome`, `world.ice`, `world.danger` | `world-phase3.test.js:28-33` (solo valida ≥4 biomas, no cada umbral) | código completo, sin test directo de cada regla |
| `refreshEcologyAt()` | Actualización incremental de bioma en un punto | world.js:440-449 | — | ninguna, **y sin llamador localizado en el código actual** | **parcial/sospechoso** — posible función huérfana |
| `traceRiver()` / `carveRivers()` / `buildRiverMesh()` | Trazado A* descendente de ríos, tallado de cauces/lagos, malla visual sin grietas | river-routing.js:37-71, world.js:518-679 | `world.riverMask`, `riverHeight`, `moisture` | `rivers.test.js` (completo), `rivers.spec.js:3` (e2e) | código completo + test específico |
| `floodWater()` | Inundación manual (poder de agua) | world.js:1673-1707 | `riverMask`/`riverHeight` | `rivers.test.js:61-77,124-133` | código completo + test específico |
| `applyHeat()` / `applyCold()` | Lava/hielo dinámicos, reclasifica bioma y navegación | world.js:1294-1339 | `lava`, `ice`, `temperature` | `world-phase3.test.js:35-46` | código completo + test específico |
| `generateMinerals()` | Distribución inicial de stone/gold/gems | world.js:465-481 | `mineralType`, `mineralAmount` | ninguna | código completo, sin test directo de distribución/proporciones |
| `mineNearest()` | Minería finita: agota depósito, no produce infinito | world.js:483-512 | `mineralType`/`mineralAmount` | `world-phase3.test.js:48-60` | código completo + test específico |
| `terraform()` | Edición runtime de altura (pincel elevar/bajar) | world.js:1586-1616 | `world.height` | `world-phase1.test.js:57-86` | código completo + test específico |
| `flattenArea()` / `markSettlementGround()` | Aplanado y marcado de plaza para asentamientos | world.js:1626-1671 | `world.height`, `settlementGround` | `settlement-ground.test.js:46-91` | código completo + test específico |
| `paintBiome()` | Pintado manual de humedad/pantano/vegetación | world.js:1709-1734 | `moisture`, `swampy` | `world-phase1.test.js:39-55` | código completo + test específico |
| `colorAt()` | Color de terreno por altura/humedad/bioma | world.js:836-855 | — (visual) | `landscape-camera.test.js:33-56` (indirecto vía césped) | parcial — sin test directo de la mezcla de color |
| `buildTerrainRoad()` | Proyección de caminos sobre malla real del terreno | terrain-roads.js:22-72 | — | `terrain-roads.test.js:27-60` | código completo + test específico |
| `reuseRoadNetwork()` | Red de caminos compartida entre rutas comerciales | road-network.js:7-58 | — | `road-network.test.js:9-63` | código completo + test específico |
| `NavigationGrid` (terreno) | Pathfinding A* con coste por pendiente/bioma/peligro | navigation.js:1-192 | — | `navigation.test.js:22-48` | código completo + test específico |
| `serialize()`/`restore()` del mundo | Persiste altura/humedad/bioma/temperatura/hielo/lava/minerales/ríos/árboles/clima/RNG | world.js:1921-2117 | Todo lo anterior | `world-phase3.test.js:85-102`, `rivers.test.js:124-133` | código completo + test específico |
| `_updateClimate()` | Lluvia dinámica, relajación de temperatura, apagado de lava/fuego bajo lluvia | world.js:1798-1850 | `_climateCursor`, `rainRemaining`, `_weatherTimer` | ninguna que ejercite el bucle en sí | código completo, sin test directo del bucle |

**Riesgos de este bloque:** el preset "llano" hace el bioma alpino matemáticamente inalcanzable (confirma la sospecha del plan); la generación por Web Worker (ruta real de producción), `generateMinerals()` y `_updateClimate()` no tienen test; `refreshEcologyAt()` parece código huérfano sin llamador.

---

## Vida, criaturas e IA/rutas

| Función | Comportamiento esperado | Archivo:línea | Evidencia de test | Estado inferido |
|---|---|---|---|---|
| `CREATURE_DEFINITIONS` (18 especies, stats base) | size/speed/maxAge/hungerRate/cap por tipo | creatures.js:8-35 | ninguna (constantes) | código completo, sin test directo |
| `spawn()` | Valida cap/límite global/agua-tierra y crea criatura + modelo 3D | creatures.js:369-387 | `wildlife-cap.test.js:33-58` (indirecto) | código completo, sin test directo del spawn en sí |
| `_effectiveCap()` | Cap de fauna escalado por área del mapa | creatures.js:358-367 | `wildlife-cap.test.js:32-58` | código completo + test específico |
| Hambre y daño por inanición | `_feedCreature()` incrementa hunger; a 100 inflige daño continuo | creatures.js:924-957 | `founding-and-hunger.test.js:73-98` | código completo + test específico |
| Forrajeo cuando la aldea no tiene comida | Fallback: el ciudadano busca comida por su cuenta | creatures.js:941-953 | `founding-and-hunger.test.js:73-98` | código completo + test específico |
| Reproducción salvaje (herbívoro/carnívoro/pez) | Condiciones de hunger/salud/edad en `_decide()` | creatures.js:715-754 | ninguna directa | código completo, sin test directo |
| Reproducción civilizada — matching de pareja | `_seekPartner()` camina hacia la pareja emparejada | creatures.js:695-704 | `reproduction-partner-seeking.test.js:44-80` | código completo + test específico |
| Gate de reproducción (vivienda/comida) | Exige asentamiento compartido, comida mínima y capacidad de vivienda | creatures.js:675-686 | `reproduction-partner-seeking.test.js:44-66` | código completo + test específico |
| Creación del bebé + herencia | `_tryReproduce()` hereda traits/genoma, aplica cooldowns y coste de comida | creatures.js:768-789 | `civilization-phase5.test.js:40-58` | código completo + test específico |
| Envejecimiento y muerte | `age += dt*0.06`; muerte por vejez o salud ≤0 | creatures.js:1018, 1146-1148, 508-522 | ninguna directa | código completo, sin test directo |
| Rasgos genéticos (`pickTraits`/`applyTraits`) | 0-2 rasgos aleatorios, 0.4% de inmortalidad | traits.js:18-35 | ninguna directa | código completo, sin test directo |
| Herencia de genoma (civilizados) | Mezcla de genoma de padres con mutaciones pequeñas | civilization-system.js:270-298 | `civilization-phase5.test.js:40-58` | código completo + test específico |
| Adaptación climática y subespecies emergentes | Deriva genética hacia frío/calor; clasifica subespecie por umbral | civilization-system.js:559-604 | `civilization-phase5.test.js:60-78` | código completo + test específico |
| A* tierra/agua | Bloquea agua no congelada para tierra y viceversa | navigation.js:81-106,123-164 | `navigation.test.js:23-47` | código completo + test específico |
| A* aire | No bloquea por navegación terrestre, solo penaliza lava/peligro | navigation.js:85,90,104 | ninguna directa | código completo, sin test directo |
| Cola de pathfinding con presupuesto anti-lag | Difiere búsquedas y limita nodos visitados por tick (8000) | navigation.js:60-79 | ninguna | código completo, sin test directo bajo presión |
| **Recuperación cuando el destino es permanentemente inaccesible** | Reintenta A* cada 0.8-1.25s mientras no haya plan | creatures.js:262-308 (esp. 273-295) | ninguna | **sospechoso de bug**: no hay contador de fallos ni abandono tras N intentos — una criatura cazando/persiguiendo un objetivo tras un obstáculo permanente (isla separada, muro sin puerta) queda "atascada" reintentando indefinidamente en vez de desistir y volver a vagar |
| Reintento tras cambio del mundo (muro/puerta/costa) | Compara `world.navigationRevision` para forzar replanificación | creatures.js:275,286 | ninguna directa | código completo, sin test directo |
| Índice espacial (vecinos) | Bucketiza por celda para pareja/presa/amenaza/hechizos | core/spatial-index.js:39-80 | `runtime-phase2.test.js:26-32` | código completo + test específico |
| LOD/instancing de criaturas lejanas | Alterna modelo detallado ↔ `InstancedMesh` por distancia/frustum | creatures.js:836-904,171-181 | ninguna en unit (no cubierto por graphics.test.js, que solo cubre césped) | código completo, sin test directo |
| Zombificación al matar un civilizado | 55% de probabilidad de nuevo zombie en esa posición | creatures.js:1065-1068,1153-1155 | ninguna | código completo, sin test directo |
| Serialización/restauración de criaturas | Excluye campos runtime (model3d, nav*), reconstruye modelo e índice espacial | creatures.js:1161-1275 | `civilization-phase5.test.js:101-120` (indirecto) | código completo + test específico (indirecto) |

**Riesgos de este bloque:** la recuperación de rutas ante un destino permanentemente inalcanzable no tiene mecanismo de abandono (bug de comportamiento, no de rendimiento — la criatura queda "atascada" persiguiendo indefinidamente); envejecimiento/muerte/forrajeo salvaje/zombificación/LOD están implementados pero sin ningún test unitario directo; la lógica de genes/adaptación vive en `civilization-system.js`, fuera de los archivos "core" de criaturas, dificultando auditar la coherencia entre ambos módulos.

---

## Asentamientos y economía

| Función | Comportamiento esperado | Archivo:línea | Evidencia de test | Estado inferido |
|---|---|---|---|---|
| `foundSettlement()` | Funda aldea garantizando ≥1 Agricultor entre fundadores | settlements.js:1645-1695 | `founding-and-hunger.test.js` | código completo + test específico |
| `_prepareSettlementGround()` | Aplana y limpia terreno al fundar/crecer | settlements.js:1763-1773 | `settlement-ground.test.js` | código completo + test específico |
| `addHouse()` | Coloca casa evitando agua/pendiente/solape propio | settlements.js:955-980 | `house-variants.test.js`, `settlement-ground.test.js` | **parcial** — no valida solape contra asentamientos vecinos |
| `_syncHouseInstance()` | Solo la variante ganadora recibe matriz real; resto "aparcadas" | settlements.js:907-953 | `house-variants.test.js` (bug de instancia fantasma corregido en `7f45cb2`) | código completo + test específico |
| `_syncDefenses()` / murallas y torres | Recalcula siempre el anillo completo; evita segmentos sobre vecinos &lt;8u | settlements.js:1240-1298 | `wall-models.test.js`, `wall-resize.test.js` | código completo + test específico |
| `abandonSettlement()` / `reclaimSettlement()` | Aldea sin población &gt;45s → ruina; reocupable conservando casas y **stock previo sin resetear** | settlements.js:1571-1643 | ninguna | parcial, sin test — `resources` no se limpia al abandonar |
| Tope de recursos (`RESOURCE_CAP_BASE`) | wood/food/stone/gold/gems topados; **ore/tools/weapons/armor/goods/fish nunca topados** | settlements.js:1860-1865 vs civilization-system.js:698-733 | ninguna | **sospechoso de bug**: acumulación ilimitada de recursos secundarios, inconsistente con el resto |
| `_runProduction()` (mina→herramientas/armas/armaduras) | Extrae mineral, produce con validación previa de stock (sin negativos) | civilization-system.js:698-733 | `civilization-phase4.test.js` | código completo + test específico |
| `world.mineNearest()` | Clampa extracción, imposibilita depósito negativo | world.js:500-512 | `civilization-phase4.test.js` | código completo + test específico |
| `_trySendMerchant()` / rutas comerciales | Carreta sigue nodos reales, solo si hay ruta terrestre | settlements.js:1498-1549 | `merchant-routes.test.js` | código completo + test específico |
| `captureSettlement()` (conquista) | Transfiere imperio; **conserva íntegro el stock de recursos del defensor** | settlements.js:2330-2366 | ninguna | parcial, sin test — riesgo de acumulación vía conquista repetida |
| `MIN_SETTLEMENT_DIST` | Distancia mínima cubre la suma de radios de muralla nivel-3 | settlements.js:11-20 | `wall-resize.test.js` (incluye bug histórico documentado) | código completo + test específico (bug ya corregido) |
| `serialize()`/`restore()` de asentamientos | Self-heal de variante de casa inválida y recursos negativos | settlements.js:1953-2192 | `house-variants.test.js`, `mine-serialize.test.js` | código completo + test específico |

**Riesgos de este bloque:** recursos secundarios (ore/tools/weapons/armor/goods/fish) sin tope, a diferencia de los primarios; abandono/conquista no tocan el stock de recursos (riesgo de acumulación no verificada como intencional); `addHouse()`/`addFarm()` no validan solape contra asentamientos vecinos (a diferencia de `addWall()`, que sí lo hace).

---

## Civilización, guerra, diplomacia y cultura

| Función | Comportamiento esperado | Archivo:línea | Evidencia de test | Estado inferido |
|---|---|---|---|---|
| `createEmpire()` | Funda imperio con relaciones `peace` iniciales con todos | settlements.js:779-790 | usado como setup en varios tests, sin test directo de sus propiedades | código completo, sin test directo |
| `ensureKing()` / `chooseHeir()` | Sucesión: hijo vivo → mejor del clan → fallback por edad | settlements.js:2220-2234, civilization-system.js:409-418 | `civilization-phase4.test.js:89-102` (solo `chooseHeir`) | parcial — el flujo completo `ensureKing()` no tiene test |
| `declareWar()` / `makePeace()` / `makeAlliance()` | Cambian relación, tensión, desmovilizan tropas según corresponda | settlements.js:2246-2290 | `army-orders.test.js:73-93`, `civilization-phase4/5.test.js` | código completo + test específico |
| `_syncArmies()` — orden de ejército y postura | Recalcula moral, aplica multiplicadores de postura, fija orden asedio/defensa | civilization-system.js:860-899 | `army-orders.test.js:37-58,103-119` | código completo + test específico |
| `retargetArmy()` / `standDownArmy()` | Cambia objetivo de asedio / fuerza retirada y paz | civilization-system.js:940-966 | `army-orders.test.js` | código completo + test específico |
| **`setArmyPosture()` — "formación" militar** | Equilibrada/Agresiva/Cautelosa | civilization-system.js:23-27,970-980; creatures.js:1057-1060 | `army-orders.test.js:103-147` (multiplicador de daño, no formación) | **confirmado, no es bug sino diseño limitado**: es solo un multiplicador de daño/defensa global por imperio — no hay formación espacial, flanqueo ni posicionamiento; el propio código lo señala en un comentario. Brecha real frente a la expectativa de "orden militar" |
| `_updateSieges()` — asedio | Reduce salud de asedio con ≥2 atacantes cerca; destruye muralla; captura si no hay defensores | civilization-system.js:901-924 | **ninguna** | parcial — lógica coherente pero sin ningún test que ejercite un asedio real |
| `captureSettlement()` — conquista | Cambia dueño, recolorea casas, reasigna soldados/rey | settlements.js:2330-2366 | ninguna directa (solo el evento resultante, indirectamente) | código completo, sin test directo de la conquista en sí |
| `_checkCaptureDir()` | Camino alternativo de captura sin pasar por asedio | settlements.js:2368-2383; `controlsSiegeFor()` civilization-system.js:926-928 | ninguna | **sospechoso de código muerto**: `controlsSiegeFor()` siempre devuelve `true`, por lo que esta función queda permanentemente inhabilitada sin explicación en el código |
| `rebellionSupport()` / `updateLoyalty()` / `rebel()` | Rebelión por lealtad baja + soporte de clan, 12%/tick de probabilidad | civilization-system.js:982-993, settlements.js:2445-2478 | **ninguna** | código completo, sin ningún test — sistema central de "rebelión" totalmente sin cobertura |
| `registerBirth()` / `inheritedGenome()` / `_applyGenome()` | Familias: hereda clan/cultura/idioma/religión/genoma | civilization-system.js:270-298,547-557 | `civilization-phase4/5.test.js` | código completo + test específico |
| `_ensureClans()` | Agrupa residentes en clanes (máx. 18), recalcula líder y prestigio | civilization-system.js:318-333,381-398 | `civilization-phase4.test.js:37-54,105-115` | código completo + test específico |
| `_ensureSocieties()` — culturas/idiomas/religiones emergentes | Comunidad por asentamiento, convergencia probabilística, cohesión | civilization-system.js:482-545 | `civilization-phase5.test.js:60-78` | código completo + test específico |
| `remember()` — memoria individual | Recuerdos con impacto clamp, máx. 10, decaimiento y purga | civilization-system.js:583-613 | `civilization-phase5.test.js:80-99,121-133` | código completo + test específico |
| `onCreatureDied()` | Libera pareja, notifica familiares; **líder de clan muerto deja `leaderId=null` hasta el próximo `update()`** | civilization-system.js:995-1014 | ninguna directa | código completo, sin test directo — posible ventana de "sin líder" entre ticks |
| Barcos — expedición colonizadora / comercio / pesca | `ShipManager._tryLaunch/_launchTradeShip/_launchFishingShip` | ships.js:194-316 | `ships.test.js` solo cubre serialize/restore, no la lógica de lanzamiento | parcial — persistencia testeada, lógica de decisión sin test |
| Estados temporales en combate (`cursed`/`frozen`/`madness`) | Solo se disparan por poderes del jugador, no automáticamente en combate | status-system.js:29-102 | solo blessed/shielded/poisoned tienen test (`phase6-7.test.js:50-62`) | código completo, cobertura parcial (3 de 6 estados sin test) |

**Riesgos de este bloque:** la "postura" militar no implica formación espacial real (brecha de diseño ya documentada, confirmada vigente); asedio, conquista y rebelión —sistemas centrales de "guerra"— no tienen ningún test que ejercite el flujo completo; `_checkCaptureDir()` es código muerto sin explicar por qué; los estados `cursed`/`frozen`/`madness` no están probados pese a ser aplicables en escenarios de combate.

---

## Tiempo y guardado

| Función | Comportamiento esperado | Archivo:línea | Evidencia de test | Estado inferido |
|---|---|---|---|---|
| Pausa y velocidades (0/1/2/4) | Botones/teclas fijan `simSpeed`; recuerda velocidad para reanudar | main.js:518-528,557-562 | ninguna | código completo, sin test directo (UI sin cobertura) |
| Paso fijo desacoplado del framerate | `FixedStepClock.advance` ejecuta pasos de 1/30s | core/fixed-step-clock.js:18-38 | `runtime-phase2.test.js` | código completo + test específico |
| **Límite de pasos de recuperación por fotograma (`maxStepsPerFrame=4`)** | Evita espiral de bajada de FPS | game-runtime.js:15-21 | `runtime-phase2.test.js` usa `maxStepsPerFrame=2` genérico, **no el valor real 4** | **sospechoso de bug**: bajo carga sostenida a velocidad &gt;1, el excedente de tiempo se descarta (`droppedSeconds`, fixed-step-clock.js:32-36) de forma irreversible — el mundo queda permanentemente por detrás del multiplicador elegido y nunca se recupera aunque el FPS mejore después; sin test que ejercite los valores reales de producción |
| `resetClock()` al cargar/nueva partida | Evita saltos al restaurar | game-runtime.js:46-48 | ninguna | código completo, sin test directo |
| Pestaña en segundo plano (checkpoint) | Guarda snapshot en `sessionStorage` + guardado silencioso | main.js:1484-1486 | ninguna | código completo, sin test directo |
| Reanudación de pestaña activa | Restaura snapshot de sesión exacto si existe | main.js:1774-1789 | ninguna | **parcial**: sin coordinación entre pestañas (`storage`/`BroadcastChannel`) — dos pestañas del mismo origen pueden pisarse el snapshot sin aviso |
| Guardado completo (`buildSaveSnapshot`) | Serializa todos los sistemas + UI | main.js:1251-1287, save-system.js:156-224 | `save-system.test.js` | código completo + test específico (sin round-trip con civilización/cataclismos reales poblados) |
| Migración automática v1→v8 | Reconstruye campos faltantes, marca `migratedFrom` | save-system.js:88-126 | `save-system.test.js` (5 tests, v1-v5) | código completo + test específico |
| Archivo incompleto/corrupto | Recorre candidatos (actual→pending→backup→legacy) | save-system.js:151-188 | `save-system.test.js` | código completo + test específico |
| Versión futura no soportada | Lanza error explícito | save-system.js:98-125 | `save-system.test.js` | código completo + test específico |
| **Cuota de almacenamiento agotada** | Libera backup/legacy y reintenta; restaura valor previo si falla de nuevo | save-system.js:194-224,374-387 | **ninguna** (ningún test fuerza fallo de `setItem`/`commit`) | código completo, sin test — única categoría de fallo de guardado sin verificación automatizada |
| Respaldo/recuperación automática | Copia a backup antes de sobrescribir; carga cae a backup si falla el principal | save-system.js:205-224,268-354 | `save-system.test.js` | código completo + test específico |
| Ranuras de guardado + import/export JSON | Slots 1-3 independientes del autosave, con import/export | save-system.js:393-429; main.js:1429-1481 | `save-system.test.js` (solo capa de datos; la UI de `&lt;input type=file&gt;` no está probada) | código completo, cobertura parcial |
| Autosave periódico | Cada `autosaveSeconds` (60s por defecto), con **tiempo real, no simulado** | main.js:1766-1770 | ninguna | código completo, sin test — nota: se dispara igual aunque el juego esté en pausa |

**Riesgos de este bloque:** el límite de pasos de recuperación por fotograma, combinado con el descarte irreversible de tiempo no simulado, hace que la simulación quede permanentemente atrasada respecto a la velocidad elegida bajo carga sostenida, sin que ningún test ejercite este escenario con los valores reales de producción; el manejo de cuota de almacenamiento agotada tiene código pero cero cobertura de test; no hay coordinación entre pestañas del mismo origen.

---

## Interfaz, renderizado y experiencia

| Función | Comportamiento esperado | Archivo:línea | Evidencia de test | Estado inferido |
|---|---|---|---|---|
| Minimapa (pintado, clic para mover cámara, visibilidad) | Redibuja cada 2.5s por bioma/hielo/lava/altura; pointerdown mueve la cámara | main.js:1137-1168 | `game.spec.js:107` solo comprueba visibilidad, no contenido ni clic | código completo, sin test directo del contenido/clic |
| Capas 3D (territorios, nombres, cultura/idioma/religión/ejércitos) | Checkboxes/select activan overlays en `settlements`/`civilization` | main.js:887-916; civilization-system.js:1133-1136 | ninguna | código completo, sin test directo |
| Panel de inspección (criatura/asentamiento) + refresco en vivo | Muestra salud/hambre/genes/cultura/recursos/lealtad; se refresca cada tick mientras está abierto | ui-inspect.js:23-151 | ninguna | código completo, sin test directo — pieza central de UX sin ninguna prueba |
| Panel de ajustes (gráficos/simulación/sonido/accesibilidad) | Selects por campo con persistencia en localStorage | ui-settings.js:7-77 | `graphics.spec.js:84-98`, `game.spec.js:112-115` cubren algunos campos (no todos, p.ej. AO) | código completo + test parcial |
| Tutorial inicial (4 pasos) | Overlay con contador y botones siguiente/saltar | ui-settings.js:118-135 | los tests solo pulsan "saltar"; ningún test avanza los 4 pasos | código completo, sin test directo del recorrido completo |
| Cámara — órbita/paneo/zoom | Botón derecho orbita, rueda/medio panea, rueda hace zoom | camera.js:19-51 | `landscape-camera.test.js:8-31` solo cubre vista aérea, no arrastre real | parcial — lógica de arrastre sin test |
| Vista aérea (encuadre automático) | Ajusta distancia para encuadrar el mapa completo | camera.js:53-78 | `landscape-camera.test.js:8-31` | código completo + test específico |
| **Controles táctiles — zoom/rotación de cámara** | D-pad para paneo; sin gesto táctil para zoom/órbita | camera.js (solo `wheel`/`pointerdown button 1-2`, sin `touchstart`/pinch) | ninguna | **sospechoso de función ausente**: en móvil el zoom/órbita dependen de eventos de ratón que el touch puro no dispara — solo hay paneo disponible |
| Audio ambiental + desbloqueo requerido por navegador | `AudioContext` se crea/retoma en el primer `pointerdown` global | audio-system.js:9-59 | ninguna (0 tests referencian `AudioSystem`) | código completo, sin ningún test |
| **Panel de diagnóstico F3 — abrir/cerrar** | Tecla F3 alterna el panel | main.js:554-563, 1216-1231 | ninguna | **CONFIRMADO en vivo (jugando y por consola)**: primera pulsación abre el panel (`diagnosticsPanel.className` pasa de `sidePanel hidden` a `sidePanel`); la segunda pulsación no lo cierra, porque `interfaceBlocksGame()` (línea 306) ya cuenta el propio panel como `.sidePanel:not(.hidden)` y corta en la línea 556 antes de llegar al `toggleDiagnosticsPanel()` de la línea 563. Solo el botón dedicado cierra el panel una vez abierto. Bug real, no solo falta de test |
| Diagnóstico: muestreo de frames/errores (motor) | `sampleFrame`/`recordError`/`snapshot` con límites de historial | diagnostics.js:21-93 | `diagnostics.test.js` | código completo + test específico |
| Perfiles gráficos Bajo/Medio/Alto/Ultra | `resolveGraphics` mezcla overrides sobre el preset | graphics-config.js:1-27 | `graphics.test.js:7-12` | código completo + test específico |
| Oclusión ambiental (SSAO), sombras, bloom/AA | Habilitados según preset; solo Ultra activa SSAO por defecto | render-system.js:74-256 | ninguna verifica el resultado visual/efecto real, solo persistencia de selects | código completo, sin test directo del efecto |
| Ciclo día/noche | Interpola color/sol/sombra/niebla; mantiene iluminación al salir de vista aérea | daynight.js:35-99 | `graphics.test.js:31-41` | código completo + test específico |
| **Gate "no activar poderes sobre paneles" (riesgo citado en el plan)** | `interfaceBlocksGame()` bloquea pintura de poderes y atajos mientras un panel esté visible | main.js:304-306,769-770,1758,1765 | ninguna reproduce "panel abierto + clic sobre canvas" | mecanismo presente y cubre los paneles listados, pero **sin ningún test que confirme el escenario exacto que el plan señala como riesgo** |
| Pantalla completa | Alterna fullscreen y fuerza resize del renderer | main.js:1712-1737 | ninguna | código completo, sin test directo |

**Riesgos de este bloque:** (1) bug concreto localizado — F3 no puede cerrar el panel de diagnóstico una vez abierto, solo el botón; (2) controles táctiles solo ofrecen paneo, sin zoom/rotación gestual, candidato a "función ausente" en móvil; (3) el mecanismo que evita activar poderes al clicar paneles existe pero no tiene ningún test que lo confirme en la práctica; (4) `ui-inspect.js` y `audio-system.js` — piezas centrales de la experiencia — no tienen ni una sola prueba.

---

## Resumen ejecutivo (para A-02: fijar catálogo 1.0)

Auditados 7 dominios, ~13.100 líneas de código en 33 archivos, cruzados contra 28 archivos de test unitario (113 pruebas) y 11 specs e2e (20 pruebas, 19 pasan). Ningún poder ni sistema mayor resultó ser un placeholder vacío — el catálogo de 52 poderes tiene implementación real completa. Los hallazgos se concentran en tres categorías:

**Bugs concretos a corregir en Fase B (no solo falta de test):**
1. ~~`tests/e2e/archipelago.spec.js` fallaba por timeout~~ — **corregido en esta sesión**: era un test incompleto (faltaba el clic en `#gameMenuBtn` antes de `#saveBtn`), no un bug del juego. Confirmado jugando la partida en vivo: guardar funciona correctamente. Ver `docs/FASE-A-LINEA-BASE.md`.
2. **Confirmado en vivo**: F3 no puede cerrar el panel de diagnóstico una vez abierto (`main.js:554-563`) — `interfaceBlocksGame()` se evalúa antes que la tecla. Fix propuesto para Fase B: comprobar `e.code==='F3'` antes del corte por `interfaceBlocksGame()`, o excluir `#diagnosticsPanel` del selector de esa función.
3. Navegación: criaturas persiguiendo un objetivo tras un obstáculo permanente quedan "atascadas" reintentando A* indefinidamente sin abandonar el objetivo (`creatures.js:262-308`).
4. Recursos secundarios (ore/tools/weapons/armor/goods/fish) nunca se topan, a diferencia de wood/food/stone/gold/gems — acumulación potencialmente ilimitada.
5. `controlsSiegeFor()` siempre devuelve `true`, dejando `_checkCaptureDir()` como código muerto sin explicación.
6. **Confirmado en vivo con números reales** (ver `docs/FASE-A-MUNDOS-REFERENCIA.md`, "Hallazgo transversal"): con FPS sostenido ~20, `simulationSteps` se queda clavado en el máximo (4) y `droppedSimulationMs` crece sin límite (1480→2188 ms en 10s) — el contador de "Día" quedó congelado en 1 durante &gt;90 s reales a velocidad ×2/×4 pese a haber criaturas vivas. Esto bloqueó por completo la posibilidad de generar en esta sesión los mundos de referencia que requieren desarrollo simulado (aldea madura, varias ciudades, guerra, comercio naval, partida envejecida) — la limitación de la sesión es en sí misma evidencia de la severidad del hallazgo. Prioridad más alta recomendada de todo el informe de Fase A.

**Sistemas centrales sin ningún test que ejercite el flujo completo** (riesgo alto de regresión silenciosa): asedio (`_updateSieges`), conquista (`captureSettlement`), rebelión (`rebellionSupport`/`rebel`), cuota de almacenamiento agotada en guardado, panel de inspección (`ui-inspect.js`), audio (`audio-system.js`), y el propio mecanismo anti-clic-de-poder-sobre-panel.

**Brechas de diseño ya conocidas y confirmadas vigentes:** la "postura" de ejércitos es solo un multiplicador de daño, sin formación espacial real; el preset de mapa "llano" hace el bioma alpino matemáticamente inalcanzable; los controles táctiles carecen de gesto de zoom/rotación.

Esta tabla, junto con el fallo de e2e y el enlace roto a `docs/ROADMAP.md` (ver `docs/FASE-A-LINEA-BASE.md`), es la base recomendada para priorizar la Fase B (P0/P1 primero: el timeout de archipiélago y el bug de navegación "atascada" son los candidatos más claros a P1 por bloquear un escenario de referencia y por afectar el comportamiento observable de cualquier partida con obstáculos).
