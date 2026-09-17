# WorldBox 3D (WB3D)

Simulador de mundos 3D para navegador, inspirado en WorldBox, construido con [Three.js](https://threejs.org/) y sin dependencias de red en tiempo de ejecución: todo el motor, los modelos y el audio se sirven desde el propio proyecto.

Un mundo generado proceduralmente (terreno, biomas, clima, minerales) se puebla con fauna, criaturas civilizadas (humanos, orcos, elfos, enanos) y criaturas fantásticas. El jugador interviene con más de 50 poderes divinos — terraformar, invocar, bendecir, maldecir, desatar desastres — mientras las civilizaciones crecen de forma autónoma: fundan aldeas, forman clanes y familias, heredan genes, desarrollan cultura/idioma/religión propios, comercian, hacen la guerra y se alían entre sí.

## Estado actual (v0.8.0)

- **Mundo**: terreno con heightmap, 11 biomas, clima y temperatura por celda, ríos, hielo/lava, minerales finitos (piedra/oro/gemas), navegación A* independiente para tierra/agua/aire.
- **Criaturas**: 17 tipos (fauna, civilizadas y fantásticas) con genes heredables, adaptación climática, subespecies emergentes, estados temporales (congelación, veneno, escudo, locura, bendición, maldición) y LOD con instancing para escalar a miles de unidades.
- **Civilización**: familias y clanes, inventario y equipo por individuo, producción en cadena (mineral → herramientas/armas/armaduras), ejércitos persistentes con asedios y murallas, diplomacia y rebeliones, culturas/idiomas/religiones emergentes con felicidad y memoria individual.
- **Poderes y desastres**: 52 poderes agrupados en Mundo/Seres/Poderes/Reino, niveles de explosivo diferenciados (TNT → antimateria), terremotos/incendios/meteoritos naturales opcionales.
- **Interfaz**: minimapa, capas 3D (territorios, ciudades, cultura, idioma, religión, ejércitos), tres ranuras de guardado con miniatura e import/export JSON, historial filtrable, ajustes de calidad/rendimiento/accesibilidad, tutorial inicial, controles táctiles.
- **Guardado**: formato versionado (v8) en IndexedDB con migración automática desde versiones anteriores y respaldo ante corrupción.

## Requisitos

- Node.js 20 o posterior.
- Microsoft Edge para las pruebas de navegador en Windows (en otros sistemas, Chromium para Playwright).

## Preparación y ejecución

```powershell
corepack pnpm install
pnpm dev
```

El juego estará disponible en `http://127.0.0.1:8080`. En Windows también puedes iniciar el servidor con:

```powershell
.\serve.ps1
```

### Usar Live Server de VS Code

Instala las dependencias una vez y luego abre `index.html` con **Open with Live Server**:

```powershell
corepack pnpm install
```

No abras solamente una copia aislada de `index.html`: Live Server debe usar la carpeta raíz completa `WB3D`, porque Three.js se carga desde `node_modules`.

Tras instalar las dependencias, el juego no descarga Three.js ni ningún otro código desde un CDN. La construcción de producción queda en `dist`:

```powershell
pnpm build
pnpm preview
```

## Estructura del proyecto

```
js/
  main.js                 orquesta interfaz, entrada de usuario y el bucle principal
  game-session.js          crea/destruye una partida completa
  game-runtime.js          paso fijo de simulación (FixedStepClock) y orden de actualización
  render-system.js         escena, cámara, luces y renderer de Three.js
  world.js, world-generation(.worker).js   terreno, biomas, clima, ríos, minerales
  creatures.js, models.js  criaturas, genes, IA, modelos 3D y LOD instanciado
  settlements.js, civilization-system.js   aldeas, clanes, producción, ejércitos, diplomacia
  ships.js, navigation.js  rutas navales y A* de tierra/agua/aire
  power-system.js, cataclysm-system.js, status-system.js   poderes, desastres, estados temporales
  save-system.js           guardado versionado en IndexedDB
  core/                    utilidades compartidas (reloj fijo, bus de eventos, índice espacial)
assets/                    modelos .glb/.gltf y texturas usados por la escena
docs/                      hoja de ruta y notas de arquitectura
tests/                     pruebas unitarias (Vitest) y de navegador (Playwright)
```

## Recursos 3D

La mayoría de la geometría (criaturas, edificios, terreno) se genera por código con primitivas de Three.js. `assets/` contiene los modelos `.glb`/`.gltf` reales que se van incorporando progresivamente:

- Archivos sueltos en la raíz de `assets/`: modelos individuales listos para usar (vegetación, rocas, armas, la malla humana base).
- `assets/packs/`: packs de terceros con varias piezas cada uno (animales, props de aldea, mazmorra/entorno volcánico, arquero de fantasía).

Antes de publicar el juego, revisa la licencia de cada pack de terceros en su carpeta (o en la página de origen) y conserva la atribución que exija.

## Diagnóstico

Durante el juego, abre el panel con el botón `📊` o la tecla `F3`. Muestra FPS, tiempo por cuadro, entidades, criaturas detalladas/instanciadas/descartadas por cámara, pasos fijos ejecutados, llamadas de dibujo, triángulos, texturas y los últimos errores capturados. Para inspección automatizada, la misma información está disponible en `window.__WB3D_DIAGNOSTICS__.snapshot()`.

## Guardado

El formato actual es la versión 8 y se almacena en IndexedDB (con respaldo en almacenamiento local si no está disponible). Los guardados de versiones anteriores se detectan y migran automáticamente. Se conservan mundo, rutas, estados, minas, leyes, ajustes, genes, adaptación, familias, recuerdos, felicidad, culturas, idiomas, religiones, clanes, inventarios, niveles, edificios productivos, ejércitos y barcos civiles en curso. El panel 🗃️ ofrece tres ranuras con miniatura, importación y exportación JSON.

## Pruebas

```powershell
pnpm test:unit
pnpm test:e2e
pnpm test:soak
pnpm test
```

Las pruebas unitarias cubren migraciones, familias, genes, adaptación, subespecies, culturas, idiomas, religiones, estados, cataclismos, ranuras, felicidad, recuerdos, producción, diplomacia, navegación, biomas, clima, minerales, rutas, barcos y la infraestructura de simulación. `test:soak` recorre ocho horas simuladas de estados y cataclismos en pasos acelerados. Las pruebas de navegador generan mundos pequeños, medianos y grandes sin solicitudes externas, verifican guardado/carga y migración, y comprueban los presupuestos de 500 y 1.500 criaturas.

## Hoja de ruta

El trabajo en curso (saneamiento técnico, atmósfera y materiales, modelos 3D reales, rendimiento avanzado, contenido nuevo, accesibilidad) está documentado en [docs/ROADMAP.md](docs/ROADMAP.md).
