function statBox(label, value) {
  const box = document.createElement('div');
  box.className = 'stat-box';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'stat-label';
  labelDiv.textContent = label;
  const valueDiv = document.createElement('div');
  valueDiv.className = 'stat-value';
  valueDiv.textContent = value;
  box.appendChild(labelDiv);
  box.appendChild(valueDiv);
  return box;
}

function createHeaderRow(headers) {
  const tr = document.createElement('tr');
  headers.forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    tr.appendChild(th);
  });
  return tr;
}

function updateTableHeaders(position) {
  const thead = document.getElementById('statsTableHead');
  thead.innerHTML = '';
  if (position === 'P') {
    thead.appendChild(createHeaderRow(['Season', 'Wins', 'Losses', 'ERA', 'WHIP', 'Strikeouts', 'Walks', 'Innings Pitched', 'Games Started', 'Games']));
  } else {
    thead.appendChild(createHeaderRow(['Season', 'Hits', 'Doubles', 'Triples', 'Home Runs', 'RBIs', 'Avg', 'OBP', 'SLG']));
  }
}

function appendCells(row, values) {
  values.forEach(val => {
    const td = document.createElement('td');
    td.textContent = val;
    row.appendChild(td);
  });
}

function populateStatsTable(seasons, position) {
  updateTableHeaders(position);
  const tbody = document.getElementById('statsTableBody');
  tbody.innerHTML = '';

  seasons.forEach(season => {
    const row = document.createElement('tr');
    if (position === 'P') {
      appendCells(row, [
        season.year,
        season.wins || 0,
        season.losses || 0,
        formatNumber(season.era),
        season.whip ? season.whip.toFixed(3) : '0.000',
        season.strikeOuts || 0,
        season.walks,
        season.inningsPitched ? season.inningsPitched.toFixed(1) : '0.0',
        season.gamesStarted || 0,
        season.games || 0
      ]);
    } else {
      appendCells(row, [
        season.year,
        season.hits,
        season.doubles,
        season.triples,
        season.homeRuns,
        season.rbis,
        formatNumber(season.avg),
        formatNumber(season.obp),
        formatNumber(season.slg)
      ]);
    }
    tbody.appendChild(row);
  });
}

function displayPlayerInfo(playerName, seasons, position) {
  const playerInfoDiv = document.getElementById('playerInfo');
  document.getElementById('playerName').textContent = playerName || 'Unknown Player';

  const statsGrid = document.getElementById('playerCareerStats');
  statsGrid.innerHTML = '';
  let gamesPlayed = 0;
  const statsBoxes = [statBox('Position', position)];

  if (position === 'P') {
    let totalWins = 0, totalLosses = 0, totalStrikeOuts = 0;
    let totalWalks = 0, totalHitsAllowed = 0;
    let totalInningsPitched = 0, weightedEraSum = 0;

    seasons.forEach(s => {
      totalWins += s.wins || 0;
      totalLosses += s.losses || 0;
      totalStrikeOuts += s.strikeOuts || 0;
      totalWalks += s.walks || 0;
      totalHitsAllowed += s.hitsAllowed || 0;
      gamesPlayed += s.games || 0;

      // Convert baseball IP notation (.1 = 1/3, .2 = 2/3) to real fractions
      const ip = s.inningsPitched || 0;
      const wholeInnings = Math.floor(ip);
      const partial = Math.round((ip - wholeInnings) * 10);
      const realIP = wholeInnings + (partial / 3);
      totalInningsPitched += realIP;
      if (s.era && realIP > 0) weightedEraSum += s.era * realIP;
    });

    const careerERA = totalInningsPitched > 0 ? (weightedEraSum / totalInningsPitched).toFixed(3) : '0.000';
    const careerWHIP = totalInningsPitched > 0 ? ((totalWalks + totalHitsAllowed) / totalInningsPitched).toFixed(3) : '0.000';

    statsBoxes.push(
      statBox('Games', gamesPlayed),
      statBox('Wins', totalWins),
      statBox('Losses', totalLosses),
      statBox('Strikeouts', totalStrikeOuts),
      statBox('Walks', totalWalks),
      statBox('IP', totalInningsPitched.toFixed(1)),
      statBox('Career ERA', careerERA),
      statBox('Career WHIP', careerWHIP)
    );
  } else {
    let totalHits = 0, totalHomeRuns = 0, totalRBIs = 0, careerAtBats = 0;

    seasons.forEach(s => {
      totalHits += s.hits || 0;
      totalHomeRuns += s.homeRuns || 0;
      totalRBIs += s.rbis || 0;
      gamesPlayed += s.games || 0;
      careerAtBats += s.atBats || 0;
    });

    const careerAvg = careerAtBats > 0 ? (totalHits / careerAtBats).toFixed(3) : '.000';

    statsBoxes.push(
      statBox('Games', gamesPlayed),
      statBox('Hits', totalHits),
      statBox('Home Runs', totalHomeRuns),
      statBox('RBIs', totalRBIs),
      statBox('Career Avg', careerAvg)
    );
  }

  statsBoxes.forEach(box => statsGrid.appendChild(box));
  playerInfoDiv.style.display = 'block';
}

function send() {
  const playerName = document.getElementById('userInput').value.trim();

  if (!playerName) {
    showError('Please enter a player name.');
    return;
  }

  hideError();
  document.getElementById('loading').style.display = 'block';
  document.getElementById('playerInfo').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('statsTableContainer').style.display = 'none';

  fetch('/api/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'player_season_stats',
      playerName: playerName
    })
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById('loading').style.display = 'none';

      if (data.error) {
        showError(`Error: ${data.error}`);
      } else if (!data.seasons || data.seasons.length === 0) {
        showError('No season data found for this player.');
      } else {
        displayPlayerInfo(data.playerName, data.seasons, data.position);

        document.getElementById('dashboard').style.display = '';
        document.getElementById('statsTableContainer').style.display = '';

        renderPlayerCharts(data.position, data.seasons);
        populateStatsTable(data.seasons, data.position);
      }
    })
    .catch(err => {
      document.getElementById('loading').style.display = 'none';
      showError(`Error: ${err.message}`);
      console.error(err);
    });
}

function initializeResizeListener() {
  window.addEventListener('resize', function() {
    const allCharts = [...Object.values(chartsMapNonPitcher || {}), ...Object.values(chartsMapPitcher || {})];
    allCharts.forEach(chart => {
      if (chart) chart.resize();
    });
  });
}