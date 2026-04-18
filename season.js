// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — season.js
// Bloc 4 : Moteur saisonnier + Standings
// ═══════════════════════════════════════════════════════════════
//
// CORRECTIONS v2 :
//   - Seed aléatoire à l'init (résultats différents chaque simulation)
//   - nextSeason() pour progresser 2025→2026→2027...
//   - getTopScorers / getTopAssists filtrable par ligue
//   - Storage versionné par année
//
// ───────────────────────────────────────────────────────────────

'use strict';

const SeasonEngine = (() => {

  const SEASON_START = 2025;

  // ─── INIT SEASON ───────────────────────────────────────────
  function initSeason(canon, seasonYear) {
    const year  = seasonYear || SEASON_START;
    // Seed aléatoire : résultats différents à chaque nouvelle saison
    const seed  = year * 10000 + Math.floor(Math.random() * 9999);
    const leagues = {};

    for (const [lgId, lg] of Object.entries(canon.leagues)) {
      const clubs = Object.values(canon.clubs)
        .filter(c => c.league === lgId)
        .map(c => c.id);

      const fixtures = MatchEngine.generateFixtures(clubs);
      const totalRounds = Math.max(...fixtures.map(f => f.round));

      leagues[lgId] = {
        id:          lgId,
        name:        lg.name,
        clubs,
        fixtures,
        totalRounds,
        currentRound: 0,
        results:     [],
        standings:   _initStandings(clubs),
        topScorer:   null,
        topAssist:   null,
      };
    }

    return {
      year,
      seed,
      currentRound: 0,
      maxRound:     Math.max(...Object.values(leagues).map(l => l.totalRounds)),
      leagues,
      playerStats:  {},
      finished:     false,
    };
  }

  // ─── NEXT SEASON ───────────────────────────────────────────
  // Appelé quand la saison est terminée : crée la saison N+1
  // Les classements de la saison écoulée sont passés en historique
  function nextSeason(currentSeason, canon) {
    if (!currentSeason.finished) return currentSeason;
    const nextYear = currentSeason.year + 1;
    const fresh = initSeason(canon, nextYear);
    fresh.history = currentSeason.history || [];
    fresh.history.push({
      year:      currentSeason.year,
      champions: _extractChampions(currentSeason, canon),
    });
    return fresh;
  }

  function _extractChampions(season, canon) {
    const champs = {};
    for (const [lgId, league] of Object.entries(season.leagues)) {
      const table = Object.values(league.standings)
        .sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);
      if (table[0]) {
        const club = canon.clubs[table[0].id];
        champs[lgId] = {
          clubId:   table[0].id,
          clubName: club ? club.name : table[0].id,
          pts:      table[0].pts,
          gd:       table[0].gd,
        };
      }
    }
    return champs;
  }

  function _initStandings(clubs) {
    const table = {};
    for (const id of clubs) {
      table[id] = {
        id, played:0, won:0, drawn:0, lost:0,
        gf:0, ga:0, gd:0, pts:0, form:[],
      };
    }
    return table;
  }

  // ─── SIMULATE ROUND ────────────────────────────────────────
  function simulateRound(season, canon) {
    if (season.finished) return season;

    const nextRound = season.currentRound + 1;
    const updated   = { ...season, currentRound: nextRound };
    updated.leagues = { ...season.leagues };
    updated.playerStats = { ...season.playerStats };

    for (const [lgId, league] of Object.entries(season.leagues)) {
      if (league.currentRound >= league.totalRounds) continue;

      const roundNum = league.currentRound + 1;
      const fixtures = league.fixtures.filter(f => f.round === roundNum);
      if (!fixtures.length) continue;

      const results = MatchEngine.simulateRound(fixtures, {
        canon,
        seed: season.seed + lgId.charCodeAt(0)*100 + roundNum * 7,
        // Les tactiques sont injectées dans chaque match via simulateRound → simulateMatch
        // CLUB_TACTICS est global dans index.html ; season.js accède via context
        _tactics: (typeof CLUB_TACTICS !== 'undefined') ? CLUB_TACTICS : {},
      });

      const newStandings = JSON.parse(JSON.stringify(league.standings));
      const newResults   = [...league.results];

      for (const r of results) {
        const hId = r.home.id;
        const aId = r.away.id;
        const hg  = r.score.home;
        const ag  = r.score.away;

        newResults.push({
          round:  roundNum,
          home:   hId,
          away:   aId,
          score:  r.score,
          result: r.result,
          events: r.events,
          xi:     r.xi,
          ratings:r.ratings,
          motm:   r.motm,
        });

        const h = newStandings[hId];
        const a = newStandings[aId];
        if (!h || !a) continue;

        h.played++; h.gf += hg; h.ga += ag; h.gd = h.gf - h.ga;
        a.played++; a.gf += ag; a.ga += hg; a.gd = a.gf - a.ga;

        if (r.result === 'home') {
          h.won++; h.pts += 3; a.lost++;
          h.form = MatchEngine.updateForm(h.form, 'W');
          a.form = MatchEngine.updateForm(a.form, 'L');
        } else if (r.result === 'away') {
          a.won++; a.pts += 3; h.lost++;
          h.form = MatchEngine.updateForm(h.form, 'L');
          a.form = MatchEngine.updateForm(a.form, 'W');
        } else {
          h.drawn++; h.pts++; a.drawn++; a.pts++;
          h.form = MatchEngine.updateForm(h.form, 'D');
          a.form = MatchEngine.updateForm(a.form, 'D');
        }

        _updatePlayerStats(updated.playerStats, r, lgId);
      }

      updated.leagues[lgId] = {
        ...league,
        currentRound: roundNum,
        results:      newResults,
        standings:    newStandings,
      };
    }

    const allDone = Object.values(updated.leagues)
      .every(l => l.currentRound >= l.totalRounds);
    if (allDone) updated.finished = true;

    return updated;
  }

  // ─── SIMULATE ALL REMAINING ROUNDS ─────────────────────────
  function simulateAll(season, canon, onProgress) {
    let s = season;
    while (!s.finished) {
      s = simulateRound(s, canon);
      if (onProgress) onProgress(s);
    }
    return s;
  }

  // ─── PLAYER STATS ──────────────────────────────────────────
  function _updatePlayerStats(stats, matchResult, lgId) {
    for (const ev of (matchResult.events || [])) {
      if (ev.type !== 'goal') continue;

      const sid = ev.scorer?.id || ev.scorer?.name;
      if (sid) {
        if (!stats[sid]) stats[sid] = _emptyStats(sid);
        stats[sid].goals++;
        stats[sid].league = lgId;
      }

      const aid = ev.assistant?.id || ev.assistant?.name;
      if (aid) {
        if (!stats[aid]) stats[aid] = _emptyStats(aid);
        stats[aid].assists++;
        // Ne pas écraser la ligue principale du buteur
        if (!stats[aid].league) stats[aid].league = lgId;
      }
    }

    for (const [pid, rating] of Object.entries(matchResult.ratings || {})) {
      if (!stats[pid]) stats[pid] = _emptyStats(pid);
      stats[pid].matches++;
      stats[pid].totalRating += rating;
      stats[pid].avgRating   =
        Math.round(stats[pid].totalRating / stats[pid].matches * 10) / 10;
      if (!stats[pid].league) stats[pid].league = lgId;
    }

    const motmId = matchResult.motm?.id || matchResult.motm?.name;
    if (motmId) {
      if (!stats[motmId]) stats[motmId] = _emptyStats(motmId);
      stats[motmId].motm++;
    }
  }

  function _emptyStats(id) {
    return {
      id, goals:0, assists:0, matches:0,
      totalRating:0, avgRating:6.0, motm:0,
      cleanSheets:0, league:null,
    };
  }

  // ─── SORTED STANDINGS ──────────────────────────────────────
  function getSortedStandings(league) {
    return Object.values(league.standings).sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
    );
  }

  // ─── TOP SCORERS — filtrables par ligue ────────────────────
  // leagueId optionnel : si fourni, filtre par championnat
  function getTopScorers(season, canon, limit=10, leagueId=null) {
    return Object.entries(season.playerStats)
      .filter(([_, s]) => s.goals > 0)
      .filter(([_, s]) => !leagueId || s.league === leagueId)
      .map(([id, s]) => {
        const player = canon.players[id] ||
          Object.values(canon.players).find(p => p.name === id);
        return { ...s, id, player };
      })
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
      .slice(0, limit);
  }

  function getTopAssists(season, canon, limit=10, leagueId=null) {
    return Object.entries(season.playerStats)
      .filter(([_, s]) => s.assists > 0)
      .filter(([_, s]) => !leagueId || s.league === leagueId)
      .map(([id, s]) => {
        const player = canon.players[id] ||
          Object.values(canon.players).find(p => p.name === id);
        return { ...s, id, player };
      })
      .sort((a, b) => b.assists - a.assists || b.goals - a.goals)
      .slice(0, limit);
  }

  // ─── LAST RESULTS ──────────────────────────────────────────
  function getLastResults(league, n=5) {
    return league.results.slice(-n);
  }

  // ─── STORAGE ───────────────────────────────────────────────
  // ─── LIGUES PRINCIPALES (résultats conservés) ───────────
  const MAIN_LEAGUES = [
    'PRO_LIGA','LA_LIGA','ANDRO_LEAGUE','JUBA_LIGA',
    'TECHNO_LEAGUE','LIGA_NOS','LIGA_ONE',
  ];

  // ─── FORMAT SLIM ──────────────────────────────────────────
  // Fixtures = JAMAIS stockées (régénérées depuis le seed)
  // Results ligues principales = slim (score + motm)
  // Results ligues fantômes = vides (standings suffisent)
  // playerStats = seulement les champs nécessaires aux awards
  function _slimSeason(season) {
    return {
      year:         season.year,
      seed:         season.seed,
      currentRound: season.currentRound,
      maxRound:     season.maxRound,
      finished:     season.finished,
      history:      season.history || [],
      playerStats: Object.fromEntries(
        Object.entries(season.playerStats || {})
          .filter(([_, v]) => v.matches > 0)
          .map(([k, v]) => [k, {
            goals:     v.goals     || 0,
            assists:   v.assists   || 0,
            matches:   v.matches   || 0,
            avgRating: v.avgRating || 6.0,
            motm:      v.motm      || 0,
            league:    v.league    || null,
          }])
      ),
      leagues: Object.fromEntries(
        Object.entries(season.leagues || {}).map(([lgId, lg]) => [lgId, {
          id:           lg.id,
          name:         lg.name,
          clubs:        lg.clubs,
          totalRounds:  lg.totalRounds,
          currentRound: lg.currentRound,
          standings:    lg.standings,
          // Ligues principales : résultats slim / Ligues fantômes : vide
          results: MAIN_LEAGUES.includes(lgId)
            ? (lg.results || []).map((r, ri) => ({
                round:  r.round,
                home:   r.home,
                away:   r.away,
                score:  r.score,
                result: r.result,
                motm:   r.motm
                  ? { name: r.motm.name, rating: r.motm.rating }
                  : null,
                // Slim events: juste scorer+assistant+minute pour le modal
                events: (r.events || []).map(ev => ({
                  type:      ev.type,
                  minute:    ev.minute,
                  home:      ev.home,
                  scorer:    ev.scorer  ? { name: ev.scorer.name, position: ev.scorer.position } : null,
                  assistant: ev.assistant ? { name: ev.assistant.name } : null,
                })),
                // XI slim: juste nom + poste + OVR pour la compo
                xi: {
                  home: (r.xi?.home||[]).map(p=>({ name:p.name, position:p.position, slotPosition:p.slotPosition, ovr:p.ovr })),
                  away: (r.xi?.away||[]).map(p=>({ name:p.name, position:p.position, slotPosition:p.slotPosition, ovr:p.ovr })),
                },
                // Ratings slim
                ratings: r.ratings || {},
              }))
            : [],
          // fixtures : jamais stockées
        }])
      ),
    };
  }

  // ─── STORAGE (IndexedDB via EQ_DB) ────────────────────────
  // saveSeason : fire-and-forget async (l'état en mémoire est la source de vérité)
  // loadSeason : async — doit être appelé depuis boot() avec await
  // clearSeason: async

  function saveSeason(season) {
    try {
      const slim = _slimSeason(season);
      EQ_DB.set('eq_season', slim).catch(e => console.error('[Season] Sauvegarde IDB:', e));
    } catch(e) {
      console.error('[Season] Erreur slim:', e);
    }
  }

  async function loadSeason() {
    try {
      const slim = await EQ_DB.get('eq_season');
      if (!slim) return null;
      // Régénère les fixtures depuis la liste de clubs (jamais stockées)
      for (const lg of Object.values(slim.leagues || {})) {
        if (!lg.fixtures && lg.clubs && lg.clubs.length > 0) {
          try { lg.fixtures = MatchEngine.generateFixtures(lg.clubs); }
          catch(e) { lg.fixtures = []; }
        }
      }
      return slim;
    } catch(e) {
      console.warn('[Season] Chargement échoué — reset:', e);
      await EQ_DB.del('eq_season').catch(()=>{});
      return null;
    }
  }

  async function clearSeason() {
    await EQ_DB.del('eq_season').catch(()=>{});
    await EQ_DB.del('eq_current_year').catch(()=>{});
  }

  // ─── PUBLIC ────────────────────────────────────────────────
  return {
    initSeason,
    nextSeason,
    simulateRound,
    simulateAll,
    getSortedStandings,
    getTopScorers,
    getTopAssists,
    getLastResults,
    saveSeason,
    loadSeason,
    clearSeason,
  };

})();

if (typeof module !== 'undefined') module.exports = SeasonEngine;
