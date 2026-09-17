# Diagnóstico y plan de rendimiento

Fecha: 10 de septiembre de 2026. Alcance: revisión del código, los modelos GLB, las capturas del usuario y las pruebas existentes. No se han modificado los sistemas del juego ni realizado una nueva medición en su navegador.

## Conclusión

La prioridad es eliminar geometría innecesaria de los árboles. Hay un desperdicio confirmado en el código que puede explicar gran parte de los 13,18 millones de triángulos registrados. El tiempo exacto atribuible a GPU, CPU y efectos requiere una prueba controlada; no se puede deducir únicamente de los FPS.

La captura muestra 7 FPS, 138,7 ms por cuadro, mediana de 137,6 ms, p95 de 275,8 ms y p99 de 414,6 ms. Solo hay 27 criaturas, ninguna detallada, sin aldeas ni barcos. Las 44 llamadas de dibujo son pocas, pero no representan poca geometría: el instancing agrupa muchos árboles en cada llamada.

## Hallazgos comprobados

1. **Se dibuja la capacidad reservada, no la población real.** `js/world.js:49` fija 2.600 instancias por especie. `buildTreeMeshes()` crea tres especies sin reducir `mesh.count`. Los espacios vacíos se encogen y se trasladan bajo el mundo; `hideTreeInstance()` hace lo mismo al borrar. Three.js conserva `count = 2600` y lo usa para emitir las instancias. Esto sigue enviando geometría aunque no produzca píxeles visibles.
2. **El coste de los modelos amplifica ese desperdicio.** La lectura directa de los GLB da 1.014 triángulos para `tree_001` —compartido por árboles redondos y secos— y 336 para `fir_001`. Con los modelos cargados se envían `2600 × (1014 + 1014 + 336) = 6.146.400` triángulos de árboles por pasada que incluya los tres lotes. Dos pasadas suman 12.292.800, aproximadamente el 93 % del total de la captura. Es una explicación cuantitativamente compatible, no una medición aislada de esa sesión: falta confirmar efectos y pasadas activos. El contador acumula pasadas, incluidas sombras y efectos; no son necesariamente 13 millones de triángulos únicos.
3. **Los árboles no tienen niveles de detalle ni descarte espacial.** Los tres lotes globales tienen `frustumCulled = false`. Se mantiene el GLB completo también a la distancia de la primera captura. El ajuste `vegetation` solo vuelve a dispersar hierba; no aligera los árboles.
4. **Sombras y resolución pueden multiplicar el coste.** `RenderSystem.render()` solicita actualizar sombras cada cuadro. Ultra usa sombras de 4096 y resolución 1,25 multiplicada por la densidad de píxeles del dispositivo, con límite 2,5. Un ratio de 2,5 implica 6,25 veces los píxeles de ratio 1. SSAO añade renderizado de geometría y bloom/SMAA añaden trabajo sobre la imagen. No consta qué ajustes estaban activos en la captura.
5. **El diagnóstico no separa tiempos de CPU y GPU.** Actualmente muestra intervalos entre cuadros y contadores. Hay instrumentación opcional por sistema en `GameRuntime` y un benchmark Ultra reutilizable, pero el panel no permite atribuir el problema con precisión.
6. **La caída afecta al tiempo del juego.** El reloj limita la entrada a 100 ms y registra el exceso como tiempo descartado. A 138,7 ms sostenidos y velocidad 1, el límite permitiría avanzar como máximo aproximadamente el 72 % del tiempo real, antes de otras restricciones. Los 22.457,4 ms descartados son acumulados; los cero pasos corresponden al último cuadro y no demuestran por sí solos que la simulación esté averiada.

## Plan de ejecución, en orden

### 1. Establecer una línea base reproducible

- Reutilizar el benchmark existente con una semilla o guardado fijo que reproduzca el archipiélago, alrededor de 2.743 árboles y 27 criaturas. Mantener cámara, tamaño de ventana, navegador y ajustes iguales.
- Registrar GPU realmente utilizada, aceleración gráfica, tamaño del buffer, ratio de píxeles, calidad, efectos y revisión del código. La evidencia histórica de otra ejecución no confirma la GPU de esta sesión.
- Esperar a que carguen los GLB y se compilen los shaders; calentar 15 segundos y medir 60 segundos, tres veces por variante, sin otros juegos/pruebas compitiendo.
- Medir mediana, p95/p99, CPU de simulación, actualización visual y envío de render, tareas largas y tiempo descartado. Añadir tiempos GPU mediante consultas asíncronas si están disponibles; señalar su ausencia y descartar muestras inválidas.
- Comparar por separado: simulación pausada, árboles ocultos, sombras desactivadas, SSAO desactivado, bloom/SMAA desactivados y resolución reducida. Restaurar el estado entre variantes; no cambiar todo simultáneamente.
- Contar triángulos e instancias por categoría y por pasada. No confundir tiempo CPU de `render()` con tiempo GPU.

**Entrega:** tabla base y comparación de variantes con el mismo escenario. Esta fase verifica cuánto del problema explica cada hallazgo.

### 2. Dibujar únicamente instancias activas — prioridad máxima

