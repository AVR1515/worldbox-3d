# Fase A — Línea base (A-01)

Fecha de ejecución: 8 de septiembre de 2026.

## Versión y estado del repositorio

- Commit: `06d631f` ("changes to /docs"), rama `master`.
- `package.json`: `worldbox-3d` v0.8.0.
- Working tree limpio al iniciar esta sesión (sin cambios locales pendientes).
- **Hallazgo:** el commit `06d631f` borró `docs/ROADMAP.md` y `docs/GRAPHICS.md` sin actualizar `README.md`, que todavía enlaza a `docs/ROADMAP.md` (línea 101) — enlace roto. El contenido de `ROADMAP.md` incluía un inventario de modelos 3D pendientes y notas técnicas (Three.js desactualizado 25 minors, asset de 152 MB sin procesar, formaciones militares no implementadas espacialmente) que no está duplicado en `docs/PLAN-JUEGO-COMPLETO.md`. Recuperable vía `git show 06d631f -- docs/ROADMAP.md`. Pendiente decidir: restaurar, fusionar en el nuevo plan, o confirmar que se descarta a propósito.

## Entorno de ejecución

| Campo | Valor |
| --- | --- |
| SO | Windows 11 Home, build 10.0.26200, 64-bit |
| CPU | Intel Core i5-10300H @ 2.50GHz, 4 núcleos / 8 hilos |
| RAM | 15.8 GB |
| GPU | Doble GPU: Intel UHD Graphics (integrada, 1 GB reportado) + NVIDIA GeForce GTX 1650 Ti (dedicada, ~4 GB) — **sin confirmar todavía cuál usa Edge/Chromium por defecto**; crítico para Fase C (no comparar GPU real con software) |
| Resolución primaria reportada (.NET, con escala DPI ya aplicada) | 2194 × 1234 — pendiente confirmar resolución física y % de escala exactos |
| Node.js | v24.20.0 (instalado durante esta sesión; antes no estaba disponible en el PATH del entorno de herramientas) |
| Corepack | 0.35.0 |
| pnpm | 11.19.0 (vía `corepack pnpm`; hay actualización disponible a 12.3.4, no aplicada) |
| Microsoft Edge | 152.0.4191.66 |
| Navegador de Playwright | canal `msedge` (config fija en `playwright.config.js`) |

**Nota de entorno:** `corepack enable` falla con `EPERM` al intentar escribir shims en `C:\Program Files\nodejs` (requiere permisos elevados). Workaround usado: invocar `corepack pnpm <comando>` directamente, sin instalar los shims globales. No bloquea nada, pero cualquier flujo que asuma `pnpm` en el PATH global fallará hasta que se ejecute `corepack enable` como administrador o se agregue un shim de usuario.

## Pruebas unitarias (`pnpm test:unit` → vitest)

**Resultado: 28/28 archivos de test pasan, 113/113 pruebas pasan.** Coincide con lo reportado previamente en el plan. Duración ~13 s.

## Compilación de producción (`pnpm build` → vite)

**Resultado: éxito.** 118 módulos transformados, build en 1.15 s.

- `dist/assets/index-*.js`: **1.05 MB** (313 KB gzip) — vite advierte que supera los 500 KB recomendados por chunk; no es un error, pero es candidato a code-splitting si se quiere reducir el tiempo de carga inicial (no evaluado su impacto real todavía).
- `dist/assets/menu-world-*.jpg`: 218 KB.
- No hubo errores ni advertencias de compilación de código.

## Pruebas de navegador (`pnpm test:e2e` → Playwright, canal msedge)

**Resultado inicial: 19/20 pasan, 1 falla.** Duración total 3.9 min, 1 worker (secuencial).

**Fallo encontrado y corregido en esta misma sesión:** `tests/e2e/archipelago.spec.js:3` — "crea un archipiélago desde el menú del juego" agotaba el timeout de 120 s esperando que `#saveBtn` fuera clicable (205 reintentos, "element is not visible"). **Causa raíz confirmada jugando la partida en vivo:** `#saveBtn` vive dentro de `#pauseMenu` (oculto por defecto) y solo se vuelve visible al pulsar `#gameMenuBtn` — exactamente lo que hace el helper `generateWorld()` de `tests/e2e/game.spec.js:36-37` antes de clicar `#saveBtn`, pero que a este test le faltaba. **No es un bug del juego**, es un test desactualizado/incompleto. Corregido añadiendo `await page.locator('#gameMenuBtn').click();` antes del clic en `#saveBtn` (commit pendiente). Reejecutado en aislado: **pasa en 10.1 s**.

**Resultado final: 20/20 pasan.** Cobertura incluye: generación de mundo pequeño/mediano/grande, ciclo guardado/carga, migración de guardado local v2→IndexedDB, minimapa/ajustes/ranuras, **ejecutar los 52 poderes sin error de ejecución**, gráficos Ultra y persistencia de ajustes, sombras en terreno editado (alta/ultra), menú responsive, océano, pausa+guardado, presupuesto de rendimiento con 500/1.500 unidades, recarga conservando partida, ríos, archipiélago, y carga en servidor estático sin bundler.

## Cambios realizados durante esta sesión de Fase A

1. `serve.ps1` — fallback para localizar `node.exe` en `Program Files` cuando no está en el PATH del proceso (afecta solo al arranque del servidor de desarrollo local, no a producción).
2. `tests/e2e/archipelago.spec.js` — añadido el clic en `#gameMenuBtn` que faltaba antes de `#saveBtn` (test roto, no juego roto).

## Pendiente de esta fase

1. Completar resultado de e2e arriba.
2. Confirmar qué GPU usa realmente Edge (chrome://gpu) antes de cualquier medición de rendimiento (Fase C).
3. Confirmar resolución física y escala de pantalla exactas.
4. Decidir el destino del contenido borrado de `docs/ROADMAP.md` / `docs/GRAPHICS.md` y arreglar el enlace roto en `README.md`.
5. Matriz funcional completa (A-02) — en construcción, ver `docs/FASE-A-MATRIZ-FUNCIONAL.md`.
