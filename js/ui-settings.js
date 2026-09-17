// The graphics/simulation/audio/accessibility settings panel and the first-run tutorial
// overlay. Pulled out of main.js (Fase 8 cleanup) — both are pure DOM wiring around a settings
// object main.js still owns (passed in via getUserSettings/setUserSettings so this module always
// sees the live value even when main.js replaces it wholesale, e.g. on load-game).
export function createSettingsPanel({ renderSystem, audioSystem, vfx, getWorld, getCreatures, getUserSettings, setUserSettings, closeInspect }) {
  const settingsPanel = document.getElementById('settingsPanel');
  const graphicsFields = {
    dynamicResolution: ['Ajustar resolución para mantener la fluidez', [['on', 'Activado · objetivo 30 FPS'], ['off', 'Desactivado · resolución fija']]],
    resolution: ['Resolución de renderizado', [['0.75', '75 % · más rendimiento'], ['1', '100 % · nativa'], ['1.25', '125 % · más nitidez'], ['1.5', '150 % · máxima nitidez']]],
    shadowSize: ['Detalle de sombras', [['512', 'Bajo'], ['1024', 'Medio'], ['2048', 'Alto'], ['4096', 'Ultra']]],
    vegetation: ['Detalle de árboles y densidad del pasto', [['sparse', 'Ligero'], ['normal', 'Normal'], ['dense', 'Denso'], ['lush', 'Frondoso']]],
    water: ['Detalle del agua', [['basic', 'Básico'], ['waves', 'Olas'], ['foam', 'Olas y espuma costera'], ['ultra', 'Ultra · oleaje fino y espuma']]],
    viewDistance: ['Distancia de visión', [['near', 'Corta'], ['normal', 'Normal'], ['far', 'Lejana'], ['ultra', 'Muy lejana']]],
    antialias: ['Suavizado de bordes', [['on', 'Activado'], ['off', 'Desactivado']]],
    ambientOcclusion: ['Sombras de contacto', [['on', 'Activadas'], ['off', 'Desactivadas']]],
    ambientOcclusionResolution: ['Detalle de sombras de contacto', [['0.5', 'Equilibrado (50 %)'], ['1', 'Máximo (100 %)']]],
    bloom: ['Resplandor de luces', [['on', 'Activado'], ['off', 'Desactivado']]],
    wind: ['Viento en la vegetación', [['on', 'Activado'], ['off', 'Desactivado']]],
  };
  for (const [key, [title, choices]] of Object.entries(graphicsFields)) {
    const label = document.createElement('label'); label.className = 'panelField';
    const name = document.createElement('span'); name.textContent = title;
    const select = document.createElement('select'); select.id = `${key}Setting`;
    for (const [value, text] of [['auto', 'Según la calidad elegida'], ...choices]) select.add(new Option(text, value));
    select.value = getUserSettings()[key] ?? 'auto';
    label.append(name, select); settingsPanel.append(label);
    select.addEventListener('change', () => { getUserSettings()[key] = select.value; applyUserSettings(); });
  }
  const settingsNav = document.createElement('nav');
  settingsNav.className = 'settingsNav';
  settingsNav.setAttribute('aria-label', 'Categorías de ajustes');
  const settingsContent = document.createElement('div');
  settingsContent.className = 'settingsContent';
  const settingGroups = [
    ['graphics', '◈ Gráficos', 'Ultra ofrece mayor nitidez, sombras y vegetación. Exige más a la tarjeta gráfica.', ['qualitySetting', 'shadowsSetting', ...Object.keys(graphicsFields).map(key => `${key}Setting`)]],
    ['simulation', '🌍 Simulación y guardado', 'El ritmo de tu mundo', ['populationSetting', 'autosaveSetting']],
    ['audio', '♫ Sonido', 'Escucha cómo cobra vida', ['audioSetting']],
    ['accessibility', '◉ Accesibilidad', 'Juega a tu manera', ['motionSetting', 'contrastSetting']],
  ];
  for (const [id, label, description, fields] of settingGroups) {
    const section = document.createElement('section');
    section.dataset.settingsPage = id;
    section.className = 'settingsPage' + (id === 'graphics' ? '' : ' hidden');
    const title = document.createElement('h2'); title.textContent = label;
    const hint = document.createElement('p'); hint.textContent = description;
    section.append(title, hint);
    for (const field of fields) section.append(document.getElementById(field).closest('label'));
    settingsContent.append(section);
    const button = document.createElement('button');
    button.textContent = label; button.dataset.settingsTab = id;
    button.classList.toggle('active', id === 'graphics');
    button.setAttribute('aria-pressed', String(id === 'graphics'));
    button.addEventListener('click', () => {
      settingsNav.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
      settingsContent.querySelectorAll('section').forEach(p => p.classList.toggle('hidden', p.dataset.settingsPage !== id));
    });
    settingsNav.append(button);
  }
  settingsPanel.append(settingsNav, settingsContent);
  const settingsFooter = document.createElement('p');
  settingsFooter.className = 'settingsFooter'; settingsFooter.textContent = 'Los cambios se aplican automáticamente · Esc para volver';
  settingsPanel.append(settingsFooter);

  function applyUserSettings({ persist = true } = {}) {
    const userSettings = getUserSettings();
    userSettings.quality = ['low', 'medium', 'high', 'ultra'].includes(userSettings.quality) ? userSettings.quality : 'high';
    userSettings.populationLimit = Math.max(300, Math.min(2400, Number(userSettings.populationLimit) || 1500));
    userSettings.autosaveSeconds = Math.max(0, Number(userSettings.autosaveSeconds) || 0);
    renderSystem.setGraphics(userSettings);
    getWorld()?.setGraphics(userSettings);
    getCreatures()?.setPopulationLimit(userSettings.populationLimit);
    audioSystem.setEnabled(userSettings.audio !== false);
    document.documentElement.classList.toggle('reduceMotion', Boolean(userSettings.reducedMotion));
    document.documentElement.classList.toggle('highContrast', Boolean(userSettings.highContrast));
    // reduceMotion en el <html> solo frena transiciones CSS del menú; los efectos que giran
    // dentro de la escena 3D (tornados, el marcador de favorito) leen este flag aparte.
    vfx.setSimContext({ reducedMotion: Boolean(userSettings.reducedMotion) });
    if (persist) localStorage.setItem('worldbox3d.settings', JSON.stringify(userSettings));
  }

  function syncSettingsControls() {
    const userSettings = getUserSettings();
    for (const key of Object.keys(graphicsFields)) document.getElementById(`${key}Setting`).value = userSettings[key] ?? 'auto';
    document.getElementById('qualitySetting').value = userSettings.quality;
    document.getElementById('populationSetting').value = String(userSettings.populationLimit);
    document.getElementById('populationSettingValue').textContent = String(userSettings.populationLimit);
    document.getElementById('shadowsSetting').checked = userSettings.shadows !== false;
    document.getElementById('autosaveSetting').value = String(userSettings.autosaveSeconds);
    document.getElementById('audioSetting').checked = userSettings.audio !== false;
    document.getElementById('motionSetting').checked = Boolean(userSettings.reducedMotion);
    document.getElementById('contrastSetting').checked = Boolean(userSettings.highContrast);
  }

  document.getElementById('btnOptionsMenu').addEventListener('click', () => { syncSettingsControls(); settingsPanel.classList.remove('hidden'); document.getElementById('closeSettingsBtn').focus(); });
  document.getElementById('settingsBtn').addEventListener('click', () => {
    const opening = settingsPanel.classList.contains('hidden');
    closeInspect();
    document.querySelectorAll('.sidePanel').forEach(panel => panel.classList.add('hidden'));
    if (opening) { syncSettingsControls(); settingsPanel.classList.remove('hidden'); document.getElementById('closeSettingsBtn').focus(); }
  });
  document.getElementById('closeSettingsBtn').addEventListener('click', () => settingsPanel.classList.add('hidden'));
  for (const id of ['qualitySetting', 'populationSetting', 'shadowsSetting', 'autosaveSetting', 'audioSetting', 'motionSetting', 'contrastSetting']) {
    document.getElementById(id).addEventListener('input', () => {
      setUserSettings({
        ...getUserSettings(),
        quality: document.getElementById('qualitySetting').value,
        populationLimit: Number(document.getElementById('populationSetting').value),
        shadows: document.getElementById('shadowsSetting').checked,
        autosaveSeconds: Number(document.getElementById('autosaveSetting').value),
        audio: document.getElementById('audioSetting').checked,
        reducedMotion: document.getElementById('motionSetting').checked,
        highContrast: document.getElementById('contrastSetting').checked,
      });
      document.getElementById('populationSettingValue').textContent = String(getUserSettings().populationLimit);
      applyUserSettings();
      if (getUserSettings().audio) audioSystem.unlock();
    });
  }

  const tutorialSteps = [
    ['Crea y observa', 'Elige poderes en la barra inferior y aplícalos sobre el terreno. Puedes acercarte, rotar y mover la cámara.'],
    ['Da vida al mundo', 'Invoca fauna, civilizaciones y criaturas fantásticas. Inspecciónalas con la mano para ver salud, genes, recuerdos y estados.'],
    ['Controla la historia', 'Abre capas, leyes, minimapa e historial. Las decisiones políticas, el clima y los desastres cambian la simulación.'],
    ['Protege tu mundo', 'Usa el autoguardado o abre 🗃️ para guardar en tres ranuras, exportar un mundo y recuperarlo después.'],
  ];
  let tutorialIndex = 0;
  function renderTutorial() {
    const [title, body] = tutorialSteps[tutorialIndex];
    document.getElementById('tutorialStep').textContent = `${tutorialIndex + 1} / ${tutorialSteps.length}`;
    document.getElementById('tutorialTitle').textContent = title;
    document.getElementById('tutorialText').textContent = body;
    document.getElementById('nextTutorial').textContent = tutorialIndex === tutorialSteps.length - 1 ? 'Empezar' : 'Siguiente';
  }
  function finishTutorial() { document.getElementById('tutorialOverlay').classList.add('hidden'); localStorage.setItem('worldbox3d.tutorialDone', '1'); }
  function maybeStartTutorial() { if (!localStorage.getItem('worldbox3d.tutorialDone')) { tutorialIndex = 0; renderTutorial(); document.getElementById('tutorialOverlay').classList.remove('hidden'); } }
  document.getElementById('nextTutorial').addEventListener('click', () => { if (++tutorialIndex >= tutorialSteps.length) finishTutorial(); else renderTutorial(); });
  document.getElementById('skipTutorial').addEventListener('click', finishTutorial);

  return { applyUserSettings, syncSettingsControls, maybeStartTutorial };
}
