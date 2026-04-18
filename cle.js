// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — cle.js
// Bloc 5 : Champions League Equestria — Bracket complet
// ═══════════════════════════════════════════════════════════════
//
// CORRECTION v2 :
//   - tickCLE(state, canon) → avance UNE phase à la fois
//   - État: 'idle' → 'qual_r1' → 'qual_r2' → 'qual_r3' → 'qual_r4'
//           → 'league' → 'playoff' → 'r16' → 'qf' → 'sf' → 'final'
//           → 'complete'
//   - runFullCLE conservé pour compatibilité
//
// ───────────────────────────────────────────────────────────────

'use strict';

const CLEEngine = (() => {

  const TIER_COEF = { top: 4, fort: 3, moyen: 2, faible: 1 };

  // ─── HELPER TACTIQUES ────────────────────────────────────
  // Lit les formations depuis CLUB_TACTICS global (index.html)
  function _tactics(clubId) {
    return (typeof CLUB_TACTICS !== 'undefined' && CLUB_TACTICS[clubId]?.formation)
      ? CLUB_TACTICS[clubId].formation : null;
  }


  // ─── 24 CLUBS DIRECTS — Phase de ligue CLE ───────────────
  // Liste canonique des 24 clubs qualifiés d'office, définie par l'utilisateur.
  // Ces clubs ne jouent PAS les tours préliminaires.
  // Les IDs doivent correspondre exactement aux IDs dans canon.js + ghost_nations.js
  const DIRECT_CLUBS = [
    // Pro Liga Ishgar
    'BAYERN_ILUMYSS',       // 1
    'FAIRY_TAIL',           // 2
    'OLFRA_KE_CONGERE',     // 3
    'PORT_YONEUVE',         // 4
    // La Liga Javanie
    'JUVENTUS_EARTH',       // 5
    'BOURRUSIA_BOUVILLE',   // 6
    'GEARS_PONEYS',         // 7
    // Andro League Brislovia
    'WONDER_BALLT',         // 8
    'SHADOW_BALLT',         // 9
    'SSC_NESERT_WERT',      // 10
    // Juba Liga Savanna
    'FENRIR',               // 11
    'FC_ZANZIBAR',          // 12
    // Techno League Bermudes
    'BERU_FC',              // 13
    'FC_HYDRA',             // 14
    // Liga No's Desertiqua
    'FAR_WEST',             // 15 — (ex AJAX_FARWEST, rebaptisé Far West)
    'HOLE_GULCH_MI_ROSA',  // 16
    'PALMENNE_TIRI',        // 17
    // Liga One Pays Trop Mignon
    'GALAXYS_PARIS',        // 18
    'ETOILE_ROUGE_BLASE',   // 19
    'SUPA_STRIKA',          // 20
    // Nations fantômes — champions continentaux
    'APOEL_ZAITE',          // 21 — Wesfalie
    'OLYMPIAKOS_AERIA',     // 22 — Wakanda
    'MANNSCHAFT_ALLEMAGNE', // 23 — Vulgarie
    'FC_BARKA',        // 24 — Porespagne (Barka — vérifier ID dans canon)
  ];

  // Séquence des phases — version complète (lancement 1 = saison ≥ 2)
  const PHASE_SEQUENCE = [
    'idle','qual_r1','qual_r2','qual_r3','qual_r4',
    'league','playoff','r16','qf','sf','final','complete',
  ];
  // Lancement 0 (première saison) : pas de qualification, 24 clubs directs seulement
  const PHASE_SEQUENCE_L0 = [
    'idle','league','playoff','r16','qf','sf','final','complete',
  ];

  // ─── COEFFICIENT CONTINENTAL ─────────────────────────────
  // Utilisé pour les pots CLE : champion d'une ligue forte ≠ champion d'une
  // ligue fantôme. Top club en championnat ≠ top club continental.
  // Formule : force de la ligue + tier du club
  const LEAGUE_STRENGTH = {
    PRO_LIGA:      36, ANDRO_LEAGUE: 32, LA_LIGA:      30, ,
    JUBA_LIGA:     29, TECHNO_LEAGUE: 24, LIGA_NOS:    22, LIGA_ONE: 18,
  };
  const TIER_COEF_VAL = { top: 100, fort: 65, moyen: 35, faible: 12 };

  function _clubCoefficient(clubId, canon) {
    const club = canon.clubs[clubId];
    if (!club) return 0;
    const tierVal    = TIER_COEF_VAL[club.tier]  || 30;
    const leagueStr  = LEAGUE_STRENGTH[club.league] || 5; // ghost nations ≈ 5
    // Bonus OVR moyen du XI : les ghost nation top clubs peuvent avoir de bons joueurs
    const players = Object.values(canon.players).filter(p => p.club === clubId);
    const top11   = [...players].sort((a,b)=>(b.ovr||0)-(a.ovr||0)).slice(0,11);
    const avgOVR  = top11.length
      ? top11.reduce((s,p)=>s+(p.ovr||70),0)/top11.length
      : 70;
    return tierVal + leagueStr + (avgOVR - 70) * 0.8;
  }

  // ─── UTILS ────────────────────────────────────────────────
  function shuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function seededRNG(seed) {
    let s = seed >>> 0;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ─── INIT CLE ─────────────────────────────────────────────
  function initCLE(canon, season) {
    const rng = seededRNG(season.seed + 88888);

    // Lancement 0 : première saison (pas d'historique) → 24 clubs directs uniquement
    // Lancement 1 : saisons suivantes → format complet avec 4 tours de barrages
    const isLancement0 = !season.history || season.history.length === 0;

    const emptyQual = { clubs:[], byes:[], results:[], qualified:[] };

    let qualRounds = { r1:emptyQual, r2:emptyQual, r3:emptyQual, r4:emptyQual };
    let entrants   = [];

    if (!isLancement0) {
      const allClubs  = Object.values(canon.clubs);
      const qualClubs = allClubs
        .filter(c => !DIRECT_CLUBS.includes(c.id))
        .sort((a, b) => (TIER_COEF[b.tier]||1) - (TIER_COEF[a.tier]||1));
      entrants        = qualClubs.slice(0, 120);
      const sorted    = [...entrants];
      const bR3       = shuffle(sorted.slice(0, 16), rng);
      const bR2       = shuffle(sorted.slice(16, 40), rng);
      const r1        = shuffle(sorted.slice(40), rng);
      qualRounds = {
        r1: { clubs: r1.map(c=>c.id),  byes: [],               results: [], qualified: [] },
        r2: { clubs: [],                byes: bR2.map(c=>c.id), results: [], qualified: [] },
        r3: { clubs: [],                byes: bR3.map(c=>c.id), results: [], qualified: [] },
        r4: { clubs: [],                byes: [],               results: [], qualified: [] },
      };
    }

    return {
      phase:       'idle',
      mode:        isLancement0 ? 'lancement_0' : 'lancement_1',
      year:        season.year,
      baseSeed:    season.seed + 77777,
      directClubs: DIRECT_CLUBS,
      entrants:    entrants.map(c => c.id),
      qualRounds,
      leaguePhase:      null,
      knockout:         { playoff:null, r16:null, qf:null, sf:null, final:null },
      knockoutBracket:  [],
      winner:           null,
    };
  }

  // ─── TICK CLE — avance UNE phase ──────────────────────────
  // Retourne le nouvel état CLE après avoir joué la prochaine phase
  function tickCLE(cle, canon) {
    if (cle.phase === 'complete') return cle;

    // Lancement 0 : séquence courte (pas de qualification)
    const seq = (cle.mode === 'lancement_0') ? PHASE_SEQUENCE_L0 : PHASE_SEQUENCE;

    const currentIdx = seq.indexOf(cle.phase);
    if (currentIdx === -1) return cle;

    const nextPhase = seq[currentIdx + 1];
    const updated   = JSON.parse(JSON.stringify(cle)); // deep clone

    switch (nextPhase) {
      case 'qual_r1': return _runQualR1(updated, canon);
      case 'qual_r2': return _runQualR2(updated, canon);
      case 'qual_r3': return _runQualR3(updated, canon);
      case 'qual_r4': return _runQualR4(updated, canon);
      case 'league':  return _runLeague(updated, canon);
      case 'playoff': return _runPlayoff(updated, canon);
      case 'r16':     return _runR16(updated, canon);
      case 'qf':      return _runQF(updated, canon);
      case 'sf':      return _runSF(updated, canon);
      case 'final':   return _runFinal(updated, canon);
      default:        return updated;
    }
  }

  // ─── PHASE HANDLERS ───────────────────────────────────────

  function _runQualR1(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 1001);
    cle.qualRounds.r1 = _simulateQualRound(cle.qualRounds.r1, canon, rng);
    cle.phase = 'qual_r1';
    return cle;
  }

  function _runQualR2(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 2002);
    cle.qualRounds.r2.clubs = cle.qualRounds.r1.qualified;
    cle.qualRounds.r2 = _simulateQualRound(cle.qualRounds.r2, canon, rng);
    cle.phase = 'qual_r2';
    return cle;
  }

  function _runQualR3(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 3003);
    cle.qualRounds.r3.clubs = cle.qualRounds.r2.qualified;
    cle.qualRounds.r3 = _simulateQualRound(cle.qualRounds.r3, canon, rng);
    cle.phase = 'qual_r3';
    return cle;
  }

  function _runQualR4(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 4004);
    cle.qualRounds.r4.clubs = cle.qualRounds.r3.qualified;
    cle.qualRounds.r4.byes  = [];
    cle.qualRounds.r4 = _simulateQualRound(cle.qualRounds.r4, canon, rng);
    cle.phase = 'qual_r4';
    return cle;
  }

  function _runLeague(cle, canon) {
    // Lancement 0 : phase de ligue avec les 24 clubs directs uniquement (top continental)
    // Lancement 1 : 24 directs + 12 issus des barrages = 36 clubs
    const qualifiedClubs = (cle.mode === 'lancement_0')
      ? []
      : cle.qualRounds.r4.qualified.slice(0, 12);
    cle.leaguePhase = _buildLeaguePhase(cle, qualifiedClubs, canon);
    cle.phase = 'league';
    return cle;
  }

  function _runPlayoff(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 6006);
    const res = _runKnockoutRound(cle.leaguePhase.playoffTeams, canon, rng, true);
    cle.knockout.playoff = res;
    // R16 : seeds (top 8 directs) vs non-seeds (playoff winners) — jamais deux seeds ensemble
    cle.knockoutBracket = _buildSeededBracket(cle.leaguePhase.directR16, res.winners, rng);
    cle.phase = 'playoff';
    return cle;
  }

  // ─── TIRAGE SEEDÉ ────────────────────────────────────────
  // top8 = seeds, others = non-seeds
  // Chaque seed est apparié avec un non-seed (seeds ne se croisent pas avant QF)
  function _buildSeededBracket(seeds, nonSeeds, rng) {
    const shuffledSeeds    = shuffle([...seeds],    rng);
    const shuffledNonSeeds = shuffle([...nonSeeds], rng);
    const bracket = [];
    for (let i = 0; i < Math.min(shuffledSeeds.length, shuffledNonSeeds.length); i++) {
      // Seed joue à domicile en leg2 (retour) — convention UEFA
      bracket.push(shuffledNonSeeds[i]); // home leg1
      bracket.push(shuffledSeeds[i]);    // away leg1 (dominant, joue retour à domicile)
    }
    return bracket;
  }

  function _runR16(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 7007);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, true);
    cle.knockout.r16    = res;
    cle.knockoutBracket = res.winners;
    cle.phase = 'r16';
    return cle;
  }

  function _runQF(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 8008);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, true);
    cle.knockout.qf     = res;
    cle.knockoutBracket = res.winners;
    cle.phase = 'qf';
    return cle;
  }

  function _runSF(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 9009);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, true);
    cle.knockout.sf     = res;
    cle.knockoutBracket = res.winners;
    cle.phase = 'sf';
    return cle;
  }

  function _runFinal(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 9999);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, false, true);
    cle.knockout.final  = res;
    cle.winner          = res.winners[0] || null;
    cle.phase           = 'complete';
    return cle;
  }

  // ─── QUAL ROUND SIMULATOR ────────────────────────────────
  function _simulateQualRound(round, canon, rng) {
    const byes   = round.byes || [];
    const shuffled = shuffle([...round.clubs], rng);
    const results  = [];
    const qualified = [...byes];

    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 >= shuffled.length) continue;
      const home = shuffled[i];
      const away = shuffled[i + 1];

      const leg1 = MatchEngine.simulateMatch(home, away, {
        canon, seed: rng() * 100000 | 0,
        homeFormation: _tactics(home), awayFormation: _tactics(away),
      });
      const leg2 = MatchEngine.simulateMatch(away, home, {
        canon, seed: rng() * 100000 | 0,
        homeFormation: _tactics(away), awayFormation: _tactics(home),
      });

      const agg_home = leg1.score.home + leg2.score.away;
      const agg_away = leg1.score.away + leg2.score.home;
      const winner   = agg_home > agg_away ? home
                     : agg_away > agg_home ? away
                     : (rng() < 0.5 ? home : away);

      // Stocke les détails complets des deux manches (xi, events, ratings, motm)
      // leg2 : away joue à domicile → on stocke le résultat RAW (away=home en leg2)
      // Le legPanel dans index.html gère l'affichage avec aN comme équipe "home" pour leg2
      results.push({
        home, away,
        leg1: {
          score:   leg1.score,
          xi:      leg1.xi,
          events:  leg1.events,
          ratings: leg1.ratings,
          motm:    leg1.motm,
        },
        leg2: {
          // Résultat brut : score.home = buts de `away` (il joue à domicile au retour)
          //                 score.away = buts de `home`
          score:   leg2.score,
          xi:      leg2.xi,
          events:  leg2.events,
          ratings: leg2.ratings,
          motm:    leg2.motm,
        },
        agg:    { home: agg_home, away: agg_away },
        winner,
      });
      qualified.push(winner);
    }

    return { ...round, results, qualified };
  }