- Separar capacidad de almacenamiento de cantidad dibujada. Inicializar `count = 0` y mantener instancias activas contiguas por especie.
- Al eliminar un árbol, mover la última instancia activa al hueco y actualizar ambos mapas de correspondencia entre celda y posición. Mantener matrices, variación visual, especie y estado coherentes. Reducir `count`.
- Cubrir plantado, crecimiento, tala, incendio, cambio de bioma, carga de partida y sustitución asíncrona del modelo provisional por el GLB.
- Actualizar solo las regiones modificadas de los buffers cuando compense; agrupar las escrituras antes del render.
- Aplicar el mismo criterio a los modelos provisionales. No basta reducir `count` al número de árboles mientras existan huecos intermedios: desaparecerían árboles válidos.

**Criterio de aceptación:** cero árboles implica cero instancias de árboles emitidas; N árboles implica N instancias de GLB en total antes del descarte espacial. Los árboles retirados no siguen consumiendo geometría. Sin cambios en recursos, distribución o guardados.

### 3. Añadir detalle por distancia y lotes espaciales

- Usar GLB completo cerca, una versión simplificada a distancia media y una representación muy ligera de la copa lejos. Definir cambios por tamaño aparente en pantalla y añadir margen para evitar oscilación entre niveles.
- Como presupuesto inicial para experimentar: 100–250 triángulos por árbol medio y 8–40 por árbol lejano. Ajustar según comparación visual, especialmente al nivel de zoom de la captura.
- Organizar instancias por sectores del mundo y nivel de detalle, con límites geométricos correctos y descarte por cámara. Probar sectores de 16/32 celdas y elegir según coste conjunto de CPU, llamadas y GPU.
- Mantener el descarte de sombras independiente: un árbol fuera de pantalla puede proyectar una sombra visible.
- Preservar todos los árboles en simulación. La calidad visual cambia su representación, no sus recursos ni existencia.

**Criterio de aceptación:** la vista panorámica reduce al menos un 80 % los triángulos de árboles frente a la base original —objetivo a validar— y la cámara cercana mantiene una apariencia satisfactoria. Comprobar bordes de sectores, transiciones y sombras sin apariciones bruscas.

### 4. Ajustar sombras, efectos y resolución según mediciones

- Usar representaciones simplificadas para sombras de vegetación y limitar detalle lejano. Revisar actualización de sombras por cambios relevantes; el viento y el sol animados requieren una política explícita, no congelarlas indiscriminadamente.
- Comparar sombras 1024/2048/4096 y ajustar el área cubierta a la vista útil para conservar nitidez.
- Elegir valores predeterminados según un presupuesto medido. Hacer que el ajuste de vegetación controle también el detalle visual de los árboles.
- Evaluar resolución dinámica con límites, suavizado e histéresis, manteniendo la interfaz nítida. No usarla para ocultar el desperdicio de instancias de la fase 2.
- Mantener SSAO, bloom y antialiasing solo al coste que permita el objetivo del equipo. La media resolución de SSAO ya existe: no contarla como mejora nueva.

**Criterio de aceptación:** documentar ganancia y pérdida visual de cada opción; validar costas, movimiento, sombras y textos a pantalla completa.

### 5. Resolver picos de CPU y proteger el tiempo simulado

- Con la geometría corregida, perfilar mundos maduros de 500 y 1.500 criaturas, ciudades, guerra y desastres. Optimizar los sistemas que realmente dominen la medición.
- Investigar minimapa, serialización de guardado, actualizaciones de terreno/BVH y asignaciones temporales si coinciden con picos. El minimapa ya se actualiza cada 2,5 segundos; no asumir que se reconstruye cada cuadro.
- Mantener un presupuesto acotado de simulación; revisar recuperación de atrasos tras estabilizar el render. Aumentar pasos sin medir puede empeorar las caídas.
- Mostrar incremento de tiempo descartado durante la muestra y relación entre tiempo simulado y real, además del acumulado histórico.

**Criterio de aceptación:** a velocidad 1, el tiempo descartado no crece en juego sostenido dentro del presupuesto acordado. Verificar pausa, reanudación, pestaña oculta y velocidades aceleradas por separado.

## Validación y objetivos

Primer objetivo propuesto: 30 FPS estables a 1920×1080 en el equipo afectado, mediana ≤33,3 ms y p95 ≤40 ms; objetivo posterior de 60 FPS con calidad ajustada, mediana ≤16,7 ms y p95 ≤20 ms. Son metas, no resultados demostrados ni promesas de multiplicación de FPS.

Mantener pruebas independientes para: archipiélago con muchos árboles y pocas criaturas; cámara cercana/lejana; mundo maduro con 500/1.500 criaturas; edición de terreno; crecimiento/tala/incendios; guardado y restauración; sesiones prolongadas. Añadir pruebas deterministas de compactación de instancias y conservación del estado.

Las pruebas actuales limitan llamadas de dibujo y exigen FPS, pero `performance.spec.js` no impone presupuesto de triángulos. Añadir presupuestos de instancias activas y geometría por escenario, más p95/p99 en un equipo identificado. Ejecutar las comparaciones gráficas de forma secuencial. No declarar rendimiento resuelto solo porque haya menos de 120 llamadas o pasen pruebas funcionales.

## Orden recomendado

Línea base → compactación de instancias → detalle por distancia y sectores → sombras/resolución/efectos → CPU y simulación bajo carga → regresión visual y mediciones finales. No hace falta empezar migrando de motor ni reescribiendo el juego.
