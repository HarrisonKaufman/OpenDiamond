const teamSelect = document.getElementById('teamSelect');
const yearSelect = document.getElementById('yearSelect');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('errorMessage');
const teamOverview = document.getElementById('teamOverview');
const teamStatsGrid = document.getElementById('teamStatsGrid');
const pitchingStatsGrid = document.getElementById('pitchingStatsGrid');
const positionPlayersBody = document.getElementById('positionPlayersBody');
const pitchersBody = document.getElementById('pitchersBody');

let currentTeamId = null;

const franchiseHistoryCache = {};

let historyChartObserver = null;
let lastLoadedTeamId = null;

function initTeamsPage() {
  if (!teamSelect || !yearSelect) {
    setTimeout(initTeamsPage, 100);
    return;
  }
  
  fetchAndPopulateTeams();
  
  teamSelect.addEventListener('change', function() {
    if (this.value) {
      currentTeamId = parseInt(this.value);
      const selectedOption = teamSelect.options[teamSelect.selectedIndex];
      const teamName = selectedOption.textContent;
      const teamTitle = document.getElementById('teamTitle');
      if (teamTitle) {
        teamTitle.textContent = teamName.toUpperCase();
      }
      
      lastLoadedTeamId = null;
      fetchAvailableYears(currentTeamId);
      
      const historySection = document.getElementById('franchiseHistorySection');
      if (historySection && historyChartObserver) {
        historyChartObserver.observe(historySection);
      }
    } else {
      hideTeamOverview();
      yearSelect.disabled = true;
      yearSelect.innerHTML = '<option value="">Choose a team first</option>';
    }
  });

  yearSelect.addEventListener('change', function() {
    if (this.value && currentTeamId) {
      fetchTeamData(currentTeamId, parseInt(this.value));
    }
  });
  
  setupHistoryChartLazyLoad();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTeamsPage);
} else {
  initTeamsPage();
}

function fetchAndPopulateTeams() {
  showLoading();
  hideError();

  fetch('/api/teams')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.error) {
        showError('Failed to load teams: ' + data.error);
      } else if (data.teams && data.teams.length > 0) {
        populateTeamDropdown(data.teams);
        hideLoading();
        
        const urlParams = new URLSearchParams(window.location.search);
        const teamParam = urlParams.get('team');
        if (teamParam) {
          teamSelect.value = teamParam;
          const event = new Event('change');
          teamSelect.dispatchEvent(event);
        }
      } else {
        showError('No teams found');
      }
    })
    .catch(error => {
      showError('Failed to load teams. Please try again later.');
    });
}

function populateTeamDropdown(teams) {
  teamSelect.innerHTML = '<option value="">Select a team...</option>';
  
  teams.forEach(team => {
    const option = document.createElement('option');
    option.value = team.id;
    option.textContent = team.name;
    teamSelect.appendChild(option);
  });
}

function fetchAvailableYears(teamId) {
  fetch(`/api/teams/${teamId}/years`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.error) {
        showError('Failed to load years: ' + data.error);
        yearSelect.disabled = true;
      } else if (data.years && data.years.length > 0) {
        populateYearDropdown(data.years);
        yearSelect.disabled = false;
        setTimeout(() => {
          const latestYear = Math.max(...data.years);
          yearSelect.value = latestYear;
          fetchTeamData(teamId, latestYear);
        }, 0);
      } else {
        showError('No years found for this team');
        yearSelect.disabled = true;
      }
    })
    .catch(error => {
      showError(`Failed to load years: ${error.message}`);
      yearSelect.disabled = true;
    });
}

function populateYearDropdown(years) {
  yearSelect.innerHTML = '';
  
  years.sort((a, b) => b - a);
  
  years.forEach(year => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
  });
}

function fetchTeamData(teamId, year) {
  showLoading();
  hideError();

  const url = year ? `/api/teams/${teamId}?year=${year}` : `/api/teams/${teamId}`;

  const teamDataPromise = fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    });

  teamDataPromise
    .then(teamData => {
      if (teamData.error) {
        showError('Failed to load team data: ' + teamData.error);
      } else {
        displayTeamStats(teamData);
        displayPitchingStats(teamData.pitchingStats || {}, teamData.season);
        
        renderRoster(teamData.roster || []);
        
        teamOverview.style.display = 'block';
        hideLoading();
        
        const historySection = document.getElementById('franchiseHistorySection');
        if (historySection) {
          historySection.style.display = 'block';
        }
      }
    })
    .catch(error => {
      showError('Failed to load team data. Please try again later.');
    });
}

function setupHistoryChartLazyLoad() {
  const historySection = document.getElementById('franchiseHistorySection');
  if (!historySection) return;
  
  historyChartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && currentTeamId && lastLoadedTeamId !== currentTeamId) {
        lastLoadedTeamId = currentTeamId;
        loadFranchiseHistoryChart(currentTeamId);
      }
    });
  }, { threshold: 0.1 });
  
  historyChartObserver.observe(historySection);
}