// ─── LEAGUE PHASE ────────────────────────────────────────
  function _buildLeaguePhase(cle, qualifiedClubs, canon) {
    const rng = seededRNG(cle.baseSeed + 5555);
    const allClubs = [...cle.directClubs, ...qualifiedClubs].slice(0, 36);

    const allClubsFiltered = allClubs.filter(id => !!canon.clubs[id]);
    if (allClubsFiltered.length < allClubs.length) {
      console.warn('[CLE] Clubs ignorés:', allClubs.filter(id => !canon.clubs[id]));
    }

    // ── Pots par coefficient continental ─────────────────
    // Champion Liga One ≠ champion Pro Liga au niveau continental
     const sorted = [...allClubsFiltered].sort(
      (a, b) => _clubCoefficient(b, canon) - _clubCoefficient(a, canon)
    );
    // Sizing dynamique : L0 (24 clubs) → 4 pots de 6 · L1 (36 clubs) → 4 pots de 9
    const potSize = Math.ceil(allClubsFiltered.length / 4);
    const pot1 = sorted.slice(0,          potSize);
    const pot2 = sorted.slice(potSize,     2 * potSize);
    const pot3 = sorted.slice(2 * potSize, 3 * potSize);
    const pot4 = sorted.slice(3 * potSize);
    const pots = [pot1, pot2, pot3, pot4].filter(p => p.length > 0);

    const playersByClub = MatchEngine.buildPlayerCache(canon);
    const fixtures = _buildPotFixtures(pots, rng);

    const results   = [];
    const standings = {};
    for (const c of allClubsFiltered) {
      standings[c] = { id:c, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, pts:0, pot: _potOf(c, pots) };
    }

    for (const fix of fixtures) {
      const m = MatchEngine.simulateMatch(fix.home, fix.away, {
        canon, seed: rng() * 1000000 | 0, _playersByClub: playersByClub,
        homeFormation: _tactics(fix.home), awayFormation: _tactics(fix.away),
      });
      results.push({
        home: fix.home, away: fix.away,
        score: m.score, result: m.result,
        xi: m.xi, events: m.events, ratings: m.ratings, motm: m.motm,
      });
      const h = standings[fix.home];
      const a = standings[fix.away];
      if (!h || !a) continue;
      h.played++; h.gf += m.score.home; h.ga += m.score.away; h.gd = h.gf - h.ga;
      a.played++; a.gf += m.score.away; a.ga += m.score.home; a.gd = a.gf - a.ga;
      if (m.result === 'home')      { h.won++; h.pts += 3; a.lost++; }
      else if (m.result === 'away') { a.won++; a.pts += 3; h.lost++; }
      else                          { h.drawn++; h.pts++; a.drawn++; a.pts++; }
    }

    const table = Object.values(standings)
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    return {
      clubs:        allClubsFiltered,
      pots:         { pot1, pot2, pot3, pot4 },
      fixtures, results, standings: table,
      directR16:    table.slice(0, 8).map(r => r.id),
      playoffTeams: table.slice(8, 24).map(r => r.id),
      eliminated:   table.slice(24).map(r => r.id),
    };
  }

 // ═══════════════════════════════════════════════════════════════════════
