// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — awards.js
// Bloc 6 : Système de récompenses de fin de saison
// ═══════════════════════════════════════════════════════════════
//
// AwardsEngine calcule :
//   - Ballon d'Or (score pondéré par poste)
//   - Meilleur Gardien
//   - Meilleur Défenseur
//   - Meilleur Milieu
//   - Meilleur Attaquant
//   - Meilleur Jeune (≤ 23 ans)
//   - Soulier d'Or (top scorer)
//   - Soulier d'Argent (top assists)
//   - Meilleur XI (formation 4-3-3)
//   - Champions par ligue
//
// ───────────────────────────────────────────────────────────────

'use strict';

const AwardsEngine = (() => {

  const ATK_POS  = ['ST','LW','RW'];
  const MID_POS  = ['CAM','CM','CDM'];
  const DEF_POS  = ['CB','LB','RB'];
  const GK_POS   = ['GK'];
  const YOUNG_MAX_AGE = 23;

  // ─── SCORE BALLON D'OR ───────────────────────────────────
  // Formule pondérée par poste — ne peut jamais être générique
  function ballonDorScore(player, stats, trophies) {
    const pos = player.position;
    const g   = stats.goals   || 0;
    const a   = stats.assists || 0;
    const r   = stats.avgRating || 6.0;
    const m   = stats.matches || 0;
    const motm = stats.motm   || 0;
    const cs  = stats.cleanSheets || 0;
    const t   = trophies || 0; // titres gagnés dans la saison

    let score = 0;

    if (GK_POS.includes(pos)) {
      // GK : propre feuilles + notes + trophées — peut gagner mais doit être exceptionnel
      score = cs * 4.0 + r * 6.5 + m * 0.3 + motm * 0.8 + t * 8.0;
    } else if (ATK_POS.includes(pos)) {
      score = g * 6.0 + a * 3.0 + r * 3.5 + m * 0.3 + motm * 0.5 + t * 5.0;
    } else if (MID_POS.includes(pos)) {
      score = g * 4.5 + a * 4.5 + r * 4.5 + m * 0.4 + motm * 0.6 + t * 5.0;
    } else if (DEF_POS.includes(pos)) {
      score = cs * 2.5 + r * 5.5 + a * 2.0 + g * 3.0 + m * 0.4 + motm * 0.6 + t * 5.0;
    } else {
      score = g * 4.0 + a * 3.5 + r * 4.0 + m * 0.3 + t * 4.0;
    }

    return Math.round(score * 100) / 100;
  }

  // ─── ENRICHIR LES STATS ──────────────────────────────────
  // Ajoute les clean sheets en estimant depuis les standings
  function enrichStats(playerStats, season, canon) {
    const enriched = { ...playerStats };

    // Estime clean sheets pour les GK en regardant les buts encaissés par club
    for (const [lgId, league] of Object.entries(season.leagues)) {
      const clubGoalsAgainst = {};
      for (const r of league.results) {
        clubGoalsAgainst[r.home] = (clubGoalsAgainst[r.home]||0) + r.score.away;
        clubGoalsAgainst[r.away] = (clubGoalsAgainst[r.away]||0) + r.score.home;
      }

      // Build GK cache once per season call
      if (!canon._gkCache) {
        canon._gkCache = {};
        for (const p of Object.values(canon.players)) {
          if (p.position === 'GK') {
            if (!canon._gkCache[p.club]) canon._gkCache[p.club] = [];
            canon._gkCache[p.club].push(p);
          }
        }
      }
      // Associe les clean sheets aux GKs par club
      for (const [clubId, ga] of Object.entries(clubGoalsAgainst)) {
        const played = league.standings[clubId]?.played || 1;
        const approxCS = Math.max(0, Math.round(played * (1 - ga / (played * 1.2))));
        const gkPlayers = canon._gkCache[clubId] || [];
        for (const gk of gkPlayers) {
          const pid = gk.id || gk.name;
          if (enriched[pid]) enriched[pid].cleanSheets = approxCS;
        }
      }
    }

    return enriched;
  }

  // ─── CHAMPIONS PAR LIGUE ─────────────────────────────────
  function getLeagueChampions(season, canon) {
    const champions = {};
    for (const [lgId, league] of Object.entries(season.leagues)) {
      const table = Object.values(league.standings)
        .sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);
      if (table.length > 0) {
        const champ = table[0];
        champions[lgId] = {
          club: canon.clubs[champ.id] || { name: champ.id },
          stats: champ,
          leagueName: league.name,
        };
      }
    }
    return champions;
  }

  // ─── COMPUTE ALL AWARDS ──────────────────────────────────
  // ─── FUSION STATS CLE ────────────────────────────────────
  // Parcourt les matchs CLE (phase de ligue + KO) et extrait buts/passes/notes
  function _mergeCLEStats(cleData, canon) {
    const extra = {};
    if (!cleData) return extra;

    function _add(pid, goals, assists, rating, motm) {
      if (!pid) return;
      if (!extra[pid]) extra[pid] = { goals:0, assists:0, matches:0, totalRating:0, avgRating:6.0, motm:0 };
      extra[pid].goals   += goals   || 0;
      extra[pid].assists += assists || 0;
      extra[pid].matches += 1;
      extra[pid].totalRating += rating || 6.0;
      extra[pid].avgRating = Math.round(extra[pid].totalRating / extra[pid].matches * 10) / 10;
      extra[pid].motm    += motm ? 1 : 0;
    }

    function _processMatch(m) {
      if (!m) return;
      for (const ev of (m.events || [])) {
        if (ev.type !== 'goal') continue;
        const sid = ev.scorer?.id || ev.scorer?.name;
        const aid = ev.assistant?.id || ev.assistant?.name;
        if (sid) _add(sid, 1, 0, null, false);
        if (aid) _add(aid, 0, 1, null, false);
      }
      for (const [pid, r] of Object.entries(m.ratings || {})) {
        _add(pid, 0, 0, r, false);
      }
      const motmId = m.motm?.id || m.motm?.name;
      if (motmId) _add(motmId, 0, 0, null, true);
    }

    // Phase de ligue
    for (const r of (cleData.leaguePhase?.results || [])) _processMatch(r);

    // Knockout — chaque match (leg1 et leg2)
    for (const round of Object.values(cleData.knockout || {})) {
      for (const r of (round?.results || [])) {
        if (r.leg1) _processMatch({ events: r.leg1.events, ratings: r.leg1.ratings, motm: r.leg1.motm });
        if (r.leg2) _processMatch({ events: r.leg2.events, ratings: r.leg2.ratings, motm: r.leg2.motm });
        if (r.events) _processMatch(r); // finale (single leg)
      }
    }

    return extra;
  }

  // ─── FUSION STATS EURO ───────────────────────────────────
  function _mergeEuroStats(euroData, canon) {
    const extra = {};
    if (!euroData) return extra;

    function _add(pid, goals, assists, rating, motm) {
      if (!pid) return;
      if (!extra[pid]) extra[pid] = { goals:0, assists:0, matches:0, totalRating:0, avgRating:6.0, motm:0 };
      extra[pid].goals   += goals   || 0;
      extra[pid].assists += assists || 0;
      extra[pid].matches += 1;
      extra[pid].totalRating += rating || 6.0;
      extra[pid].avgRating = Math.round(extra[pid].totalRating / extra[pid].matches * 10) / 10;
      extra[pid].motm    += motm ? 1 : 0;
    }

    function _processMatch(m) {
      if (!m) return;
      for (const ev of (m.events || [])) {
        if (ev.type !== 'goal') continue;
        const sid = ev.scorer?.id || ev.scorer?.name;
        const aid = ev.assistant?.id || ev.assistant?.name;
        if (sid) _add(sid, 1, 0, null, false);
        if (aid) _add(aid, 0, 1, null, false);
      }
      for (const [pid, r] of Object.entries(m.ratings || {})) {
        _add(pid, 0, 0, r, false);
      }
      const motmId = m.motm?.id || m.motm?.name;
      if (motmId) _add(motmId, 0, 0, null, true);
    }

    // Phase de groupes (tous les résultats de toutes les poules)
    for (const grp of Object.values(euroData.groupResults || {})) {
      for (const r of (grp.results || [])) _processMatch(r);
    }
    // Knockout
    for (const round of Object.values(euroData.knockout || {})) {
      for (const r of (round?.results || [])) _processMatch(r);
    }

    return extra;
  }

  // ─── FUSION STATS GLOBALE ────────────────────────────────
  function _mergeAllStats(seasonStats, cleData, euroData, canon) {
    const merged = {};

    // Fusion : championnat (base)
    for (const [pid, s] of Object.entries(seasonStats || {})) {
      merged[pid] = { ...s };
    }

    // Fusion : CLE
    const cleExtra = _mergeCLEStats(cleData, canon);
    for (const [pid, s] of Object.entries(cleExtra)) {
      if (!merged[pid]) merged[pid] = { goals:0, assists:0, matches:0, totalRating:0, avgRating:6.0, motm:0 };
      merged[pid].goals   += s.goals;
      merged[pid].assists += s.assists;
      merged[pid].matches += s.matches;
      merged[pid].motm    += s.motm;
      const totalR = (merged[pid].avgRating * (merged[pid].matches - s.matches)) + (s.avgRating * s.matches);
      merged[pid].avgRating = merged[pid].matches > 0
        ? Math.round(totalR / merged[pid].matches * 10) / 10 : 6.0;
    }

    // Fusion : Euro
    const euroExtra = _mergeEuroStats(euroData, canon);
    for (const [pid, s] of Object.entries(euroExtra)) {
      if (!merged[pid]) merged[pid] = { goals:0, assists:0, matches:0, totalRating:0, avgRating:6.0, motm:0 };
      merged[pid].goals   += s.goals;
      merged[pid].assists += s.assists;
      merged[pid].matches += s.matches;
      merged[pid].motm    += s.motm;
      const totalR = (merged[pid].avgRating * (merged[pid].matches - s.matches)) + (s.avgRating * s.matches);
      merged[pid].avgRating = merged[pid].matches > 0
        ? Math.round(totalR / merged[pid].matches * 10) / 10 : 6.0;
    }

    return merged;
  }

  function computeAwards(season, canon, cleData, euroData) {
    // Fusionne les stats de toutes les compétitions
    const rawStats = _mergeAllStats(season.playerStats, cleData, euroData, canon);
    const stats = enrichStats(rawStats, season, canon);

    // Récupère les trophées par club (champion de ligue + CLE)
    const trophiesByClub = {};
    const champions = getLeagueChampions(season, canon);
    for (const [lgId, ch] of Object.entries(champions)) {
      // ch.stats.id est le vrai club ID depuis les standings
      const cid = ch.stats?.id;
      if (cid) trophiesByClub[cid] = (trophiesByClub[cid]||0) + 1;
    }
    if (cleData?.winner) {
      trophiesByClub[cleData.winner] = (trophiesByClub[cleData.winner]||0) + 1;
    }
    // Euro : la nation gagnante = bonus pour les joueurs de cette nation
    // On stocke l'ID de la nation dans euroWinnerNation pour l'utiliser dans ballonDorScore
    const euroWinnerNation = euroData?.winner || null;

    // Enrichit les stats avec les trophées du club du joueur
    const statsList = Object.entries(stats)
      .map(([pid, s]) => {
        const player = canon.players[pid] ||
          Object.values(canon.players).find(p => p.name === pid);
        if (!player) return null;
        const clubTrophies = trophiesByClub[player.club] || 0;
        // Bonus Euro : si le joueur représente la nation championne d'Euro
        const euroBonus = euroWinnerNation && player.nationality === euroWinnerNation ? 1 : 0;
        const bdScore = ballonDorScore(player, s, clubTrophies + euroBonus);
        return { pid, player, stats: s, clubTrophies, bdScore };
      })
      .filter(Boolean)
      .filter(e => e.stats.matches >= 5); // minimum 5 matchs joués

    if (!statsList.length) return _emptyAwards(champions);

    // ── Filtreurs par poste ───────────────────────────────
    const byPos = (positions) =>
      statsList.filter(e => positions.includes(e.player.position));

    const topBy = (list, fn, n=1) =>
      [...list].sort((a,b) => fn(b)-fn(a)).slice(0, n);

    // ── Ballon d'Or ───────────────────────────────────────
    const ballonDorList = topBy(statsList, e => e.bdScore, 10);
    const ballonDor = ballonDorList[0];

    // ── Awards par poste ──────────────────────────────────
    const bestGK  = topBy(byPos(GK_POS),  e => e.stats.avgRating||0 + (e.stats.cleanSheets||0)*0.3)[0];
    const bestDEF = topBy(byPos(DEF_POS), e => e.stats.avgRating||0)[0];
    const bestMID = topBy(byPos(MID_POS), e => e.bdScore)[0];
    const bestATK = topBy(byPos(ATK_POS), e => e.bdScore)[0];

    // ── Meilleur Jeune ────────────────────────────────────
    const youngList = statsList.filter(e => (e.player.age||99) <= YOUNG_MAX_AGE);
    const bestYoung = topBy(youngList, e => e.bdScore)[0];

    // ── Soulier d'Or & Argent ─────────────────────────────
    const goldenBoot   = topBy(statsList, e => e.stats.goals||0)[0];
    const goldenAssist = topBy(statsList, e => e.stats.assists||0)[0];

    // ── Meilleur XI (4-3-3) ───────────────────────────────
    const bestXI = buildBestXI(statsList);

    // ── CLE MVP ──────────────────────────────────────────
    // On cherche le joueur du club vainqueur avec le meilleur score
    let cleMVP = null;
    if (cleData?.winner) {
      const winnerPlayers = statsList.filter(e => e.player.club === cleData.winner);
      if (winnerPlayers.length) {
        cleMVP = topBy(winnerPlayers, e => e.bdScore)[0];
      }
    }

    return {
      season: season.year,
      ballonDor:   formatAward(ballonDor, canon),
      ballonDorTop10: ballonDorList.map(e => formatAward(e, canon)),
      bestGK:      formatAward(bestGK, canon),
      bestDEF:     formatAward(bestDEF, canon),
      bestMID:     formatAward(bestMID, canon),
      bestATK:     formatAward(bestATK, canon),
      bestYoung:   formatAward(bestYoung, canon),
      goldenBoot:  formatAward(goldenBoot, canon),
      goldenAssist: formatAward(goldenAssist, canon),
      cleMVP:      formatAward(cleMVP, canon),
      bestXI,
      champions,
    };
  }

  // ─── MEILLEUR XI ─────────────────────────────────────────
  function buildBestXI(statsList) {
    const slots = {
      GK:  { positions: GK_POS,  count: 1, picks: [] },
      DEF: { positions: DEF_POS, count: 4, picks: [] },
      MID: { positions: MID_POS, count: 3, picks: [] },
      ATK: { positions: ATK_POS, count: 3, picks: [] },
    };
    const usedPids = new Set();

    for (const [slot, cfg] of Object.entries(slots)) {
      const eligible = statsList
        .filter(e => cfg.positions.includes(e.player.position) && !usedPids.has(e.pid))
        .sort((a,b) => b.bdScore - a.bdScore)
        .slice(0, cfg.count);
      cfg.picks = eligible;
      eligible.forEach(e => usedPids.add(e.pid));
    }

    return {
      GK:  slots.GK.picks.map(e => _shortPlayer(e)),
      DEF: slots.DEF.picks.map(e => _shortPlayer(e)),
      MID: slots.MID.picks.map(e => _shortPlayer(e)),
      ATK: slots.ATK.picks.map(e => _shortPlayer(e)),
    };
  }

  // ─── HELPERS ─────────────────────────────────────────────
  function formatAward(entry, canon) {
    if (!entry) return null;
    const p = entry.player;
    const club = canon.clubs[p.club] || { name: p.club };
    return {
      name:       p.name,
      position:   p.position,
      age:        p.age,
      nationality:p.nationality,
      club:       club.name,
      clubId:     p.club,
      goals:      entry.stats.goals   || 0,
      assists:    entry.stats.assists || 0,
      matches:    entry.stats.matches || 0,
      avgRating:  entry.stats.avgRating || 6.0,
      cleanSheets:entry.stats.cleanSheets || 0,
      motm:       entry.stats.motm    || 0,
      bdScore:    entry.bdScore,
      trophies:   entry.clubTrophies  || 0,
    };
  }

  function _shortPlayer(entry) {
    return {
      name:     entry.player.name,
      position: entry.player.position,
      club:     entry.player.club,
      goals:    entry.stats.goals   || 0,
      assists:  entry.stats.assists || 0,
      rating:   entry.stats.avgRating || 6.0,
      bdScore:  entry.bdScore,
    };
  }

  function _emptyAwards(champions) {
    return {
      ballonDor: null, ballonDorTop10: [],
      bestGK: null, bestDEF: null, bestMID: null, bestATK: null,
      bestYoung: null, goldenBoot: null, goldenAssist: null,
      cleMVP: null, bestXI: { GK:[], DEF:[], MID:[], ATK:[] },
      champions,
    };
  }

  // ─── PUBLIC ──────────────────────────────────────────────
  return {
    computeAwards,
    getLeagueChampions,
    ballonDorScore,
  };

})();

if (typeof module !== 'undefined') module.exports = AwardsEngine;
