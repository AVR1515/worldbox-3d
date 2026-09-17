# Continuación de las fases B y C — 8 de septiembre de 2026

Este informe complementa el historial anterior. Distingue cambios implementados, pruebas ejecutadas y comprobaciones todavía pendientes. No convierte cobertura de módulos en una certificación de toda la fase.

## Fase B: correcciones

| Caso | Problema | Cambio y prueba |
| --- | --- | --- |
| Respaldo con cuota agotada | Una copia válida se descartaba al fallar su reparación en IndexedDB | La lectura devuelve la copia y conserva el error de reparación. Regresión en `save-system.test.js`. |
| Guardado alternativo | Tras fallar IndexedDB, reabrir podía cargar su partida antigua en lugar de la más reciente de localStorage | Se compara `savedAt` antes de elegir y migrar. Prueba con una nueva instancia del repositorio. |
| Reparación local | El principal corrupto sobrescribía el respaldo válido | Solo se respalda un principal validado. |
| Cuota local | Si se liberaban claves antiguas y aun así el nuevo guardado no cabía, podía desaparecer la única copia antigua | Se conservan las entradas en memoria y se restauran tras fallar el segundo intento. |
| Migración naval | La migración desmarcaba pasajeros aunque la versión ya incluyera sus barcos | Se desmarca únicamente cuando no existe contenedor de barcos. |
| Importación | Un archivo podía contener matrices truncadas o números no finitos | Validación de longitud y valores; humedad obligatoria como exige `World.restore`; importación compatible con matrices compactadas. |
| Consulta de existencia | `hasSave()` asíncrono podía escribir mientras consultaba | Lectura con `repair: false`. |
| Tiempo | El límite de 100 ms ocultaba tiempo real descartado y cuadros lentos | Se separan duración real y delta visual; el reloj contabiliza el recorte. La pestaña oculta no simula y al volver se reinicia la referencia temporal. |
| Reinicio del reloj | `resetClock()` dejaba la instantánea anterior hasta el siguiente avance | Se actualiza inmediatamente la instantánea. |
| Canal naval alterado | Los barcos seguían atravesando tierra o hielo | Se comprueba el trayecto inmediato; búsqueda alternativa con límite de nodos y reintento espaciado. Si no hay salida, espera sin entregar la carga. |
| Cargamento inválido | Un cargamento negativo importado podía restar existencias al regresar | Restauración de pescado/bienes como cantidades finitas no negativas. |
| Fauna invisible de lejos | En mapas grandes el tope de población superaba la capacidad de instancias lejanas | La capacidad inicial respeta el tamaño del mundo y crece para partidas restauradas que la superan. La regresión reprodujo 220 animales vivos pero solo 200 dibujados. |

## Cobertura añadida

- `life-cycle.test.js`: nacimiento, crecimiento, muerte por edad, limpieza de índices y persistencia, leyes, muerte y zombificación.
- `audio-system.test.js`: desactivación, creación tras interacción, limitación de ráfagas, suscripciones y cierre.
- `ui-inspect.test.js`: nombres con etiquetas, seguimiento, actualización y desaparición del objetivo.
- `navigation.test.js`: puente destruido, puerta cerrada y canal cortado.
- `ships.test.js`: detener una ruta interrumpida y continuar tras reabrir el canal.
- `session-roundtrip.test.js`: GameSession real, aldeas de tres semillas, guardado compactado, restauración de ciudadanos, recursos y estados, y continuación de la simulación. Solo se omite el dibujo de etiquetas sobre canvas.
- `creature-lod.test.js`: 220 animales visibles desde lejos, retorno al detalle cercano y descarte fuera de cámara, sin modificar sus datos de simulación.

Se identificó una causa concreta de inestabilidad de la prueba de hambre: el ciudadano podía recibir el rasgo **Glotón** (+50 % de consumo), incompatible con la expectativa de alimentación básica del escenario. Se fijaron rasgos vacíos en esa prueba. La prueba de piezas de muralla usa terreno seco uniforme para evitar que la ubicación aleatoria impida construir su torre. El test de 36 generaciones de archipiélagos dispone de 15 segundos: es una comprobación funcional exhaustiva, no un presupuesto de FPS.

Las pruebas históricas siguen aportando cobertura de economía, terreno/caminos, construcción, asedio, conquista, rebelión, genealogía, poderes y estados. Quedan por completar los recorridos exploratorios extensos de ciudades maduras, guerras y recuperación de desastres. Las partidas integradas cortas no equivalen a sesiones prolongadas ni prueban toda combinación posible.

## Fase C: medición y cambio gráfico

Se añadió `tests/e2e/ultra-benchmark.spec.js`, optativo mediante `WB3D_BENCHMARK=1`. Por defecto usa 30 segundos de calentamiento, 120 de registro y tres repeticiones por configuración. Registra GPU, navegador, escala interna, percentiles, tiempos CPU de simulación/visuales/render, llamadas de dibujo y avance simulado/real. No confunde el tiempo de envío de render en CPU con tiempo GPU.

Escenario inicial: isla pequeña de 132, semilla 12345, 500 criaturas exactas, cámara aérea fija, 1920 × 1080 CSS, escala de dispositivo 1, Ultra con resolución interna 1,25 (2400 × 1350). Es un escenario de aislamiento gráfico: no contiene ciudades maduras, guerra ni cataclismos. No debe presentarse como validación de esos escenarios.

**Piloto previo:** 5 s de calentamiento + 20 s, una repetición. Edge 152, ANGLE/D3D11, **NVIDIA GeForce GTX 1650 Ti**, no renderizado por software.

