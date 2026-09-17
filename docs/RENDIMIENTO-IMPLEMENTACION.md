# Mejoras de rendimiento — 10 de septiembre de 2026

## Cambios implementados

- Los árboles mantienen instancias contiguas y dibujan solo las posiciones ocupadas. Al talar, se intercambian la última instancia y el hueco; se actualizan los mapas y se conserva la variación visual por árbol.
- Los modelos completos se conservan cerca. A distancia se usan modelos de 300/100 triángulos preparados fuera del juego, con la misma transformación que el original. No se ejecuta simplificación durante la partida.
- Los árboles se agrupan en sectores de 48 celdas, por especie. Cada sector puede descartarse por separado en la cámara y las sombras. Los niveles de detalle tienen histéresis para evitar oscilaciones. Las existencias y los recursos de la simulación no cambian.
- La hierba recién regenerada se filtra antes de dibujar: antes había cuadros que enviaban toda la hierba aunque la cámara estuviera lejos. En la base se observaron picos de 42,65 millones de triángulos.
- Las normales del agua usan derivadas analíticas en vez de cuatro evaluaciones completas del oleaje por píxel. Las variantes de calidad eliminan del shader los cálculos de efectos desactivados.
- Se elimina el antialiasing fijo del contexto: el ajuste de suavizado utiliza SMAA, evitando pagar MSAA incluso en la ruta con efectos desactivados.
- Se solicita `powerPreference: high-performance`. Es una preferencia, no una garantía de selección de GPU. En estas mediciones Edge siguió usando Intel UHD. No se cambiaron ajustes de Windows ni su registro.
- Se añade resolución automática, con objetivo de 30 FPS, límites e histéresis. La escala puede bajar hasta el 50 % de la resolución configurada; la interfaz HTML permanece nítida. Un porcentaje de resolución explícito se mantiene fijo, salvo activación explícita del ajuste automático.
- El diagnóstico muestra GPU, resolución interna, tiempos CPU por fase, última medición GPU disponible y árboles por nivel de detalle. Las consultas GPU son asíncronas, opcionales al abrir el panel y descartan muestras inválidas; nunca esperan con `finish()`.

## Protocolo

Benchmark de bosque: archipiélago de 180 celdas, semilla 12345, 2.535 árboles y 27 criaturas, ventana de 1920×1080, calidad alta, sombras/bloom/SMAA activos y SSAO desactivado. La distribución es reproducible, aunque no es el guardado exacto de la captura del usuario. El contexto real de las mediciones fue Edge con ANGLE/D3D11 sobre Intel UHD Graphics.

Base original: tres muestras de 60 segundos después de 15 segundos de calentamiento. Medianas de cuadro de 116,7 / 233,1 / 116,7 ms; medianas GPU de 115,6 / 215,5 / 115,6 ms. La segunda muestra empeoró apreciablemente: no se atribuye a una causa térmica o de procesos sin evidencia. La mediana de geometría fue 12.634.313 triángulos y el p95 alcanzó 42.650.057. La simulación avanzó entre el 35,8 % y el 67,0 % del tiempo real.

La comparación posterior separa resolución nativa y adaptativa. No debe atribuirse la mejora obtenida reduciendo píxeles únicamente a la optimización de geometría.

## Evidencia y comandos

- `docs/evidence/forest-before.json`: base original completa.
- `docs/evidence/forest-after-pilot.json`: primera comprobación de instancias/LOD/hierba.
- `docs/evidence/forest-water-pilot.json`: comprobación posterior del agua y sectores de 48 celdas.
- `tests/e2e/forest-benchmark.spec.js`: benchmark optativo; habilitar con `WB3D_FOREST_BENCHMARK=nombre`. Admite `WB3D_VARIANTS=full,adaptive,no-trees,no-shadows,no-post,low-resolution,paused`, duración, calentamiento y repeticiones.
- `tests/e2e/ultra-benchmark.spec.js`: admite calidad y resolución adaptativa mediante `WB3D_QUALITY` y `WB3D_ADAPTIVE=1`, conservando Ultra fijo como configuración original.
- `scripts/build-tree-lods.mjs`: regenera los dos archivos de geometría simplificada a partir de los GLB existentes.

`forest-isolation.json` contiene una primera variante `no-trees` inválida: la carga asíncrona creó los sectores después del ocultamiento. No utilizar esa fila para atribuir coste; el benchmark se corrigió para mantener ocultos los árboles también tras su carga. Las otras variantes corresponden a una versión intermedia, antes de corregir el MSAA fijo y optimizar el agua.

## Límites de la verificación

El requisito histórico de 55 FPS con 500 criaturas de `performance.spec.js` no se cumplió en la Intel UHD (19,23 FPS en su ventana corta). El umbral se conserva. Esa prueba espera solo tres segundos antes de medir y no garantiza que el controlador adaptativo se haya estabilizado. No equivale a una prueba larga ni permite afirmar que se hayan resuelto los objetivos Ultra de 500/1.500 criaturas.

La adaptación de resolución tiene un coste de nitidez en la escena 3D. Puede desactivarse en Gráficos, o fijarse un porcentaje. El detalle de árboles cambia por sectores y puede percibirse al acercarse; las pruebas visuales deben seguir incluyendo panorámica, cercanía y transiciones.
