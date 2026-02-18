const chartsMapNonPitcher = {
  hitsChart: null,
  'batting-avgChart': null,
  rbisChart: null,
  xbhChart: null,
};

const chartsMapPitcher = {
  eraChart: null,
  whipChart: null,
};

const BATTER_CHART_IDS = ['hitsChart', 'batting-avgChart', 'rbisChart', 'xbhChart'];
const PITCHER_CHART_IDS = ['eraChart', 'whipChart'];

function initCharts() {
  Object.keys(chartsMapNonPitcher).forEach(chartId => {
    const el = document.getElementById(chartId);
    if (el) {
      if (chartsMapNonPitcher[chartId]) chartsMapNonPitcher[chartId].dispose();
      chartsMapNonPitcher[chartId] = echarts.init(el);
    }
  });
}

function initPitcherCharts() {
  Object.keys(chartsMapPitcher).forEach(chartId => {
    const el = document.getElementById(chartId);
    if (el) {
      if (chartsMapPitcher[chartId]) chartsMapPitcher[chartId].dispose();
      chartsMapPitcher[chartId] = echarts.init(el);
    }
  });
}

function clearCharts() {
  [...Object.values(chartsMapNonPitcher), ...Object.values(chartsMapPitcher)].forEach(chart => {
    if (chart) chart.clear();
  });
}

function setChartVisibility(chartIds, visible) {
  chartIds.forEach(id => {
    const el = document.getElementById(id)?.parentElement;
    if (el) el.style.display = visible ? 'block' : 'none';
  });
}

function baseChartConfig(seasons) {
  return {
    color: ['#007bff'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#555',
      textStyle: { color: '#fff' }
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
      data: seasons.map(s => s.year),
      axisTick: { alignWithLabel: true },
      axisLabel: { color: '#666' }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#666' },
      splitLine: { lineStyle: { color: '#e9ecef' } }
    }
  };
}

function lineSeries(data, name) {
  return {
    name: name || '',
    data: data,
    type: 'line',
    smooth: true,
    itemStyle: { color: '#007bff' },
    areaStyle: { color: 'rgba(0, 123, 255, 0.1)' }
  };
}

function fixedDecimalTooltip(decimals) {
  return (params) => {
    if (params.length === 0) return '';
    const p = params[0];
    return `${p.name}<br/>${p.seriesName}: ${p.value.toFixed(decimals)}`;
  };
}

function renderPlayerCharts(position, seasons) {
  clearCharts();

  if (position === 'P') {
    setChartVisibility(BATTER_CHART_IDS, false);
    setChartVisibility(PITCHER_CHART_IDS, true);
    document.getElementById('dashboard').offsetHeight; // force reflow
    initPitcherCharts();
    createERAChart(seasons);
    createWHIPChart(seasons);
  } else {
    setChartVisibility(BATTER_CHART_IDS, true);
    setChartVisibility(PITCHER_CHART_IDS, false);
    document.getElementById('dashboard').offsetHeight; // force reflow
    initCharts();
    createHitsChart(seasons);
    createBattingAvgChart(seasons);
    createRBIsChart(seasons);
    createXBHChart(seasons);
  }
}

function createXBHChart(seasons) {
  const option = baseChartConfig(seasons);
  option.tooltip.trigger = 'axis';
  option.legend = {
    data: ['Doubles', 'Triples', 'Home Runs'],
    textStyle: { color: '#666' },
    bottom: 0
  };
  option.grid.bottom = '80px';
  option.series = [
    {
      name: 'Doubles',
      data: seasons.map(s => s.doubles),
      type: 'bar',
      stack: 'xbh',
      itemStyle: { color: '#0056b3' }
    },
    {
      name: 'Triples',
      data: seasons.map(s => s.triples),
      type: 'bar',
      stack: 'xbh',
      itemStyle: { color: '#007bff' }
    },
    {
      name: 'Home Runs',
      data: seasons.map(s => s.homeRuns),
      type: 'bar',
      stack: 'xbh',
      itemStyle: { color: '#66b2ff' }
    }
  ];
  if (chartsMapNonPitcher.xbhChart) chartsMapNonPitcher.xbhChart.setOption(option);
}

function createHitsChart(seasons) {
  const option = baseChartConfig(seasons);
  option.series = [lineSeries(seasons.map(s => s.hits))];
  if (chartsMapNonPitcher.hitsChart) chartsMapNonPitcher.hitsChart.setOption(option);
}

function createBattingAvgChart(seasons) {
  const option = baseChartConfig(seasons);
  option.tooltip.formatter = fixedDecimalTooltip(3);
  option.yAxis.axisLabel.formatter = (value) => value.toFixed(3);
  option.series = [lineSeries(seasons.map(s => s.avg), 'Batting Avg')];
  if (chartsMapNonPitcher['batting-avgChart']) chartsMapNonPitcher['batting-avgChart'].setOption(option);
}

function createRBIsChart(seasons) {
  const option = baseChartConfig(seasons);
  option.series = [lineSeries(seasons.map(s => s.rbis), 'RBIs')];
  if (chartsMapNonPitcher.rbisChart) chartsMapNonPitcher.rbisChart.setOption(option);
}


function createERAChart(seasons) {
  const option = baseChartConfig(seasons);
  option.tooltip.formatter = fixedDecimalTooltip(2);
  option.yAxis.interval = 0.5;
  option.yAxis.axisLabel.formatter = (value) => value.toFixed(2);
  option.series = [lineSeries(seasons.map(s => s.era), 'Earned Run Average')];
  if (chartsMapPitcher.eraChart) chartsMapPitcher.eraChart.setOption(option);
}

function createWHIPChart(seasons) {
  const option = baseChartConfig(seasons);
  option.tooltip.formatter = fixedDecimalTooltip(2);
  option.yAxis.interval = 0.5;
  option.yAxis.axisLabel.formatter = (value) => value.toFixed(2);
  option.series = [lineSeries(seasons.map(s => s.whip), 'WHIP')];
  if (chartsMapPitcher.whipChart) chartsMapPitcher.whipChart.setOption(option);
}