function loadFranchiseHistoryChart(teamId) {
  const chartElement = document.getElementById('franchiseHistoryChart');
  const loadingEl = document.getElementById('historyChartLoading');
  
  if (!chartElement || !loadingEl) return;
  
  if (franchiseHistoryCache[teamId]) {
    renderFranchiseHistoryChart(franchiseHistoryCache[teamId]);
    return;
  }
  
  loadingEl.style.display = 'block';
  
  fetch(`/api/teams/${teamId}/history`)
    .then(response => {
      if (!response.ok) {
        loadingEl.style.display = 'none';
        return null;
      }
      return response.json();
    })
    .then(data => {
      loadingEl.style.display = 'none';
      if (data && !data.error && data.history) {
        franchiseHistoryCache[teamId] = data.history;
        renderFranchiseHistoryChart(data.history);
      }
    })
    .catch(error => {
      loadingEl.style.display = 'none';
    });
}



function displayTeamStats(data) {
  renderTeamStats(data);
}

function ensurePitchingCardExists() {
  let gridElement = document.getElementById('pitchingStatsGrid');
  if (gridElement && gridElement.parentElement && gridElement.parentElement.parentElement) {
    return;
  }
  
  const card = document.createElement('div');
  card.className = 'card mb-5';
  
  const cardHeader = document.createElement('div');
  cardHeader.className = 'card-header bg-primary text-white';
  const title = document.createElement('h5');
  title.className = 'mb-0';
  title.textContent = 'Pitching Statistics';
  cardHeader.appendChild(title);
  
  const cardBody = document.createElement('div');
  cardBody.className = 'card-body';
  gridElement = document.createElement('div');
  gridElement.className = 'row';
  gridElement.id = 'pitchingStatsGrid';
  cardBody.appendChild(gridElement);
  
  card.appendChild(cardHeader);
  card.appendChild(cardBody);
  
  const teamOverview = document.getElementById('teamOverview');
  const teamStatsSection = document.querySelector('.team-stats-section');
  if (teamOverview && teamStatsSection) {
    teamStatsSection.parentNode.insertBefore(card, teamStatsSection.nextSibling);
  }
}

function displayPitchingStats(stats, season) {
  const currentYear = new Date().getFullYear();
  const gridElement = document.getElementById('pitchingStatsGrid');
  const pitchingCard = gridElement ? gridElement.closest('.card') : null;
  
  if (season !== currentYear) {
    if (pitchingCard) {
      pitchingCard.remove();
    }
  } else {
    ensurePitchingCardExists();
    renderPitchingStats(stats);
  }
}

function renderFranchiseHistoryChart(history) {
  if (!history || history.length === 0) return;
  
  const chartElement = document.getElementById('franchiseHistoryChart');
  if (!chartElement) return;

  const currentYear = new Date().getFullYear();
  const sortedHistory = history
    .filter(h => h.year < currentYear)
    .sort((a, b) => a.year - b.year);
  
  if (sortedHistory.length === 0) return;
  
  const years = sortedHistory.map(h => h.year);
  const wins = sortedHistory.map(h => h.wins);
  
  const option = {
    color: ['#007bff'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#555',
      textStyle: { color: '#fff' },
      formatter: function(params) {
        if (params.length > 0) {
          const param = params[0];
          return `${param.name}<br/>${param.seriesName}: ${param.value}`;
        }
        return '';
      }
    },
    grid: {
      left: '50px',
      right: '30px',
      bottom: '50px',
      top: '20px',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: years,
      axisTick: { alignWithLabel: true },
      axisLabel: { color: '#666' },
      interval: Math.ceil(years.length / 20)
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#666' },
      splitLine: { lineStyle: { color: '#e9ecef' } }
    },
    series: [
      {
        name: 'Wins',
        data: wins,
        type: 'line',
        smooth: true,
        itemStyle: { color: '#007bff' },
        areaStyle: { color: 'rgba(0, 123, 255, 0.1)' }
      }
    ]
  };

  const chart = echarts.init(chartElement);
  chart.setOption(option);

  window.addEventListener('resize', function() {
    chart.resize();
  });
}