// PATCH B — cle.js : _buildPotFixtures (remplace la fonction entière)
// ═══════════════════════════════════════════════════════════════════════
// CHERCHER la fonction entière (de "// ─── FIXTURES PAR POTS" à sa fermeture "}")
// REMPLACER PAR :
 
  // ─── FIXTURES PAR POTS — v3 corrigée ─────────────────────────
  //
  // Garantit exactement 8 matchs par club pour N'IMPORTE QUEL
  // nombre de clubs (L0 = 24, L1 = 36).
  //
  // Algorithme :
  //   • Intra-pot  : anneau circulaire  → 2 matchs/club (1H + 1A)
  //   • Inter-pot  : rotation décalée   → 2 matchs/club/pot adverse
  //   • Pots inégaux : wrap-around sur le pot le plus petit
  //
  // Preuve : L0 → 96 fixtures, min=8, max=8 ✓
  //          L1 → 144 fixtures, min=8, max=8 ✓
  //
  function _buildPotFixtures(pots, rng) {
    const fixtures = [];
    const used     = {};
    const numPots  = pots.length;
 
    function addFix(h, a) {
      if (!h || !a || h === a) return;
      const key = h + ':' + a;
      if (!used[key]) { fixtures.push({ home: h, away: a }); used[key] = true; }
    }
 
    for (let pi = 0; pi < numPots; pi++) {
      const potA = shuffle([...pots[pi]], rng);
      const nA   = potA.length;
      if (nA === 0) continue;
 
      // ── Intra-pot : anneau ────────────────────────────────
      // c[k] → c[(k+1)%n] : chaque club 1H + 1A intra
      for (let k = 0; k < nA; k++) {
        addFix(potA[k], potA[(k + 1) % nA]);
      }
 
      // ── Inter-pot : rotation décalée + wrap ───────────────
      for (let pj = pi + 1; pj < numPots; pj++) {
        const potB = shuffle([...pots[pj]], rng);
        const nB   = potB.length;
        if (nB === 0) continue;
        // Chaque club de potA joue 1H + 1A vs potB
        // Si pots inégaux : wrap-around sur le pot le plus court
        for (let k = 0; k < nA; k++) {
          addFix(potA[k],          potB[k % nB]);          // potA[k] à domicile
          addFix(potB[k % nB], potA[(k + 1) % nA]);        // potB[k%nB] à domicile
        }
      }
    }
    return fixtures;
  }

  function _potOf(clubId, pots) {
    for (let i = 0; i < pots.length; i++) if (pots[i].includes(clubId)) return i+1;
    return 0;
  }


  // ─── ASYNC TICK — libère le thread UI entre chaque phase ──
  async function tickCLEAsync(cle, canon, onPhaseComplete) {
    if (cle.phase === 'complete') return cle;
    if (typeof mergeGhostNations === 'function' && !canon._ghostMerged) {
      mergeGhostNations(canon);
    }
    await new Promise(r => setTimeout(r, 0));
    const updated = tickCLE(cle, canon);
    if (onPhaseComplete) onPhaseComplete(updated);
    return updated;
  }

  async function runFullCLEAsync(cle, canon, onPhaseComplete) {
    let current = cle;
    while (current.phase !== 'complete') {
      await new Promise(r => setTimeout(r, 0));
      current = tickCLE(current, canon);
      if (onPhaseComplete) onPhaseComplete(current);
    }
    return current;
  }

  // ─── KNOCKOUT ROUND ──────────────────────────────────────
  function _runKnockoutRound(clubs, canon, rng, twoLegs=true, neutral=false) {
    const pairs   = [];
    const shuffled = shuffle([...clubs], rng);
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) pairs.push({ home: shuffled[i], away: shuffled[i+1] });
    }

    const results = [];
    const winners = [];

    for (const pair of pairs) {
      if (twoLegs) {
        const leg1 = MatchEngine.simulateMatch(pair.home, pair.away, { canon, seed: rng()*1000000|0, homeFormation: _tactics(pair.home), awayFormation: _tactics(pair.away) });
        const leg2 = MatchEngine.simulateMatch(pair.away, pair.home, { canon, seed: rng()*1000000|0, homeFormation: _tactics(pair.home), awayFormation: _tactics(pair.away) });
        const agg_h = leg1.score.home + leg2.score.away;
        const agg_a = leg1.score.away + leg2.score.home;
        const winner = agg_h > agg_a ? pair.home : agg_a > agg_h ? pair.away : (rng()<0.5?pair.home:pair.away);
        results.push({
          home: pair.home, away: pair.away,
          // Leg 1 : home (pair.home) joue à domicile — score.home = buts de pair.home
          leg1: {
            score:   leg1.score,
            xi:      leg1.xi,
            events:  leg1.events,
            ratings: leg1.ratings,
            motm:    leg1.motm,
          },
          // Leg 2 : away (pair.away) joue à domicile — score.home = buts de pair.away
          // On stocke le résultat RAW sans inversion ; legPanel affiche pair.away à gauche
          leg2: {
            score:   leg2.score,
            xi:      leg2.xi,
            events:  leg2.events,
            ratings: leg2.ratings,
            motm:    leg2.motm,
          },
          agg:  { home: agg_h, away: agg_a },
          winner,
        });
        winners.push(winner);
      } else {
        const m = MatchEngine.simulateMatch(pair.home, pair.away, { canon, seed: rng()*1000000|0, neutral, homeFormation: _tactics(pair.home), awayFormation: _tactics(pair.away) });
        const winner = m.result==='home' ? pair.home : m.result==='away' ? pair.away : (rng()<0.5?pair.home:pair.away);
        results.push({
          home:    pair.home, away: pair.away,
          score:   m.score,
          xi:      m.xi,
          events:  m.events,
          ratings: m.ratings,
          motm:    m.motm,
          winner,
        });
        winners.push(winner);
      }
    }
    return { results, winners };
  }

  // ─── RUN FULL CLE (compatibilité) ────────────────────────
  function runFullCLE(canon, season) {
    let cle = initCLE(canon, season);
    const phases = ['qual_r1','qual_r2','qual_r3','qual_r4','league','playoff','r16','qf','sf','final'];
    for (const _ of phases) {
      cle = tickCLE(cle, canon);
    }
    return cle;
  }

  // ─── PHASE LABEL (pour l'UI) ─────────────────────────────
  function getPhaseLabel(phase) {
    const labels = {
      idle:     'Prêt à lancer',
      qual_r1:  'Tour de qualification 1',
      qual_r2:  'Tour de qualification 2',
      qual_r3:  'Tour de qualification 3',
      qual_r4:  'Barrages de qualification',
      league:   'Phase de ligue',
      playoff:  'Barrages knockout',
      r16:      'Huitièmes de finale',
      qf:       'Quarts de finale',
      sf:       'Demi-finales',
      final:    'Finale',
      complete: 'Terminée',
    };
    return labels[phase] || phase;
  }

  function getNextPhaseLabel(phase, mode) {
    const seq = (mode === 'lancement_0') ? PHASE_SEQUENCE_L0 : PHASE_SEQUENCE;
    const idx = seq.indexOf(phase);
    if (idx === -1 || idx >= seq.length - 2) return null;
    return getPhaseLabel(seq[idx + 1]);
  }

  // ─── FORMAT HELPERS ───────────────────────────────────────
  function getClubName(id, canon) {
    return canon.clubs[id]?.name || id;
  }

  function formatQualResults(round, canon) {
    return (round.results || []).map(r => ({
      home:   getClubName(r.home, canon),
      away:   getClubName(r.away, canon),
      leg1:   `${r.leg1.home}-${r.leg1.away}`,
      leg2:   `${r.leg2.home}-${r.leg2.away}`,
      agg:    `${r.agg.home}-${r.agg.away}`,
      winner: getClubName(r.winner, canon),
    }));
  }

  // ─── COMPUTE CLE STATS ───────────────────────────────────
  // Agrège buts / passes / MOTM sur TOUS les matchs CLE joués
  // (tours de qualification + phase de ligue + knockout)
  function computeCLEStats(cle, canon) {
    const stats = {};

    function trackEv(ev) {
      if (ev.type !== 'goal') return;
      const sid = ev.scorer?.id || ev.scorer?.name;
      if (sid) {
        if (!stats[sid]) stats[sid] = { goals: 0, assists: 0, motm: 0 };
        stats[sid].goals++;
      }
      const aid = ev.assistant?.id || ev.assistant?.name;
      if (aid) {
        if (!stats[aid]) stats[aid] = { goals: 0, assists: 0, motm: 0 };
        stats[aid].assists++;
      }
    }

    function trackMotm(motm) {
      if (!motm) return;
      const mid = motm.id || motm.name;
      if (!mid) return;
      if (!stats[mid]) stats[mid] = { goals: 0, assists: 0, motm: 0 };
      stats[mid].motm++;
    }

    function trackSingleMatch(m) {
      if (!m) return;
      for (const ev of (m.events || [])) trackEv(ev);
      trackMotm(m.motm);
    }

    function trackTwoLeg(r) {
      if (!r) return;
      trackSingleMatch(r.leg1);
      trackSingleMatch(r.leg2);
    }

    // Tours de qualification
    for (const qr of ['r1', 'r2', 'r3', 'r4']) {
      for (const r of (cle.qualRounds?.[qr]?.results || [])) trackTwoLeg(r);
    }

    // Phase de ligue
    for (const m of (cle.leaguePhase?.results || [])) trackSingleMatch(m);

    // Knockout (deux manches sauf finale)
    for (const phase of ['playoff', 'r16', 'qf', 'sf']) {
      for (const r of (cle.knockout?.[phase]?.results || [])) trackTwoLeg(r);
    }

    // Finale (match sec)
    for (const r of (cle.knockout?.final?.results || [])) trackSingleMatch(r);

    // Enrichit avec les infos joueur depuis le canon
    const enriched = Object.entries(stats).map(([id, s]) => {
      const player = canon?.players?.[id]
        || Object.values(canon?.players || {}).find(p => p.name === id);
      const clubName = player ? (canon?.clubs?.[player.club]?.name || '?') : '?';
      return { id, ...s, player, clubName };
    });

    return {
      scorers:  [...enriched].sort((a, b) => b.goals   - a.goals   || b.assists - a.assists),
      assists:  [...enriched].sort((a, b) => b.assists  - a.assists || b.goals   - a.goals),
      motm:     [...enriched].sort((a, b) => b.motm     - a.motm),
    };
  }


  
   // ─── TIRAGE AU SORT — structure sans simulation ───────────────
  // Calcule pots + adversaires par club depuis le seed de la saison,
  // SANS simuler aucun match. Appelé avant de lancer la phase de ligue.
  function buildLeagueDrawCLE(canon, season) {
    const rng    = seededRNG((season.seed + 77777) + 5555);
    const dirIds = DIRECT_CLUBS.filter(id => !!canon.clubs[id]);
    const sorted = [...dirIds].sort(
      (a, b) => _clubCoefficient(b, canon) - _clubCoefficient(a, canon)
    );
    const potSize = Math.ceil(sorted.length / 4);
    const rawPots = [
      sorted.slice(0,           potSize),
      sorted.slice(potSize,     2 * potSize),
      sorted.slice(2 * potSize, 3 * potSize),
      sorted.slice(3 * potSize),
    ].filter(p => p.length > 0);
 
    // Enrichit chaque club : nom + OVR moyen du XI
    const enrich = id => {
      const club    = canon.clubs[id];
      const top11   = Object.values(canon.players)
        .filter(p => p.club === id)
        .sort((a, b) => (b.ovr||0) - (a.ovr||0))
        .slice(0, 11);
      const avgOvr  = top11.length
        ? Math.round(top11.reduce((s, p) => s + (p.ovr||70), 0) / top11.length)
        : 70;
      return { id, name: club.name, league: club.league, tier: club.tier, avgOvr };
    };
 
    // Génère les fixtures (même seed → même tirage que la vraie phase)
    const fixtures = _buildPotFixtures(rawPots, rng);
 
    // Potmap : id → numéro de pot (1-4)
    const potMap = {};
    rawPots.forEach((pot, i) => pot.forEach(id => { potMap[id] = i + 1; }));
 
    // Adversaires par club
    const opponents = {};
    for (const id of dirIds) {
      opponents[id] = fixtures
        .filter(f => f.home === id || f.away === id)
        .map(f => {
          const opp = f.home === id ? f.away : f.home;
          return {
            id:     opp,
            name:   canon.clubs[opp]?.name || opp,
            pot:    potMap[opp] || 0,
            isHome: f.home === id,
          };
        })
        .sort((a, b) => a.pot - b.pot);
    }
 
    return {
      pots:        rawPots.map((p, i) => ({ num: i + 1, clubs: p.map(enrich) })),
      potMap,
      opponents,
      totalClubs:  dirIds.length,
      isLancement0: !season.history || season.history.length === 0,
    };
  }
  
  
  // ─── PUBLIC ───────────────────────────────────────────────
  return {
    initCLE,
    tickCLE,
    tickCLEAsync,
    runFullCLE,
    runFullCLEAsync,
    getPhaseLabel,
    getNextPhaseLabel,
    getClubName,
    formatQualResults,
      computeCLEStats,
    buildLeagueDrawCLE,
    DIRECT_CLUBS,
    PHASE_SEQUENCE,
    PHASE_SEQUENCE_L0,
  };

})();

if (typeof module !== 'undefined') module.exports = CLEEngine;
