// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — finance.js
// Bloc 7 : Système financier B+
// ═══════════════════════════════════════════════════════════════
//
// FinanceEngine gère :
//   - Budget par club (tier-based)
//   - Valeurs marchandes (OVR + courbe d'âge)
//   - Revenus saisonniers (position ligue + CLE + affluence)
//   - Masse salariale
//   - FFP simplifié (dépenses ≤ revenus N-1)
//   - Fenêtre de transferts (propositions IA + interaction joueur)
//   - Persistance localStorage
//
// ───────────────────────────────────────────────────────────────

'use strict';

const FinanceEngine = (() => {

  // ─── BUDGETS PAR TIER (millions €) ────────────────────────
  const TIER_BUDGET = {
    top:    { transfer: 180, wages_annual: 80,  revenue_base: 120 },
    fort:   { transfer: 70,  wages_annual: 35,  revenue_base: 55  },
    moyen:  { transfer: 25,  wages_annual: 12,  revenue_base: 22  },
    faible: { transfer: 8,   wages_annual: 4,   revenue_base: 8   },
  };

  // Primes de performance (millions €)
  const LEAGUE_PRIZE = {
    1: 18, 2: 12, 3: 9, 4: 7, 5: 6,
    6: 5,  7: 4,  8: 3, 9: 2, 10: 1,
  };
  const CLE_BONUS = {
    qualification: 2, league_phase: 8, r16: 4, qf: 6,
    sf: 10, final: 8, winner: 15,
  };

  // ─── VALEUR MARCHANDE ────────────────────────────────────
  // Formule : base OVR × multiplicateur âge × multiplicateur poste
  function marketValue(player) {
    const ovr  = player.ovr || 70;
    const age  = player.age || 25;
    const pos  = player.position || 'CM';

    // Courbe valeur vs âge (pic à 26)
    let ageMult;
    if      (age <= 18) ageMult = 0.55;
    else if (age <= 21) ageMult = 0.75 + (age - 18) * 0.05; // 0.75→0.90
    else if (age <= 26) ageMult = 0.90 + (age - 21) * 0.06; // 0.90→1.20
    else if (age <= 29) ageMult = 1.20 - (age - 26) * 0.08; // 1.20→0.96
    else if (age <= 33) ageMult = 0.96 - (age - 29) * 0.12; // 0.96→0.48
    else                ageMult = Math.max(0.10, 0.48 - (age - 33) * 0.08);

    // Multiplicateur par poste (ST/LW/RW = premium)
    const posMult = ['ST','LW','RW'].includes(pos) ? 1.20
                  : ['CAM','CM'].includes(pos)      ? 1.10
                  : ['GK'].includes(pos)            ? 0.80
                  : 1.00;

    // Base exponentielle sur l'OVR : 70 OVR ≈ 8M, 85 OVR ≈ 50M, 92 OVR ≈ 120M
    const base = Math.pow((ovr - 55) / 15, 2.8) * 12;

    return Math.max(0.3, Math.round(base * ageMult * posMult * 10) / 10);
  }

  // Salaire hebdomadaire estimé (milliers €/semaine)
  function weeklyWage(player) {
    const val = marketValue(player);
    // Environ 5% de la valeur marchande par an → par semaine
    return Math.max(5, Math.round(val * 0.052 * 1000 / 52));
  }

  // ─── INIT FINANCES ───────────────────────────────────────
  // Ligues principales uniquement pour la finance detaillee
  const MAIN_LEAGUES_FIN = [
    'PRO_LIGA','LA_LIGA','ANDRO_LEAGUE','JUBA_LIGA',
    'TECHNO_LEAGUE','LIGA_NOS','LIGA_ONE',
  ];

  function initFinances(canon) {
    const clubs = {};
    // Cache joueurs par club pour perf O(1) au lieu de O(n)
    const playersByClub = {};
    for (const p of Object.values(canon.players)) {
      if (!playersByClub[p.club]) playersByClub[p.club] = [];
      playersByClub[p.club].push(p);
    }
    // Seulement les 7 ligues principales
    const mainClubs = Object.entries(canon.clubs)
      .filter(([id, club]) => MAIN_LEAGUES_FIN.includes(club.league));

    for (const [id, club] of mainClubs) {
      const tier   = club.tier || 'moyen';
      const budget = TIER_BUDGET[tier] || TIER_BUDGET.moyen;
      const squad  = playersByClub[id] || [];

      // Masse salariale totale (k€/semaine)
      const totalWages = squad.reduce((sum, p) => sum + weeklyWage(p), 0);
      // Valeur totale de l'effectif
      const squadValue = squad.reduce((sum, p) => sum + marketValue(p), 0);

      clubs[id] = {
        id,
        tier,
        balance:          budget.transfer,      // budget transfert disponible (M€)
        wages_budget:     budget.wages_annual,  // budget salaires annuel (M€)
        wages_used:       Math.round(totalWages * 52 / 1000), // M€/an
        revenue_last:     budget.revenue_base,  // revenus saison N-1
        revenue_this:     0,                    // revenus en cours
        squad_value:      Math.round(squadValue * 10) / 10,
        transfers_in:     [],
        transfers_out:    [],
        ffp_status:       'ok', // 'ok' | 'warning' | 'breach'
        history:          [],
      };
    }

    return { clubs, season: null, transferWindow: [], windowOpen: false };
  }

  // ─── REVENUS SAISONNIERS ─────────────────────────────────
  function computeSeasonRevenue(finances, season, canon, cleData) {
    const updated = JSON.parse(JSON.stringify(finances));

    for (const [lgId, league] of Object.entries(season.leagues)) {
      const table = Object.values(league.standings)
        .sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);

      table.forEach((row, idx) => {
        const cid   = row.id;
        if (!updated.clubs[cid]) return;

        // Droits TV (tous les clubs participent)
        const leagueName = league.name || lgId;
        const tierBase   = TIER_BUDGET[canon.clubs[cid]?.tier||'moyen'].revenue_base;
        const tvShare    = Math.round(tierBase * 0.4);

        // Prime de classement
        const pos   = idx + 1;
        const prize = LEAGUE_PRIZE[Math.min(pos, 10)] || 0.5;

        // Affluence (stade × matchs × prix billet)
        const cap     = canon.clubs[cid]?.capacity || 20000;
        const matches = row.played || 0;
        const ticket  = canon.clubs[cid]?.tier === 'top' ? 0.065
                      : canon.clubs[cid]?.tier === 'fort' ? 0.045 : 0.025;
        const gates   = Math.round(cap * matches * ticket * 0.82 / 1000) / 1000; // M€

        const clubRevenue = tvShare + prize + gates;
        updated.clubs[cid].revenue_this = (updated.clubs[cid].revenue_this || 0) + clubRevenue;
      });
    }

    // Bonus CLE
    if (cleData && cleData.phase === 'complete') {
      const leaguePhaseClubs = cleData.leaguePhase?.clubs || [];
      const r16Clubs         = cleData.leaguePhase?.directR16 || [];
      const playoffClubs     = cleData.leaguePhase?.playoffTeams || [];
      const qfClubs          = cleData.knockout?.r16?.winners || [];
      const sfClubs          = cleData.knockout?.qf?.winners || [];
      const finalists        = cleData.knockout?.sf?.winners || [];
      const winner           = cleData.winner;

      const addBonus = (id, key) => {
        if (updated.clubs[id]) {
          updated.clubs[id].revenue_this += CLE_BONUS[key] || 0;
        }
      };
      leaguePhaseClubs.forEach(id => addBonus(id, 'league_phase'));
      r16Clubs.forEach(id => addBonus(id, 'r16'));
      qfClubs.forEach(id => addBonus(id, 'qf'));
      sfClubs.forEach(id => addBonus(id, 'sf'));
      finalists.forEach(id => addBonus(id, 'final'));
      if (winner) addBonus(winner, 'winner');
    }

    // Clôture de saison : revenu_this → revenu_last, check FFP
    for (const [id, club] of Object.entries(updated.clubs)) {
      // FFP doit être calculé AVANT le reset des transferts
      club.ffp_status = _checkFFP(club);

      club.history.push({
        season:   season.year,
        revenue:  club.revenue_this,
        wages:    club.wages_used,
        balance:  club.balance,
        ffp:      club.ffp_status,
        transfers_in_count:  club.transfers_in.length,
        transfers_out_count: club.transfers_out.length,
      });
      club.revenue_last = club.revenue_this;
      club.revenue_this = 0;
      club.transfers_in  = [];
      club.transfers_out = [];
    }

    updated.season = season.year;
    return updated;
  }

  function _checkFFP(club) {
    const netSpend = (club.transfers_in.reduce((s,t) => s+t.fee,0))
                   - (club.transfers_out.reduce((s,t) => s+t.fee,0));
    const total    = netSpend + club.wages_used;
    if (total > club.revenue_last * 1.30) return 'breach';
    if (total > club.revenue_last * 1.10) return 'warning';
    return 'ok';
  }

  // ─── FENÊTRE DE TRANSFERTS ────────────────────────────────
  // Génère 2-3 offres IA par club vendeur
  function generateTransferWindow(finances, canon, season, userClubId) {
    const proposals = [];
    const rng       = _seededRNG((season?.year || 2025) * 31337 + 42);

    const clubs  = Object.values(canon.clubs);
    const players = Object.values(canon.players);

    for (const buyerClub of clubs) {
      const buyerFin = finances.clubs[buyerClub.id];
      if (!buyerFin) continue;

      // Budget disponible après salaires
      const wagesAnnual = buyerFin.wages_used;
      const available   = Math.min(buyerFin.balance, buyerFin.revenue_last * 0.35);
      if (available < 0.5) continue;

      // Nombre d'offres : 1 ou 2 (3 pour les top clubs)
      const numOffers = buyerClub.tier === 'top' ? 2 + Math.floor(rng() * 2)
                      : 1 + Math.floor(rng() * 2);

      let made = 0;
      let attempts = 0;
      while (made < numOffers && attempts < 30) {
        attempts++;
        const candidateIdx = Math.floor(rng() * players.length);
        const player       = players[candidateIdx];
        if (!player || player.club === buyerClub.id) continue;

        const sellerFin = finances.clubs[player.club];
        if (!sellerFin) continue;

        const val    = marketValue(player);
        const fee    = Math.round(val * (0.90 + rng() * 0.30) * 10) / 10;
        const wages  = weeklyWage(player);

        // L'acheteur peut-il se l'offrir ?
        if (fee > available) continue;

        // FFP check : après achat, dépenses > revenus N-1 * 130% ?
        const projectedSpend = buyerFin.wages_used + (fee / 5) + (wages * 52 / 1000);
        if (projectedSpend > buyerFin.revenue_last * 1.30) continue;

        // Le vendeur veut-il vendre ? (stars moins susceptibles d'être vendues)
        const sellProbability = player.ovr >= 88 ? 0.25
                              : player.ovr >= 82 ? 0.50
                              : 0.75;
        if (rng() > sellProbability) continue;

        proposals.push({
          id:        `transfer_${buyerClub.id}_${player.club}_${player.id||player.name}_${Date.now()}`,
          buyerId:   buyerClub.id,
          sellerId:  player.club,
          playerId:  player.id || player.name,
          playerName: player.name,
          playerPos:  player.position,
          playerOvr:  player.ovr,
          playerAge:  player.age,
          fee,
          wages,
          marketVal: val,
          status:    player.club === userClubId ? 'incoming'   // offre pour ton club
                   : buyerClub.id === userClubId ? 'outgoing'  // ton club achète
                   : 'ai',                                      // IA vs IA
          isUserInvolved: player.club === userClubId || buyerClub.id === userClubId,
        });
        made++;
      }
    }

    return proposals.sort((a,b) => b.fee - a.fee);
  }

  // ─── EXÉCUTER UN TRANSFERT ───────────────────────────────
  function executeTransfer(finances, transfer, canon) {
    const updated = JSON.parse(JSON.stringify(finances));
    const buyer   = updated.clubs[transfer.buyerId];
    const seller  = updated.clubs[transfer.sellerId];
    if (!buyer || !seller) return { finances: updated, error: 'Club introuvable' };
    if (buyer.balance < transfer.fee) return { finances: updated, error: 'Budget insuffisant' };

    buyer.balance  -= transfer.fee;
    seller.balance += transfer.fee * 0.90; // 10% commission agent

    // Mise à jour masse salariale
    const annualWages = Math.round(transfer.wages * 52 / 1000);
    buyer.wages_used  += annualWages;
    seller.wages_used = Math.max(0, seller.wages_used - annualWages);

    buyer.transfers_in.push({
      player: transfer.playerName,
      fee:    transfer.fee,
      season: finances.season,
    });
    seller.transfers_out.push({
      player: transfer.playerName,
      fee:    transfer.fee,
      season: finances.season,
    });

    buyer.ffp_status  = _checkFFP(buyer);
    seller.ffp_status = _checkFFP(seller);

    // Mettre à jour le club du joueur dans le canon (en mémoire)
    const player = canon.players[transfer.playerId] ||
      Object.values(canon.players).find(p => p.name === transfer.playerName);
    if (player) player.club = transfer.buyerId;

    return { finances: updated, error: null };
  }

  // ─── SIMULER TRANSFERTS IA (tous les offres AI vs AI) ────
  function processAITransfers(finances, proposals, canon) {
    let updated = JSON.parse(JSON.stringify(finances));
    const aiDeals = proposals.filter(p => p.status === 'ai');

    for (const deal of aiDeals) {
      const result = executeTransfer(updated, deal, canon);
      if (!result.error) {
        updated = result.finances;
        deal.status = 'done';
      }
    }
    return updated;
  }

  // ─── RAPPORT FINANCIER D'UN CLUB ──────────────────────────
  function getClubReport(clubId, finances, canon) {
    const club  = canon.clubs[clubId];
    const fin   = finances.clubs[clubId];
    if (!club || !fin) return null;

    const players = Object.values(canon.players)
      .filter(p => p.club === clubId)
      .map(p => ({ ...p, value: marketValue(p), wage: weeklyWage(p) }))
      .sort((a,b) => b.value - a.value);

    const totalValue = players.reduce((s,p) => s+p.value, 0);
    const totalWage  = players.reduce((s,p) => s+p.wage, 0);

    return {
      club, fin,
      players,
      totalValue:  Math.round(totalValue * 10) / 10,
      totalWage,
      ffpHeadroom: Math.max(0, Math.round((fin.revenue_last * 1.30 - fin.wages_used) * 10) / 10),
    };
  }

  // ─── HELPERS ─────────────────────────────────────────────
  function _seededRNG(seed) {
    let s = seed >>> 0;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ─── STORAGE ─────────────────────────────────────────────
  function saveFinances(finances) {
    EQ_DB.set('eq_finance', finances).catch(e => console.error('[Finance] IDB save:', e));
  }
  async function loadFinances() {
    return EQ_DB.get('eq_finance').catch(() => null);
  }
  async function clearFinances() {
    await EQ_DB.del('eq_finance').catch(()=>{});
  }

  // ─── PUBLIC ──────────────────────────────────────────────
  return {
    initFinances,
    marketValue,
    weeklyWage,
    computeSeasonRevenue,
    generateTransferWindow,
    executeTransfer,
    processAITransfers,
    getClubReport,
    saveFinances,
    loadFinances,
    clearFinances,
    TIER_BUDGET,
  };

})();

if (typeof module !== 'undefined') module.exports = FinanceEngine;