function renderTeamStats(data) {
  teamStatsGrid.innerHTML = '';
  
  let winPctValue = 'N/A';
  if (data.standings) {
    const wins = data.standings.wins || 0;
    const losses = data.standings.losses || 0;
    if (wins > 0 && losses === 0) {
      winPctValue = '1.000';
    } else if (data.standings.winPct) {
      winPctValue = (parseFloat(data.standings.winPct) * 1000).toFixed(0) === 1 ? (parseFloat(data.standings.winPct) * 1000).toFixed(0) : '.' + (parseFloat(data.standings.winPct) * 1000).toFixed(0) ;
    } else if (wins + losses > 0) {
      winPctValue = (wins / (wins + losses) * 1000).toFixed(0);
    } else {
      winPctValue = '0';
    }
  }
  
  const stats = [
    { label: 'Team', value: data.name || 'N/A' },
    { label: 'Season', value: data.season || new Date().getFullYear() },
    { label: 'Wins', value: data.standings?.wins ?? 0 },
    { label: 'Losses', value: data.standings?.losses ?? 0 },
    { label: 'Win %', value: winPctValue },
  ];

  stats.forEach(stat => {
    const col = document.createElement('div');
    col.className = 'col-md-3 col-sm-6 mb-3';
    col.appendChild(createStatCard(stat.label, stat.value));
    teamStatsGrid.appendChild(col);
  });

  if (data.hittingStats && Object.keys(data.hittingStats).length > 0) {
    const col = document.createElement('div');
    col.className = 'col-md-3 col-sm-6 mb-3';
    col.appendChild(createStatCard('Team Avg', formatNumber(data.hittingStats.avg)));
    teamStatsGrid.appendChild(col);
  }
}

function renderPitchingStats(stats) {
  const gridElement = document.getElementById('pitchingStatsGrid');
  if (!gridElement) return;
  
  gridElement.innerHTML = '';
  
  const pitchingMetrics = [
    { label: 'Team ERA', value: formatNumber(stats.era) },
    { label: 'Team WHIP', value: formatNumber(stats.whip) },
  ];

  pitchingMetrics.forEach(metric => {
    const col = document.createElement('div');
    col.className = 'col-lg-3 col-md-4 col-sm-6 mb-3';
    col.appendChild(createStatCard(metric.label, metric.value));
    gridElement.appendChild(col);
  });
}

function createStatCard(label, value) {
  const card = document.createElement('div');
  card.className = 'card text-center';
  card.style.borderRadius = '8px';
  card.innerHTML = `
    <div class="card-body">
      <h6 class="card-subtitle mb-2 text-muted">${label}</h6>
      <h5 class="card-title text-primary">${value}</h5>
    </div>
  `;
  return card;
}

function renderRoster(roster) {
  positionPlayersBody.innerHTML = '';
  pitchersBody.innerHTML = '';

  const positionPlayers = roster.filter(p => p.position !== 'P');
  const pitchers = roster.filter(p => p.position === 'P');

  const sortByJerseyNumber = (a, b) => {
    const numA = parseInt(a.jerseyNumber) || 0;
    const numB = parseInt(b.jerseyNumber) || 0;
    return numA - numB;
  };
  
  positionPlayers.sort(sortByJerseyNumber);
  pitchers.sort(sortByJerseyNumber);

  if (positionPlayers.length > 0) {
    positionPlayers.forEach(player => {
      const row = createPlayerRow(player);
      positionPlayersBody.appendChild(row);
    });
  } else {
    positionPlayersBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No position players</td></tr>';
  }

  if (pitchers.length > 0) {
    pitchers.forEach(player => {
      const row = createPlayerRow(player);
      pitchersBody.appendChild(row);
    });
  } else {
    pitchersBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No pitchers</td></tr>';
  }
}

function createPlayerRow(player) {
  const row = document.createElement('tr');
  
  const fullName = player.fullName || 'Unknown';
  const jerseyNumber = player.jerseyNumber || '-';
  const positionAbbr = player.position || 'Unknown';
  
  const jerseyCell = document.createElement('td');
  jerseyCell.textContent = jerseyNumber;
  
  const nameCell = document.createElement('td');
  const playerLink = document.createElement('a');
  playerLink.href = `/players?search=${encodeURIComponent(fullName)}`;
  playerLink.textContent = fullName;
  playerLink.style.cursor = 'pointer';
  playerLink.style.color = '#0066cc';
  playerLink.style.textDecoration = 'none';
  playerLink.addEventListener('mouseover', (e) => {
    e.target.style.textDecoration = 'underline';
  });
  playerLink.addEventListener('mouseout', (e) => {
    e.target.style.textDecoration = 'none';
  });
  nameCell.appendChild(playerLink);
  
  const positionCell = document.createElement('td');
  positionCell.textContent = positionAbbr;
  
  row.appendChild(jerseyCell);
  row.appendChild(nameCell);
  row.appendChild(positionCell);
  
  return row;
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') return '0';
  if (value === 0) return '0';
  if (Number.isInteger(value)) return value.toString();
  return parseFloat(value).toFixed(3);
}

function showLoading() {
  loading.style.display = 'block';
  teamOverview.style.display = 'none';
}

function hideLoading() {
  loading.style.display = 'none';
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  teamOverview.style.display = 'none';
  loading.style.display = 'none';
}

function hideError() {
  errorMessage.style.display = 'none';
}

function hideTeamOverview() {
  teamOverview.style.display = 'none';
}
