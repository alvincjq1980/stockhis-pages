/**
 * Charting Utilities using Chart.js
 */

let holdingsChartInstance = null;
let profitChartInstance = null;

/**
 * Destroy existing chart instance to prevent canvas reuse errors
 * @param {Object} chartInstance Chart.js instance
 */
function safeDestroy(chartInstance) {
  if (chartInstance) {
    chartInstance.destroy();
  }
}

/**
 * Render Doughnut Chart for Holdings Distribution
 * @param {string} canvasId Canvas element ID
 * @param {Array} activeHoldings Array of active holding objects
 */
function renderHoldingsChart(canvasId, activeHoldings) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Clear previous chart
  if (holdingsChartInstance) {
    safeDestroy(holdingsChartInstance);
  }

  if (activeHoldings.length === 0) {
    // If no holdings, draw empty state or hide
    ctx.style.display = 'none';
    const placeholder = document.getElementById(canvasId + '-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    return;
  } else {
    ctx.style.display = 'block';
    const placeholder = document.getElementById(canvasId + '-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  }

  // Sort holdings by market value descending
  const sorted = [...activeHoldings].sort((a, b) => b.marketValue - a.marketValue);
  
  const labels = sorted.map(h => `${h.name} (${h.code})`);
  const data = sorted.map(h => parseFloat(h.marketValue.toFixed(2)));

  // Generate pleasant color palette
  const colors = [
    '#2979ff', // Blue
    '#00e676', // Green
    '#ff9100', // Orange
    '#d500f9', // Purple
    '#00e5ff', // Cyan
    '#ff1744', // Red
    '#ffea00', // Yellow
    '#aa00ff', // Deep Purple
    '#1de9b6', // Teal
    '#f50057'  // Pink
  ];

  holdingsChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, sorted.length),
        borderWidth: 2,
        borderColor: '#1a2236',
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#90a4ae',
            font: {
              family: "'Outfit', 'Segoe UI', sans-serif",
              size: 11
            },
            boxWidth: 12,
            padding: 15
          }
        },
        tooltip: {
          backgroundColor: 'rgba(10, 15, 29, 0.95)',
          titleColor: '#fff',
          bodyColor: '#cfd8dc',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          callbacks: {
            label: function(context) {
              const value = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(2);
              return ` 市值: ¥${value.toLocaleString(undefined, {minimumFractionDigits: 2})} (${percentage}%)`;
            }
          }
        }
      },
      cutout: '70%'
    }
  });
}

/**
 * Render Line Chart for Profit Curve Over Time
 * @param {string} canvasId Canvas element ID
 * @param {Array} profitTimeline Timeline of transactions with profit change
 * @param {number} currentFloatingProfit Latest floating profit from current holdings
 */
function renderProfitChart(canvasId, profitTimeline, currentFloatingProfit) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (profitChartInstance) {
    safeDestroy(profitChartInstance);
  }

  // Build cumulative profit data points over time
  const points = [];
  
  // Starting point (0 profit)
  points.push({
    x: '起点',
    y: 0
  });

  let runningRealized = 0;
  
  // Group timeline by date (just the date portion) to avoid too many points
  const dailyProfit = {};
  
  profitTimeline.forEach(event => {
    const dateStr = new Date(event.date).toLocaleDateString();
    runningRealized += event.realizedProfitChange;
    dailyProfit[dateStr] = runningRealized;
  });

  Object.keys(dailyProfit).forEach(date => {
    points.push({
      x: date,
      y: parseFloat(dailyProfit[date].toFixed(2))
    });
  });

  // Final point: today, which adds current floating profit
  const todayStr = new Date().toLocaleDateString();
  const totalAccumulated = runningRealized + currentFloatingProfit;

  // If last point date is today, adjust it, else push new
  if (points.length > 1 && points[points.length - 1].x === todayStr) {
    points[points.length - 1].y = parseFloat(totalAccumulated.toFixed(2));
  } else {
    points.push({
      x: todayStr + ' (含持仓浮盈)',
      y: parseFloat(totalAccumulated.toFixed(2))
    });
  }

  // Draw chart
  const labels = points.map(p => p.x);
  const data = points.map(p => p.y);

  // Gradient fill under the line
  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, ctx.clientHeight);
  gradient.addColorStop(0, 'rgba(41, 121, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(41, 121, 255, 0.0)');

  profitChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '累计收益 (元)',
        data: data,
        fill: true,
        backgroundColor: gradient,
        borderColor: '#2979ff',
        borderWidth: 3,
        pointBackgroundColor: '#2979ff',
        pointBorderColor: 'rgba(255,255,255,0.8)',
        pointBorderWidth: 1.5,
        pointRadius: data.length > 20 ? 0 : 4,
        pointHoverRadius: 6,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(10, 15, 29, 0.95)',
          titleColor: '#fff',
          bodyColor: '#cfd8dc',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const sign = val >= 0 ? '+' : '';
              return ` 累计收益: ${sign}¥${val.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            borderColor: 'transparent'
          },
          ticks: {
            color: '#90a4ae',
            font: {
              size: 10
            },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 10
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            borderColor: 'transparent'
          },
          ticks: {
            color: '#90a4ae',
            font: {
              size: 10
            },
            callback: function(value) {
              return '¥' + value.toLocaleString();
            }
          }
        }
      }
    }
  });
}