| Configuración original | Mediana de cuadro | p95 | p99 | Simulado/real |
| --- | ---: | ---: | ---: | ---: |
| Ultra con AO | 16,7 ms | 33,3 ms | 33,4 ms | 0,9996 |
| Ultra sin AO | 16,7 ms | 17,0 ms | 17,9 ms | 0,9995 |

Esto motivó probar AO a la mitad de resolución por eje (un cuarto de píxeles), manteniendo el resto de Ultra y el efecto activo. El ajuste **Detalle de sombras de contacto** permite elegir 50 % o 100 %. El tamaño se reaplica tras redimensionar o cambiar la calidad, incluyendo la escala del dispositivo.

El diagnóstico F3 ahora muestra mediana, p95 y p99 de su ventana reciente sin recortar cuadros largos. Esa ventana es un indicador en vivo; el benchmark calcula sus percentiles sobre toda la muestra.

### Comparación completa de 500 criaturas

Ejecutada de 13:40 a 13:55, tres pares de muestras; cada muestra tuvo 30 s de calentamiento y 120 s de registro. Todas usaron la misma semilla, cámara, GPU y escala. No se ejecutaron suites de pruebas ni otra escena 3D durante este benchmark.

| Repetición | Resolución AO | Cuadros | Mediana | p95 | p99 | Simulado/real | Tiempo descartado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100 % | 6299 | 16,7 ms | 33,4 ms | 33,5 ms | 0,99994 | 0 s |
| 1 | 50 % | 6455 | 16,7 ms | 33,3 ms | 83,3 ms | 0,99849 | 0,1676 s |
| 2 | 100 % | 6352 | 16,7 ms | 33,4 ms | 33,6 ms | 0,99994 | 0 s |
| 2 | 50 % | 6876 | 16,7 ms | 17,3 ms | 33,4 ms | 0,99873 | 0,1664 s |
| 3 | 100 % | 6339 | 16,7 ms | 33,4 ms | 33,6 ms | 0,99990 | 0 s |
| 3 | 50 % | 6939 | 16,7 ms | 17,1 ms | 33,4 ms | 0,99986 | 0 s |

La reducción beneficia dos de tres muestras de p95, pero la primera presenta picos peores de p99. No se oculta esa variación ni se declara cumplido el objetivo Ultra de p95 ≤25 ms en todas las repeticiones. La simulación supera el objetivo de 0,95 en las seis muestras. La mediana CPU de simulación fue 0,7–0,8 ms y las llamadas de dibujo se mantuvieron en 47: se reduce resolución del efecto, no cantidad de objetos ni sistemas simulados.

### Piloto de 1.500 criaturas

Mapa grande de 240, exactamente 1.500 criaturas, GPU y resolución anteriores; 5 s de calentamiento y 20 s de registro, un par de muestras. Sin guerra ni ciudades maduras. [Datos JSON](evidence/ultra-1500-pilot.json).

| Resolución AO | Mediana | p95 | p99 | Cuadros registrados | Tiempo descartado |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 % | 33,3 ms | 50,1 ms | 66,7 ms | 557 | 0 s |
| 50 % | 33,3 ms | 33,4 ms | 50,0 ms | 642 | 0 s |

El piloto muestra mejora del p95 y conserva las 1.500 criaturas durante ambas muestras. Su duración corta y la ausencia de guerra impiden usarlo para cerrar la meta de carga alta de la guía.

## Validación y límites

- Línea base original: 31 archivos y 153 pruebas unitarias aprobados fuera del aislamiento de Windows.
- Primer recorrido de navegador tras las correcciones iniciales: 18/20 aprobados. Fallos: un clic para reanudar durante generación pequeña y el presupuesto de FPS de la prueba histórica (19,6 FPS en su ventana corta). Pendiente de repetición aislada antes de clasificar.
- Validación unitaria final: **36 archivos, 178 pruebas aprobadas**, incluidas las tres partidas integradas. La corrida anterior reprodujo LOD y hambre; también agotó los 5 s del test de 36 generaciones. Los tres casos pasaron aislados tras corregir sus causas y la suite completa pasó posteriormente.
- Navegador final: **21 pruebas aprobadas**, con el benchmark largo omitido deliberadamente en la suite habitual (se ejecutó aparte). Pasaron los tres tamaños, carga/guardado, migraciones, poderes, menús, alojamiento estático, gráficos y la prueba histórica de 500/1.500 unidades. Esa prueba ahora excluye generación/ráfagas de creación de su ventana y espera 90 cuadros; conserva sus exigencias originales de FPS.
- **20 ciclos de crear/guardar/cargar/destruir aprobados**, tras cinco ciclos de calentamiento. Comprueba retorno al número inicial de objetos de escena y ausencia de crecimiento de geometrías/texturas en la última ventana respecto a la primera. Es una escena pequeña; no acredita ausencia de toda fuga de memoria JavaScript ni el mismo resultado con ciudades maduras.
- **Compilación aprobada.** Vite mantiene el aviso de paquete JavaScript mayor de 500 kB; no bloquea la compilación. Distribución y separación de recursos siguen perteneciendo a I.
- Revisión visual: [AO 100 %](evidence/contact-shadows-100.png) y [AO 50 %](evidence/contact-shadows-50.png). Aspecto comparable en esta toma; no sustituye revisión de todos los biomas, edificios y distancias.
- C sigue necesitando medición prolongada con 1.500 criaturas, ciudades maduras, guerra, desastres y sesiones de 30–60 minutos. No se declara cerrada con el escenario de 500 criaturas.
