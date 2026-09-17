import { TRAITS } from './traits.js';
import { escapeHtml } from './core/text-utils.js';

// The "hand" inspection panel — shows a creature's or settlement's live stats and lets the
// player rename a city or mark a creature as their followed favorite. Pulled out of main.js
// (Fase 8 cleanup) since it's a self-contained renderer: given read access to the current sim
// state it only ever touches its own panel element, never the scene or the simulation itself.
export function createInspectionPanel({ getCreatures, getSettlements, getCivilization, getStatuses, getFollowing, setFollowing, toast, editName }) {
  const inspectPanel = document.getElementById('inspectPanel');
  let inspectedEntity = null;

  const TYPE_LABEL = { herbivore: 'Herbívoro', carnivore: 'Carnívoro', human: 'Humano', orc: 'Orco', elf: 'Elfo', dwarf: 'Enano', zombie: 'Zombi', fish: 'Pez', boar: 'Jabalí', bear: 'Oso', dragon: 'Dragón', demon: 'Demonio', skeleton: 'Esqueleto', mage: 'Mago', fairy: 'Hada', ghost: 'Fantasma', alien: 'Alien' };
  const TYPE_ICON = { herbivore: '🐑', carnivore: '🐺', human: '🧑', orc: '🧌', elf: '🧝', dwarf: '⛏️', zombie: '🧟', fish: '🐟', boar: '🐗', bear: '🐻', dragon: '🐉', demon: '😈', skeleton: '💀', mage: '🧙', fairy: '🧚', ghost: '👻', alien: '👽' };
  const SETTLEMENT_LEVEL_NAMES = ['Aldea', 'Pueblo', 'Ciudad', 'Gran ciudad'];
  const PROFESSION_ICON = { Aldeano: '👤', Leñador: '🪓', Agricultor: '🌾', Constructor: '🔨', Minero: '⛏️', Soldado: '🛡️', Guardia: '🏹', Líder: '⭐', Rey: '👑' };

  function closeInspect() { inspectPanel.classList.add('hidden'); inspectedEntity = null; }

  function bindCloseBtn() {
    document.getElementById('closeInspectBtn').addEventListener('click', closeInspect);
  }

  function showCreatureInspect(c) {
    const civilization = getCivilization(), statuses = getStatuses(), settlements = getSettlements(), following = getFollowing();
    inspectedEntity = { type: 'creature', id: c.id };
    document.getElementById('empiresPanel').classList.add('hidden');
    document.getElementById('historyPanel').classList.add('hidden');
    document.getElementById('lawsPanel').classList.add('hidden');
    document.getElementById('layersPanel').classList.add('hidden');
    const settlement = c.settlementId ? settlements.settlements.find(s => s.id === c.settlementId) : null;
    const empire = settlement ? settlements.empires.find(e => e.id === settlement.empireId) : null;
    const traitsHtml = (c.traits && c.traits.length)
      ? c.traits.filter(id => TRAITS[id]).map(id => `<span class="traitChip" title="${escapeHtml(TRAITS[id].desc)}">${TRAITS[id].icon} ${escapeHtml(TRAITS[id].name)}</span>`).join('')
      : '<span class="traitChip dim">Sin rasgos</span>';
    const subParts = [];
    if (c.sex) subParts.push(c.sex === 'm' ? '♂' : '♀');
    subParts.push(TYPE_LABEL[c.type] || c.type);
    subParts.push(`${Math.floor(c.age)} años`);
    const isFav = following?.id === c.id;
    const civ = civilization?.describeCreature?.(c);
    const statusHtml = statuses?.describe?.(c).map(status => `<span class="traitChip statusChip">${status.icon} ${escapeHtml(status.label)} · ${status.remaining}s</span>`).join('') || '';
    inspectPanel.innerHTML = `
      <button class="closeBtn" id="closeInspectBtn">✕</button>
      <button class="favoriteBtn${isFav ? ' active' : ''}" id="favoriteBtn" title="${isFav ? 'Dejar de seguir' : 'Marcar como favorito y seguir'}">⭐</button>
      <div class="inspectHead">
        <div class="inspectIcon">${TYPE_ICON[c.type]}</div>
        <div>
          <div class="inspectName">${escapeHtml(c.name || TYPE_LABEL[c.type] || c.type)}</div>
          <div class="inspectSub">${subParts.join(' · ')}</div>
        </div>
      </div>
      ${c.profession ? `<div class="inspectRow"><b>Profesión:</b> ${escapeHtml(c.profession)}</div>` : ''}
      ${civ ? `<div class="inspectRow"><b>Nivel:</b> ${civ.level} · <b>Experiencia:</b> ${Math.floor(civ.xp)} · <b>Bajas:</b> ${civ.kills}</div>` : ''}
      ${civ ? `<div class="inspectRow"><b>Felicidad:</b> ${civ.happiness}% · <b>Linaje biológico:</b> ${escapeHtml(civ.subspeciesName || '—')}</div>` : ''}
      ${civ?.cultureName ? `<div class="inspectRow"><b>Cultura:</b> ${escapeHtml(civ.cultureName)} · <b>Idioma:</b> ${escapeHtml(civ.languageName || '—')}</div>` : ''}
      ${civ?.religionName ? `<div class="inspectRow"><b>Religión:</b> ${escapeHtml(civ.religionName)}</div>` : ''}
      ${civ?.genome ? `<div class="inspectRow"><b>Genes:</b> fuerza ${civ.genome.strength} · vitalidad ${civ.genome.vitality} · fertilidad ${civ.genome.fertility} · frío ${civ.genome.cold} · calor ${civ.genome.heat}</div>` : ''}
      ${civ?.clanName ? `<div class="inspectRow"><b>Clan:</b> ${escapeHtml(civ.clanName)}</div>` : ''}
      ${civ?.partnerName ? `<div class="inspectRow"><b>Pareja:</b> ${escapeHtml(civ.partnerName)}</div>` : ''}
      ${civ?.parentNames?.length ? `<div class="inspectRow"><b>Padres:</b> ${civ.parentNames.map(escapeHtml).join(' y ')}</div>` : ''}
      ${civ?.children ? `<div class="inspectRow"><b>Hijos:</b> ${civ.children}</div>` : ''}
      ${civ?.items?.length ? `<div class="inspectRow"><b>Inventario:</b> ${civ.items.map(escapeHtml).join(' · ')}</div>` : ''}
      ${civ?.memories?.length ? `<div class="inspectRow"><b>Recuerdos:</b> ${civ.memories.map(escapeHtml).join(' · ')}</div>` : ''}
      ${settlement ? `<div class="inspectRow"><b>Hogar:</b> ${escapeHtml(settlement.name)}${empire ? ' · ' + escapeHtml(empire.name) : ''}</div>` : ''}
      ${c.infected ? `<div class="inspectRow">☠️ <b>Infectado</b></div>` : ''}
      ${statusHtml ? `<div class="traitsRow">${statusHtml}</div>` : ''}
      <div class="barRow"><span>❤️ Salud</span><div class="barTrack"><div class="barFill health" style="width:${Math.max(0, Math.min(100, (c.health / Math.max(1, c.maxHealth)) * 100))}%"></div></div></div>
      <div class="barRow"><span>🍗 Hambre</span><div class="barTrack"><div class="barFill hunger" style="width:${Math.max(0, Math.min(100, c.hunger))}%"></div></div></div>
      <div class="traitsRow">${traitsHtml}</div>
    `;
    bindCloseBtn();
    document.getElementById('favoriteBtn').addEventListener('click', () => {
      setFollowing(getFollowing()?.id === c.id ? null : c);
      showCreatureInspect(c);
    });
    inspectPanel.classList.remove('hidden');
  }

  function showSettlementInspect(s) {
    const civilization = getCivilization(), settlements = getSettlements(), creatures = getCreatures();
    inspectedEntity = { type: 'settlement', id: s.id };
    document.getElementById('empiresPanel').classList.add('hidden');
    document.getElementById('historyPanel').classList.add('hidden');
    document.getElementById('lawsPanel').classList.add('hidden');
    document.getElementById('layersPanel').classList.add('hidden');
    const empire = settlements.empires.find(e => e.id === s.empireId);
    const king = empire ? creatures.creatures.find(c => c.id === empire.kingId && c.alive) : null;
    const isCapital = empire && empire.capitalId === s.id;
    const atWar = [];
    if (empire) {
      for (const [otherId, rel] of empire.relations) {
        if (rel.status === 'war') {
          const other = settlements.empires.find(e => e.id === otherId);
          if (other) atWar.push(other.name);
        }
      }
    }
    const residents = creatures.creatures.filter(c => c.alive && c.settlementId === s.id);
    const profCounts = {};
    for (const c of residents) { const p = c.profession || 'Aldeano'; profCounts[p] = (profCounts[p] || 0) + 1; }
    const profHtml = Object.entries(profCounts).map(([p, n]) => `<span class="traitChip">${PROFESSION_ICON[p] || '👤'} ${escapeHtml(p)} ×${n}</span>`).join('');
    const r = s.resources || { wood: 0, food: 0, stone: 0, gold: 0, gems: 0 };
    const civ = civilization?.describeSettlement?.(s);
    const wallRepair = settlements.describeWallRepair?.(s);
    inspectPanel.innerHTML = `
      <button class="closeBtn" id="closeInspectBtn">✕</button>
      <button class="editBtn" id="renameSettlementBtn" title="Renombrar aldea">✏️</button>
      <div class="inspectHead">
        <div class="inspectIcon">🏘️</div>
        <div>
          <div class="inspectName">${escapeHtml(s.name)}${isCapital ? ' 👑' : ''}</div>
          <div class="inspectSub">${escapeHtml(SETTLEMENT_LEVEL_NAMES[s.level] || 'Asentamiento')}${empire ? ' · ' + escapeHtml(empire.name) : ''}</div>
        </div>
      </div>
      <div class="inspectRow"><b>Población:</b> ${s.pop}</div>
      ${wallRepair ? `<div class="inspectRow">${escapeHtml(wallRepair)}</div>` : ''}
      <div class="inspectRow"><b>Casas:</b> ${s.houses.length} · <b>Granjas:</b> ${s.farms ? s.farms.length : 0}</div>
      <div class="inspectRow"><b>Recursos:</b> 🪵 ${Math.floor(r.wood)} · 🌾 ${Math.floor(r.food)} · 🪨 ${Math.floor(r.stone)} · 🪙 ${Math.floor(r.gold || 0)} · 💎 ${Math.floor(r.gems || 0)}</div>
      <div class="inspectRow"><b>Producción:</b> ⛏️ ${Math.floor(r.ore || 0)} mineral · 🛠️ ${Math.floor(r.tools || 0)} herramientas · ⚔️ ${Math.floor(r.weapons || 0)} armas · 🛡️ ${Math.floor(r.armor || 0)} armaduras · 📦 ${Math.floor(r.goods || 0)} bienes</div>
      ${civ?.buildings?.length ? `<div class="inspectRow"><b>Edificios:</b> ${civ.buildings.map(escapeHtml).join(', ')}</div>` : ''}
      ${civ ? `<div class="inspectRow"><b>Defensa urbana:</b> ${civ.siegeHealth}</div>` : ''}
      ${civ?.cultureName ? `<div class="inspectRow"><b>Identidad:</b> ${escapeHtml(civ.cultureName)} (${escapeHtml(civ.cultureValue)}) · ${escapeHtml(civ.languageName || '—')}</div>` : ''}
      ${civ?.religionName ? `<div class="inspectRow"><b>Religión:</b> ${escapeHtml(civ.religionName)} · principio de ${escapeHtml(civ.religionTenet)}</div>` : ''}
      ${civ ? `<div class="inspectRow"><b>Bienestar:</b> ${civ.happiness}% · <b>Cohesión:</b> ${civ.cohesion}%</div>` : ''}
      ${civ?.traditions?.length ? `<div class="inspectRow"><b>Tradiciones:</b> ${civ.traditions.map(escapeHtml).join(', ')}</div>` : ''}
      ${king ? `<div class="inspectRow"><b>Rey:</b> ${escapeHtml(king.name)}</div>` : ''}
      ${!isCapital ? `<div class="inspectRow"><b>Lealtad:</b> ${Math.round(s.loyalty ?? 100)}%</div>` : ''}
      ${atWar.length ? `<div class="inspectRow">⚔️ <b>En guerra con:</b> ${atWar.map(escapeHtml).join(', ')}</div>` : ''}
      <div class="traitsRow">${profHtml}</div>
    `;
    bindCloseBtn();
    document.getElementById('renameSettlementBtn').addEventListener('click', async () => {
      const name = await editName('Nombre de la ciudad', s.name);
      if (name != null && settlements.renameSettlement(s, name)) {
        showSettlementInspect(s);
        toast(`✏️ Aldea renombrada a ${s.name}`, { history: false });
      }
    });
    inspectPanel.classList.remove('hidden');
  }

  // Called once a tick from the main loop so a health bar or resource count in an open panel
  // keeps moving instead of freezing at whatever it read when the player opened it.
  function refreshIfOpen() {
    if (!inspectedEntity || inspectPanel.classList.contains('hidden')) return;
    if (inspectedEntity.type === 'creature') {
      const c = getCreatures().creatures.find(item => item.id === inspectedEntity.id && item.alive);
      if (c) showCreatureInspect(c); else closeInspect();
    } else {
      const s = getSettlements().settlements.find(item => item.id === inspectedEntity.id);
      if (s) showSettlementInspect(s); else closeInspect();
    }
  }

  return { showCreatureInspect, showSettlementInspect, closeInspect, refreshIfOpen, TYPE_LABEL };
}
