# Fase A — Comparación con WorldBox y propuesta de catálogo 1.0 (A-01, punto 6)

Referencia: [superworldbox.com/changelog](https://www.superworldbox.com/changelog), consultado el 8 de septiembre de 2026 (plataforma no especificada por la fuente — probablemente agrega móvil/escritorio sin distinguir). Este documento cruza esa referencia contra el estado real de WB3D descrito en `docs/FASE-A-MATRIZ-FUNCIONAL.md` y el catálogo de 52 poderes de `power-system.js`.

**Esto es una propuesta de alcance, no una decisión cerrada.** Las marcas ⛔ "fuera de 1.0" son recomendaciones a confirmar contigo — no se ha eliminado ni descartado nada del código.

Leyenda: ✅ incluida (equivalente funcional) · 🔧 adaptación propia (existe, funciona distinto por diseño) · ⚠️ parcial/pendiente (ya señalado en la matriz o en la Fase F del plan) · ⛔ propuesta de exclusión de 1.0 · ❓ profundidad desconocida (no auditado a fondo)

## Entidades políticas

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Reinos (gobierno, riqueza, renombre) | ✅ (sin "renombre" como métrica) | `createEmpire()`, sucesión (`ensureKing`/`chooseHeir`) presentes. Sin métrica de "renombre" acumulado — ver "Renombre" abajo. |
| Alianzas | ✅ | `makeAlliance()`, bilateral (no coaliciones multi-reino coordinadas) |
| Ciudades (líder, almacén, lealtad territorial) | ✅ | Asentamientos con recursos, nivel, lealtad (`rebellionSupport`) |

## Identidad cultural

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Culturas | 🔧 emergente, sin edición manual | `_ensureSocieties()`. La Fase F del propio plan ya señala "completar inspección y edición manual" como pendiente |
| Idiomas | 🔧 emergente, sin edición manual | mismo mecanismo que culturas |
| Religiones | 🔧 emergente, sin edición manual | mismo mecanismo |
| Clanes | ✅ | `_ensureClans()`, líder por prestigio, máx. 18 miembros |
| Familias / genealogía | ⚠️ existe el dato, sin visor genealógico dedicado | `registerBirth()` registra padres/hijos; no se confirmó un panel de árbol genealógico en `ui-inspect.js` |

## Biología y evolución

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Subespecies | 🔧 emergentes por clima, no editables | WorldBox permite crear/personalizar fenotipos manualmente; WB3D solo deriva subespecie de adaptación fría/calor automática |
| Genes/cromosomas | 🔧 modelo simplificado | WB3D usa escalares continuos heredables (`damageMul/speedMul/...`), no un sistema de cromosomas discretos — equivalente funcional más simple |
| Mutación/Ascensión vía monolitos | ⛔ propuesta de exclusión | sin equivalente en WB3D; encaja mejor como ampliación posterior que como base de 1.0 |
| Reproducción alternativa (asexual, partenogénesis, gemación) | ⛔ propuesta de exclusión | WB3D solo modela reproducción sexual con pareja; añadir modos alternativos es ampliación, no corrección |

## Capacidades militares

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Ejércitos (capitanes, movilización) | ✅ | `_syncArmies()`, capitán, moral |
| Guerras (con historia detallada) | ⚠️ mecánica sí, historial ❓ | declaración/paz sí; profundidad del registro histórico de la guerra sin auditar (ver "Registro histórico" abajo) |
| Conquista | ✅ (sin test, ver matriz) | `captureSettlement()` |
| Renombre (métrica que habilita diplomacia) | ⛔ propuesta de exclusión / 🔧 alternativa ya presente | WB3D condiciona diplomacia a `diplomacyAffinity()` (cultura/idioma/religión compartidos) en vez de una métrica de renombre acumulado — es una diferencia de diseño intencional razonable, no forzosamente un vacío a cerrar |

## Construcción e infraestructura

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Edificios especiales por especie (bibliotecas, templos, cuarteles) | ⚠️ pendiente, ya señalado | la propia Fase F del plan lista "escuelas, templos, libros y emblemas" como pendientes |
| Barcos | ✅ | `ships.js` completo (expedición, comercio, pesca) |
| Automatización (spawners/granjas/colmenas) | 🔧 parcial vía granjas y minas | WB3D tiene `addFarm()`/minas como generadores de recursos; no hay "spawners" de unidades ni colmenas — encaja como ampliación, no como vacío urgente |

## Conocimiento e historia

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Libros que registran/propagan historia | ⚠️ pendiente, ya señalado | mismo punto que "edificios especiales" en la Fase F del plan |
| Registro histórico (cronología de eventos) | ❓ sin auditar a fondo | WB3D tiene un botón "Historia y estadísticas" en la interfaz (confirmado en vivo) pero su contenido no se auditó línea a línea en esta pasada — pendiente de revisión específica antes de declarar cobertura |
| Logros | ⛔ propuesta de exclusión | sistema de meta-progresión, no de simulación; no aporta al objetivo central del plan ("simulador de mundos coherente") |
| Conocimiento prohibido (poderes desbloqueables vía sacrificio) | ⛔ propuesta de exclusión | mecánica de contenido de WorldBox sin relación con el objetivo de realismo estilizado del plan |

## Poderes del jugador

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Poderes divinos (con coste de maná) | 🔧 sin sistema de coste | WB3D tiene 52 poderes (catálogo completo, ver matriz) pero de uso libre/ilimitado, sin maná ni cooldown — diferencia de diseño a confirmar como intencional |
| Ritos mágicos | ❓ sin auditar | la propia Fase F del plan ya marca "planes/rituales" como "no auditado integralmente en esta revisión" — sigue pendiente |
| Leyes mundiales | ✅ | panel "Leyes del mundo" confirmado en vivo (p. ej. `naturalDisasters`, envejecimiento) |
| Herramientas de edición (pinceles terreno/bioma, borrador) | ✅ | pinceles elevar/bajar/agua/bosque/biomas + borrar, todos en el catálogo de poderes |

## Catástrofes naturales

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Variantes de lluvia (ácida/loot/rasgos/sangre) | 🔧 solo lluvia normal + ácida | `rain` y `acidrain` presentes; las variantes "loot/rasgos/sangre" son contenido más lúdico que de simulación — candidatas a ampliación, no a base |
| Terremotos/volcanes | ✅ | `earthquake`, `lava` |
| Plagas | ✅ | `plague` |
| Meteoritos/rayos | ✅ | `meteor`, `lightning` |

## Interfaz y análisis

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Estadísticas por entidad (población, muertes, nacimientos, dinero) | ❓ sin auditar a fondo | probablemente cubierto parcialmente por el panel de inspección de asentamiento/imperio; no se confirmó cobertura de "muertes/nacimientos acumulados" como serie temporal |
| Gráficos temporales de tendencias | ⚠️ probablemente ausente | no se encontró evidencia de gráficos de población/conflictividad en el tiempo en la auditoría de `ui-inspect.js`/`ui-settings.js` |
| Ventanas de meta con genealogía por cultura/clan | ⚠️ parcial | existen paneles de criatura/asentamiento; un panel dedicado a cultura/idioma/religión con vista genealógica no se confirmó — mismo vacío que "edición manual" arriba |
| Navegación de selección (atrás/adelante) | ⛔ propuesta de exclusión | mejora de UX menor, no crítica para el objetivo del plan |

## Sistemas menores

| Sistema WorldBox | Estado en WB3D | Nota |
| --- | --- | --- |
| Cientos de rasgos individuales | 🔧 catálogo reducido por diseño | `traits.js` maneja un puñado de rasgos (0-2 por criatura); WorldBox tiene "cientos". Es una diferencia de escala de contenido, no un defecto — a decidir si se amplía en F |
| Objetos/loot con modificadores de rareza | 🔧 más simple | WB3D modela tools/weapons/armor como recursos consumibles equipables, sin sistema de rareza/modificadores |
| Economía (dinero de reino) | ✅ | oro como recurso topado, usado en reclutamiento/comercio |
| Traducción multiidioma (40+ idiomas) | ⛔ fuera de alcance de 1.0 | WB3D es monolingüe (español); internacionalización es una decisión de producto aparte, no de paridad de simulación |

---

## Propuesta de catálogo 1.0 (a confirmar contigo)

**Ya cubierto, cerrar como "función incluida" tras corregir lo señalado en la matriz:** reinos, alianzas, ciudades, clanes, ejércitos/guerra/conquista, barcos, leyes mundiales, herramientas de edición, terremotos/volcanes/plagas/meteoritos/rayos, economía.

**Adaptaciones propias intencionales a confirmar como decisión de diseño (no como carencia a "corregir"):** culturas/idiomas/religiones emergentes sin editor manual, subespecies automáticas por clima, genoma simplificado (escalares en vez de cromosomas), diplomacia basada en afinidad cultural en vez de "renombre", poderes sin coste de maná, catálogo de rasgos reducido.

**Pendiente real ya identificado por la Fase F del propio plan (no es novedad de este documento, se confirma vigente):** edificios especiales (escuelas/templos), libros/historia física, edición manual de cultura/idioma/religión.

**Recomendación de exclusión de 1.0 (ampliación posterior si se desea):** mutación/ascensión vía monolitos, modos de reproducción alternativos, logros, conocimiento prohibido, variantes exóticas de lluvia (loot/rasgos/sangre), navegación de selección atrás/adelante, traducción multiidioma.

**Necesita auditoría específica antes de decidir (no se pudo confirmar profundidad en esta pasada):** ritos/rituales mágicos, profundidad del registro histórico y las estadísticas por entidad, gráficos temporales.

Esta propuesta, junto con la matriz funcional y los mundos de referencia, cierra los 6 puntos de la Fase A. La decisión final de qué entra en el catálogo 1.0 —especialmente las filas ⛔ y las "adaptaciones propias"— queda para que la confirmes antes de que la Fase F la dé por cerrada.
