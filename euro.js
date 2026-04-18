// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — euro.js
// Bloc 8 : Euro Equestria — Tournoi des nations
// ═══════════════════════════════════════════════════════════════
//
// EuroEngine gère :
//   - Sélection nationale (top 26 joueurs par nation)
//   - Phase de groupes (6 groupes × 4 nations, round-robin)
//   - Qualification : top 2/groupe (12) + meilleurs 4 troisièmes = 16
//   - Phases knockout : R16 → QF → SF → Finale (match sec)
//   - Simulation tick par tick (phase par phase)
//   - Fréquence : tous les N saisons (canon.euro.frequency_seasons)
//
// Architecture : "euro canon" — copie légère du canon avec
//   les nations comme "clubs" et leurs meilleurs joueurs assignés
//
// ───────────────────────────────────────────────────────────────

'use strict';

const EuroEngine = (() => {

  // ─── NATIONS EQUESTRIA ────────────────────────────────────
  // 15 nations avec des joueurs dans le canon + 9 fictives pour compléter à 24
  const NATION_META = {
    ishgar:        { name: 'Ishgar',         flag: '⚔️',  color: '#e11d48', abbr: 'ISH' },
    brislovia:     { name: 'Brislovia',      flag: '🏔️',  color: '#3b82f6', abbr: 'BRI' },
    savanna:       { name: 'Savanna',        flag: '🦁',  color: '#f59e0b', abbr: 'SAV' },
    bermudes:      { name: 'Bermudes',       flag: '🌊',  color: '#06b6d4', abbr: 'BER' },
    javanie:       { name: 'Javanie',        flag: '🌴',  color: '#10b981', abbr: 'JAV' },
    desertiqua:    { name: 'Desertiqua',     flag: '🏜️',  color: '#d97706', abbr: 'DES' },
    paysTropMignon:{ name: 'Pays Trop Mignon', flag: '🌸', color: '#ec4899', abbr: 'PTM' },
    wales:         { name: 'Walisia',        flag: '🐉',  color: '#dc2626', abbr: 'WAL' },
    porespagne:    { name: 'Porespagne',     flag: '🌹',  color: '#c026d3', abbr: 'POR' },
    crannbanie:    { name: 'Crannbanie',     flag: '🌙',  color: '#6366f1', abbr: 'CRA' },
    wesfalie:      { name: 'Wesfalie',       flag: '⚡',  color: '#64748b', abbr: 'WES' },
    vulgarie:      { name: 'Vulgarie',       flag: '🗡️',  color: '#7c3aed', abbr: 'VUL' },
    paxifista:     { name: 'Paxifista',      flag: '☮️',  color: '#0ea5e9', abbr: 'PAX' },
    canterlot:     { name: 'Canterlot',      flag: '✨',  color: '#a855f7', abbr: 'CAN' },
    wakanda:       { name: 'Wakanda',        flag: '🌿',  color: '#16a34a', abbr: 'WAK' },
    // 9 nations fictives pour compléter le tableau à 24
    nordheim:      { name: 'Nordheim',       flag: '❄️',  color: '#bfdbfe', abbr: 'NOR' },
    solaris:       { name: 'Solaris',        flag: '☀️',  color: '#fde68a', abbr: 'SOL' },
    aquateria:     { name: 'Aquateria',      flag: '💧',  color: '#67e8f9', abbr: 'AQU' },
    ferria:        { name: 'Ferria',         flag: '⚙️',  color: '#9ca3af', abbr: 'FER' },
    luminia:       { name: 'Luminia',        flag: '🔮',  color: '#c4b5fd', abbr: 'LUM' },
    sylvara:       { name: 'Sylvara',        flag: '🌲',  color: '#4ade80', abbr: 'SYL' },
    pyraxis:       { name: 'Pyraxis',        flag: '🔥',  color: '#f97316', abbr: 'PYR' },
    celestia:      { name: 'Celestia',       flag: '🌟',  color: '#fcd34d', abbr: 'CEL' },
    abyssia:       { name: 'Abyssia',        flag: '🌑',  color: '#374151', abbr: 'ABY' },
  };

  const PHASE_SEQUENCE = ['idle','group_j1','group_j2','group_j3','r16','qf','sf','final','complete'];

  // ─── HELPER TACTIQUES NATIONALES ────────────────────────
  function _natTactics(natId) {
    if (typeof CLUB_TACTICS === 'undefined') return null;
    return CLUB_TACTICS['nat_'+natId]?.formation || CLUB_TACTICS[natId]?.formation || null;
  }


  // ─── UTILS ────────────────────────────────────────────────
  function seededRNG(seed) {
    let s = seed >>> 0;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── SÉLECTION NATIONALE ─────────────────────────────────
  // Retourne les 26 meilleurs joueurs d'une nation
  function buildNationalSquad(nationId, canon, squadSize = 26) {
    const allPlayers = Object.values(canon.players)
      .filter(p => p.nationality === nationId)
      .sort((a, b) => (b.ovr || 0) - (a.ovr || 0));

    if (!allPlayers.length) return [];

    // Garantit au minimum 2 GK dans chaque sélection
    const gks     = allPlayers.filter(p => p.position === 'GK');
    const outfield = allPlayers.filter(p => p.position !== 'GK');

    const mandatoryGKs = gks.slice(0, 2);           // Top 2 GK = obligatoires
    const optionalGKs  = gks.slice(2);              // GK suppl. si budget
    const remaining    = squadSize - mandatoryGKs.length;

    // Remplit le reste avec les meilleurs joueurs (GK suppl. concourent avec les autres)
    const pool = [...outfield, ...optionalGKs].sort((a,b)=>(b.ovr||0)-(a.ovr||0));
    return [...mandatoryGKs, ...pool.slice(0, remaining)];
  }

  // Calcule l'OVR moyen d'une sélection nationale
  function nationStrength(nationId, canon) {
    const squad = buildNationalSquad(nationId, canon, 11);
    if (!squad.length) return 65; // nation fictive
    return Math.round(squad.reduce((s, p) => s + (p.ovr || 70), 0) / squad.length);
  }

  // ─── EURO CANON ──────────────────────────────────────────
  // Crée un canon modifié où les nations jouent comme des clubs
  // Chaque joueur est temporairement réassigné à son "club national"
  function buildEuroCanon(participantIds, baseCanon) {
    // Copie légère — on ne clone que ce qui est nécessaire
    const euroCanon = {
      leagues: {},
      clubs:   {},
      players: {},
    };

    for (const natId of participantIds) {
      const meta = NATION_META[natId] || { name: natId, flag: '🏳️', color: '#888' };

      // Club national fictif
      euroCanon.clubs[natId] = {
        id:       natId,
        name:     meta.name,
        tier:     'top',
        league:   'EURO',
        nation:   natId,
        stadium:  'Euro Arena',
        capacity: 50000,
      };

      // Assignation des joueurs à leur nation
      const squad = buildNationalSquad(natId, baseCanon);
      const fakeSquad = squad.map(p => ({ ...p, club: natId }));

      // Nations fictives (pas de joueurs dans le canon) → génère un squad synthétique
      if (!fakeSquad.length) {
        let hash = 0;
        for (let c = 0; c < natId.length; c++) hash = (hash * 31 + natId.charCodeAt(c)) >>> 0;
        const natRng = seededRNG(hash + 12345);
        const strength = 72 + Math.floor(natRng() * 6);
        // Les 2 premiers = GK obligatoires, puis le reste de l'effectif
        const positions = ['GK','GK','CB','CB','LB','RB','CDM','CM','CM','CAM',
                           'LW','RW','ST','CB','CDM','CM','CAM','ST','LW','RW'];
        for (let i = 0; i < 20; i++) {
          const pos = positions[i];
          fakeSquad.push({
            id:          `${natId}_auto_${i}`,
            name:        `${(NATION_META[natId]?.abbr)||natId} Player ${i+1}`,
            club:        natId,
            nationality: natId,
            position:    pos,
            ovr:         strength - Math.floor(i / 3),
            age:         22 + Math.floor(natRng() * 10),
          });
        }
      }

      for (const p of fakeSquad) {
        euroCanon.players[p.id || p.name] = p;
      }
    }

    return euroCanon;
  }

  // ─── INIT EURO ───────────────────────────────────────────
  function initEuro(canon, season) {
    const cfg  = canon.euro || {};
    const rng  = seededRNG((season.seed || season.year * 10000) + 55555);
    const year = season.year;

    // Participants : les 15 nations réelles + nations fictives jusqu'à 24
    const realNations = Object.keys(NATION_META).filter(n =>
      Object.values(canon.players).some(p => p.nationality === n)
    );
    const fakeNations = Object.keys(NATION_META).filter(n => !realNations.includes(n));
    const needed      = (cfg.teams || 24) - realNations.length;
    const participants = [...realNations, ...fakeNations.slice(0, needed)];

    // Tirage des 6 groupes de 4 (pot par force)
    const sorted = [...participants].sort((a, b) =>
      nationStrength(b, canon) - nationStrength(a, canon)
    );
    const numGroups = cfg.groups || 6;
    const perGroup  = cfg.teams_per_group || 4;
    const groups    = _drawGroups(sorted, numGroups, perGroup, rng);

    // Build the euro canon for simulation
    const euroCanon = buildEuroCanon(participants, canon);

    return {
      phase:        'idle',
      year,
      baseSeed:     (season.seed || year * 10000) + 55555,
      config:       cfg,
      participants,
      euroCanon,
      groups,
      groupResults:   {},
      qualified:      [],
      knockout:       { r16: null, qf: null, sf: null, final: null },
      knockoutBracket:[],
      winner:         null,
      playerStats:    {},  // { pid: { goals, assists, matches, motm } }
      mvp:            null,
    };
  }

  // ─── TIRAGE DES GROUPES ──────────────────────────────────
  // Pot 1 = meilleures nations, Pot 2 = suivantes, etc.
  // Une nation par pot dans chaque groupe
  function _drawGroups(sorted, numGroups, perGroup, rng) {
    const pots = [];
    for (let p = 0; p < perGroup; p++) {
      pots.push(shuffle(sorted.slice(p * numGroups, (p + 1) * numGroups), rng));
    }
    const groups = {};
    const letters = 'ABCDEF'.slice(0, numGroups).split('');
    for (let g = 0; g < numGroups; g++) {
      groups[letters[g]] = pots.map(pot => pot[g]).filter(Boolean);
    }
    return groups;
  }

  // ─── TICK EURO ───────────────────────────────────────────
  function tickEuro(euro, canon) {
    if (euro.phase === 'complete') return euro;
    const idx  = PHASE_SEQUENCE.indexOf(euro.phase);
    const next = PHASE_SEQUENCE[idx + 1];
    const upd  = JSON.parse(JSON.stringify(euro));

    switch (next) {
      case 'group_j1': return _runGroupJourney(upd, canon, 1);
      case 'group_j2': return _runGroupJourney(upd, canon, 2);
      case 'group_j3': return _runGroupJourney(upd, canon, 3);
      case 'r16':    return _runR16(upd, canon);
      case 'qf':     return _runQF(upd, canon);
      case 'sf':     return _runSF(upd, canon);
      case 'final':  return _runFinal(upd, canon);
      default:       return upd;
    }
  }

  // ─── PHASE DE GROUPES ─────────────────────────────────────
  // ─── STATS JOUEURS EURO ──────────────────────────────────
  function _updateEuroStats(stats, matchResult) {
    for (const ev of (matchResult.events || [])) {
      if (ev.type !== 'goal') continue;
      const sid = ev.scorer?.id || ev.scorer?.name;
      const aid = ev.assistant?.id || ev.assistant?.name;
      if (sid) { if (!stats[sid]) stats[sid] = {goals:0,assists:0,matches:0,motm:0,name:ev.scorer?.name||sid}; stats[sid].goals++; }
      if (aid) { if (!stats[aid]) stats[aid] = {goals:0,assists:0,matches:0,motm:0,name:ev.assistant?.name||aid}; stats[aid].assists++; }
    }
    for (const pid of Object.keys(matchResult.ratings || {})) {
      if (!stats[pid]) stats[pid] = {goals:0,assists:0,matches:0,motm:0,name:pid};
      stats[pid].matches++;
    }
    const motmId = matchResult.motm?.id || matchResult.motm?.name;
    if (motmId) { if (!stats[motmId]) stats[motmId] = {goals:0,assists:0,matches:0,motm:0,name:matchResult.motm?.name||motmId}; stats[motmId].motm++; }
  }

  // ─── PHASE DE GROUPES PAR JOURNÉE ───────────────────────
  // round 1/2/3 — chaque appel simule UN round de toutes les poules
  // Fixtures générées selon le schéma round-robin standard à 4 équipes :
  //   J1: 1vs2, 3vs4  |  J2: 1vs3, 2vs4  |  J3: 1vs4, 2vs3
  const GROUP_ROUNDS = [
    [[0,1],[2,3]],  // J1
    [[0,2],[1,3]],  // J2
    [[0,3],[1,2]],  // J3
  ];

  function _runGroupJourney(euro, canon, round) {
    const rng = seededRNG(euro.baseSeed + 1111 + round * 777);
    const ec  = euro.euroCanon;

    for (const [letter, nations] of Object.entries(euro.groups)) {
      if (!euro.groupResults[letter]) {
        euro.groupResults[letter] = {
          results:   [],
          standings: Object.fromEntries(nations.map(n => [n, {
            id:n, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, pts:0
          }])),
        };
      }
      const grp  = euro.groupResults[letter];
      const pairIndices = GROUP_ROUNDS[round - 1] || [];

      for (const [i, j] of pairIndices) {
        const home = nations[i];
        const away = nations[j];
        if (!home || !away) continue;

        const m = MatchEngine.simulateMatch(home, away, {
          canon: ec,
          seed:  rng() * 1000000 | 0,
          homeFormation: _natTactics(home), awayFormation: _natTactics(away),
        });

        grp.results.push({
          home, away, round,
          score:   m.score,
          result:  m.result,
          motm:    m.motm,
          events:  m.events  || [],
          xi:      m.xi      || { home:[], away:[] },
          ratings: m.ratings || {},
        });

        // Stats joueurs
        if (!euro.playerStats) euro.playerStats = {};
        _updateEuroStats(euro.playerStats, m);

        const h = grp.standings[home];
        const a = grp.standings[away];
        if (!h || !a) continue;
        h.played++; h.gf += m.score.home; h.ga += m.score.away; h.gd = h.gf - h.ga;
        a.played++; a.gf += m.score.away; a.ga += m.score.home; a.gd = a.gf - a.ga;
        if (m.result === 'home')      { h.won++; h.pts += 3; a.lost++; }
        else if (m.result === 'away') { a.won++; a.pts += 3; h.lost++; }
        else                          { h.drawn++; h.pts++; a.drawn++; a.pts++; }
      }

      // Trie les standings après chaque journée
      grp.standings = Object.fromEntries(
        Object.values(grp.standings)
          .sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf)
          .map(r => [r.id, r])
      );
    }

    euro.phase = `group_j${round}`;

    // Après J3 : qualification
    if (round === 3) {
      const rng2 = seededRNG(euro.baseSeed + 1999);
      const qualTop2 = [];
      const thirds   = [];
      for (const grp of Object.values(euro.groupResults)) {
        const table = Object.values(grp.standings).sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf);
        if (table[0]) qualTop2.push(table[0].id);
        if (table[1]) qualTop2.push(table[1].id);
        if (table[2]) thirds.push(table[2]);
      }
      const bestThirds = thirds
        .sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf)
        .slice(0, euro.config.best_thirds || 4)
        .map(r => r.id);
      euro.qualified       = shuffle([...qualTop2, ...bestThirds], rng2);
      euro.knockoutBracket = euro.qualified;
    }

    return euro;
  }

  // ─── KNOCKOUT ROUNDS ──────────────────────────────────────
  function _koRound(euro, canon, phaseName, twoLegs = false, neutral = false) {
    const rng     = seededRNG(euro.baseSeed + { r16:2222, qf:3333, sf:4444, final:5555 }[phaseName]);
    const bracket = shuffle([...euro.knockoutBracket], rng);
    const ec      = euro.euroCanon;
    const results = [];
    const winners = [];

    for (let i = 0; i < bracket.length; i += 2) {
      if (i + 1 >= bracket.length) continue;
      const home = bracket[i];
      const away = bracket[i + 1];

      if (twoLegs) {
        const leg1 = MatchEngine.simulateMatch(home, away, { canon: ec, seed: rng()*1000000|0, homeFormation: _natTactics(home), awayFormation: _natTactics(away) });
        const leg2 = MatchEngine.simulateMatch(away, home, { canon: ec, seed: rng()*1000000|0, homeFormation: _natTactics(away), awayFormation: _natTactics(home) });
        const ah   = leg1.score.home + leg2.score.away;
        const aa   = leg1.score.away + leg2.score.home;
        const win  = ah > aa ? home : aa > ah ? away : (rng() < 0.5 ? home : away);
        if (!euro.playerStats) euro.playerStats = {};
        _updateEuroStats(euro.playerStats, leg1);
        _updateEuroStats(euro.playerStats, leg2);
        results.push({ home, away, leg1: leg1.score, leg2: { home: leg2.score.away, away: leg2.score.home }, agg: { home: ah, away: aa }, winner: win });
        winners.push(win);
      } else {
        const m   = MatchEngine.simulateMatch(home, away, { canon: ec, seed: rng()*1000000|0, neutral, homeFormation: _natTactics(home), awayFormation: _natTactics(away) });
        const win = m.result === 'home' ? home : m.result === 'away' ? away : (rng() < 0.5 ? home : away);
        if (!euro.playerStats) euro.playerStats = {};
        _updateEuroStats(euro.playerStats, m);
        results.push({
          home, away, score: m.score, winner: win,
          motm:    m.motm,
          events:  m.events  || [],
          xi:      m.xi      || { home:[], away:[] },
          ratings: m.ratings || {},
        });
        winners.push(win);
      }
    }

    euro.knockout[phaseName] = { results, winners };
    euro.knockoutBracket     = winners;
    euro.phase               = phaseName;
    return euro;
  }

  function _runR16(euro, canon)   { return _koRound(euro, canon, 'r16',   false, false); }
  function _runQF(euro, canon)    { return _koRound(euro, canon, 'qf',    false, false); }
  function _runSF(euro, canon)    { return _koRound(euro, canon, 'sf',    false, false); }
  function _runFinal(euro, canon) {
    euro = _koRound(euro, canon, 'final', false, true);
    euro.winner = euro.knockoutBracket[0] || euro.knockout.final?.winners?.[0] || null;
    euro.phase  = 'complete';
    // Calcule le MVP : meilleur score (goals*6 + assists*4 + motm*3 + matches*0.5)
    const stats = euro.playerStats || {};
    let mvpEntry = null; let topScore = -1;
    for (const [pid, s] of Object.entries(stats)) {
      const sc = (s.goals||0)*6 + (s.assists||0)*4 + (s.motm||0)*3 + (s.matches||0)*0.5;
      if (sc > topScore) { topScore = sc; mvpEntry = { pid, ...s, score: sc }; }
    }
    euro.mvp = mvpEntry;
    return euro;
  }

  // ─── RUN FULL EURO ────────────────────────────────────────
  function runFullEuro(canon, season) {
    let e = initEuro(canon, season);
    const phases = ['group_j1','group_j2','group_j3','r16','qf','sf','final'];
    for (const _ of phases) e = tickEuro(e, canon);
    return e;
  }

  // ─── PHASE LABELS ─────────────────────────────────────────
  function getPhaseLabel(phase) {
    const labels = {
      idle:     'Prêt',
      group_j1: 'Phase de groupes — J1',
      group_j2: 'Phase de groupes — J2',
      group_j3: 'Phase de groupes — J3',
      groups:   'Phase de groupes',
      r16:      'Huitièmes de finale',
      qf:       'Quarts de finale',
      sf:       'Demi-finales',
      final:    'Finale',
      complete: 'Terminé',
    };
    return labels[phase] || phase;
  }

  function getNextPhaseLabel(phase) {
    const idx = PHASE_SEQUENCE.indexOf(phase);
    if (idx < 0 || idx >= PHASE_SEQUENCE.length - 2) return null;
    return getPhaseLabel(PHASE_SEQUENCE[idx + 1]);
  }

  function getNationName(id) {
    return NATION_META[id]?.name || id;
  }
  function getNationFlag(id) {
    return NATION_META[id]?.flag || '🏳️';
  }
  function getNationColor(id) {
    return NATION_META[id]?.color || '#888';
  }

  // ─── STORAGE ──────────────────────────────────────────────
  function saveEuro(euro) {
    EQ_DB.set('eq_euro', euro).catch(e => console.error('[Euro] IDB save:', e));
  }
  async function loadEuro() {
    return EQ_DB.get('eq_euro').catch(() => null);
  }
  async function clearEuro() {
    await EQ_DB.del('eq_euro').catch(()=>{});
  }

  // ─── PUBLIC ───────────────────────────────────────────────
  return {
    initEuro,
    tickEuro,
    runFullEuro,
    getPhaseLabel,
    getNextPhaseLabel,
    getNationName,
    getNationFlag,
    getNationColor,
    buildNationalSquad,
    nationStrength,
    saveEuro,
    loadEuro,
    clearEuro,
    NATION_META,
    PHASE_SEQUENCE,
  };

})();

if (typeof module !== 'undefined') module.exports = EuroEngine;
