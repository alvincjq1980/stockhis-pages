/**
 * StockHis Frontend SPA Controller (Cloudflare Pages / KV Version)
 */

// Global State
let allTrades = [];
let portfolioData = null;
let realTimePrices = {};
let manualPriceOverrides = {}; // code -> price
let activeTab = 'dashboard';
let editingTradeId = null;
let pricePollInterval = null;
let currentUsername = '';
let editingTrade = null; // 当前正在编辑的交易记录对象

// 动态注入可折叠批次明细表格的 CSS 样式
const style = document.createElement('style');
style.textContent = `
  .holding-row {
    cursor: pointer;
    transition: background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .holding-row:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .holding-row.expanded {
    background: rgba(47, 129, 247, 0.06) !important;
    border-bottom: none !important;
  }
  .holding-row.closed-position {
    opacity: 0.65;
    background: rgba(0, 0, 0, 0.2) !important;
  }
  .holding-row.closed-position:hover {
    opacity: 0.9;
    background: rgba(255, 255, 255, 0.04) !important;
  }
  .closed-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
    border-radius: 4px;
    font-size: 11px;
    margin-left: 6px;
    font-weight: 500;
    vertical-align: middle;
  }
  .holding-details-row {
    background: rgba(8, 11, 17, 0.6) !important;
  }
  .holding-details-row td {
    padding: 0 !important;
  }
  .lot-details-container {
    padding: 16px 24px;
    border-top: 1px solid var(--glass-border);
    border-bottom: 1px solid var(--glass-border);
    border-left: 3px solid var(--color-accent);
    background: rgba(18, 25, 42, 0.4);
    margin: 4px 0 8px 0;
    border-radius: 0 8px 8px 0;
  }
  .lot-details-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lot-details-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px !important;
    font-variant-numeric: tabular-nums lining-nums;
  }
  .lot-details-table th {
    background: rgba(0, 0, 0, 0.3) !important;
    color: var(--text-muted) !important;
    font-weight: 600 !important;
    padding: 10px 12px !important;
    border: none !important;
    text-align: left;
    font-size: 11px !important;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .lot-details-table td {
    padding: 10px 12px !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03) !important;
    text-align: left;
    color: var(--text-secondary);
  }
  .lot-details-table tr:last-child td {
    border-bottom: none !important;
  }
  .lot-details-table tr:hover {
    background: rgba(255, 255, 255, 0.03) !important;
  }
  .price-manual {
    color: var(--color-warning) !important;
    border-bottom: 1px dashed var(--color-warning) !important;
  }
`;
document.head.appendChild(style);

// DOM elements
const el = {
  tabButtons: document.querySelectorAll('.sidebar-nav li'),
  panels: document.querySelectorAll('.panel'),
  tradesTableBody: document.getElementById('trades-table-body'),
  holdingsTableBody: document.getElementById('holdings-table-body'),
  realizedTableBody: document.getElementById('realized-table-body'),
  
  // Dashboard cards
  totalAssetsVal: document.getElementById('total-assets-val'),
  floatingProfitVal: document.getElementById('floating-profit-val'),
  floatingProfitPercent: document.getElementById('floating-profit-percent'),
  realizedProfitVal: document.getElementById('realized-profit-val'),
  totalFeesVal: document.getElementById('total-fees-val'),
  
  // Form Modal
  tradeModal: document.getElementById('trade-modal'),
  modalTitle: document.getElementById('modal-title'),
  addTradeBtn: document.getElementById('add-trade-btn'),
  closeModalBtn: document.getElementById('close-modal'),
  tradeForm: document.getElementById('trade-form'),
  
  // Form Inputs
  tradeIdInput: document.getElementById('trade-id'),
  tradeCode: document.getElementById('trade-code'),
  tradeName: document.getElementById('trade-name'),
  tradeType: document.getElementById('trade-type'),
  tradePrice: document.getElementById('trade-price'),
  tradeQty: document.getElementById('trade-qty'),
  tradeDate: document.getElementById('trade-date'),
  tradeFee: document.getElementById('trade-fee'),
  tradeNotes: document.getElementById('trade-notes'),
  
  // Lot matching elements
  sellMatchingSection: document.getElementById('sell-matching-section'),
  sellMatchingBody: document.getElementById('sell-matching-body'),
  
  // Period filter
  startDateFilter: document.getElementById('start-date-filter'),
  endDateFilter: document.getElementById('end-date-filter'),
  applyFilterBtn: document.getElementById('apply-filter'),
  resetFilterBtn: document.getElementById('reset-filter'),
  
  // Period stats cards
  periodRealizedVal: document.getElementById('period-realized-val'),
  periodVolumeVal: document.getElementById('period-volume-val'),
  periodFeesVal: document.getElementById('period-fees-val'),
  periodCountVal: document.getElementById('period-count-val'),
  
  // Backup buttons
  exportJsonBtn: document.getElementById('export-json'),
  exportCsvBtn: document.getElementById('export-csv'),
  importFileInput: document.getElementById('import-file'),
  importBtn: document.getElementById('import-btn'),
  
  // Status indicator
  lastUpdateTime: document.getElementById('last-update-time'),
  refreshPricesBtn: document.getElementById('refresh-prices'),

  // Cloudflare elements
  authLoading: document.getElementById('auth-loading'),
  currentUserDisplay: document.getElementById('current-user-display'),
  logoutBtn: document.getElementById('logout-btn'),
  defaultCredsWarning: document.getElementById('default-creds-warning')
};

// Custom Fetch Wrapper to intercept 401 Unauthorized errors globally
async function authenticatedFetch(url, options = {}) {
  try {
    const response = await fetch(API_BASE + url, { credentials: 'include', ...options });
    if (response.status === 401) {
      console.log('Session expired or unauthorized. Redirecting to login...');
      window.location.href = '/login.html';
      return null;
    }
    return response;
  } catch (error) {
    console.error('Fetch network error:', error);
    throw error;
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify User Login Status
  const isAuthenticated = await checkAuthStatus();
  if (!isAuthenticated) return; // Redirecting...

  loadManualOverrides();
  initNavigation();
  initForms();
  initFilters();
  initBackup();
  initAuthActions();
  
  // Initial fetch
  fetchTrades();
  
  // Poll real-time prices every 45 seconds
  pricePollInterval = setInterval(fetchPrices, 45000);
});

// Authentication Checker
async function checkAuthStatus() {
  try {
    const res = await fetch(API_BASE + '/api/auth/status', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.loggedIn) {
        currentUsername = data.username;
        el.currentUserDisplay.textContent = currentUsername;
        
        // Show default password warning banner if triggered
        if (data.usingDefaultAdmin) {
          el.defaultCredsWarning.style.display = 'block';
        } else {
          el.defaultCredsWarning.style.display = 'none';
        }
        
        // Hide global screen loader smoothly
        if (el.authLoading) {
          el.authLoading.style.opacity = '0';
          setTimeout(() => {
            el.authLoading.style.display = 'none';
          }, 300);
        }
        return true;
      }
    }
  } catch (err) {
    console.error('Failed to query auth status:', err);
  }
  
  // Redirect to login if not authenticated
  window.location.href = '/login.html';
  return false;
}

// Initialize logout event
function initAuthActions() {
  el.logoutBtn.addEventListener('click', async () => {
    if (confirm('确定要退出登录吗？')) {
      try {
        const res = await fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'include' });
        if (res.ok) {
          window.location.href = '/login.html';
        }
      } catch (err) {
        console.error('Logout error:', err);
        window.location.href = '/login.html';
      }
    }
  });
}

// Load manual overrides from localStorage
function loadManualOverrides() {
  try {
    const saved = localStorage.getItem(`manual_price_overrides_${currentUsername}`);
    if (saved) {
      manualPriceOverrides = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load manual price overrides:', e);
  }
}

// Save manual overrides to localStorage
function saveManualOverrides() {
  localStorage.setItem(`manual_price_overrides_${currentUsername}`, JSON.stringify(manualPriceOverrides));
}

// Navigation Tabs
function initNavigation() {
  el.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (!tab) return;

      // Update Nav active style
      el.tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/Hide panels
      el.panels.forEach(p => {
        if (p.id === `${tab}-panel`) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      activeTab = tab;
      
      // Trigger charts resize or updates on tab switch
      if (tab === 'dashboard' && portfolioData) {
        updateCharts();
      }
    });
  });
}

// Form management & Modals
function initForms() {
  // Add trade click
  el.addTradeBtn.addEventListener('click', () => {
    openModal('新增交易记录');
  });

  // Close modal click
  el.closeModalBtn.addEventListener('click', closeModal);
  window.addEventListener('click', (e) => {
    if (e.target === el.tradeModal) closeModal();
  });

  // Calculate default A-share fees when values change
  const autoCalcFee = () => {
    const price = parseFloat(el.tradePrice.value) || 0;
    const qty = parseFloat(el.tradeQty.value) || 0;
    const type = el.tradeType.value;
    const code = el.tradeCode.value.trim().toLowerCase();
    
    if (price <= 0 || qty <= 0) return;

    // Check if code is Chinese stock
    const isChinaStock = /^(sh|sz|bj)\d{6}$/i.test(code) || /^\d{6}$/.test(code);
    
    if (isChinaStock) {
      const totalAmount = price * qty;
      let fee = totalAmount * 0.0003; //佣金 0.03%
      if (fee < 5) fee = 5;           //最低5元限制
      
      if (type === 'SELL') {
        fee += totalAmount * 0.0005; //过户费/印花税 0.05%
      }
      
      el.tradeFee.value = fee.toFixed(2);
    } else {
      // Default US stock commission
      el.tradeFee.value = "0.00";
    }
  };

  el.tradePrice.addEventListener('input', autoCalcFee);
  el.tradeQty.addEventListener('input', autoCalcFee);
  
  el.tradeType.addEventListener('change', () => {
    autoCalcFee();
    if (el.tradeType.value === 'SELL') {
      el.sellMatchingSection.style.display = 'block';
      updateSellMatchingLots();
    } else {
      el.sellMatchingSection.style.display = 'none';
    }
  });

  el.tradeCode.addEventListener('blur', () => {
    // Auto prefix SH/SZ if length is 6 numbers
    let val = el.tradeCode.value.trim();
    if (/^\d{6}$/.test(val)) {
      if (val.startsWith('6')) {
        el.tradeCode.value = 'sh' + val;
      } else {
        el.tradeCode.value = 'sz' + val;
      }
    }
    autoCalcFee();
    if (el.tradeType.value === 'SELL') {
      updateSellMatchingLots();
    }
  });

  // Form Submit
  el.tradeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const tradeData = {
      code: el.tradeCode.value.trim(),
      name: el.tradeName.value.trim(),
      type: el.tradeType.value,
      price: parseFloat(el.tradePrice.value),
      quantity: parseFloat(el.tradeQty.value),
      date: el.tradeDate.value ? new Date(el.tradeDate.value).toISOString() : new Date().toISOString(),
      fee: parseFloat(el.tradeFee.value || 0),
      notes: el.tradeNotes.value.trim(),
      matches: []
    };

    // Specific Lot Selection Validation for SELL
    if (tradeData.type === 'SELL') {
      const checkedBoxes = el.sellMatchingBody.querySelectorAll('.match-lot-check:checked');
      if (checkedBoxes.length > 0) {
        let matchedSum = 0;
        const matches = [];
        
        checkedBoxes.forEach(cb => {
          const lotId = cb.getAttribute('data-lot-id');
          const qtyInput = el.sellMatchingBody.querySelector(`.match-lot-qty[data-lot-id="${lotId}"]`);
          const qty = parseFloat(qtyInput.value) || 0;
          matchedSum += qty;
          matches.push({
            buyTradeId: lotId,
            quantity: qty
          });
        });

        // Use float precision tolerance to compare
        if (Math.abs(matchedSum - tradeData.quantity) > 0.0001) {
          alert(`您指定的匹配批次卖出数量之和（${matchedSum.toLocaleString()}股）必须等于本次卖出的总数量（${tradeData.quantity.toLocaleString()}股）！\n当前相差：${Math.abs(matchedSum - tradeData.quantity).toFixed(4)}股。`);
          return;
        }

        tradeData.matches = matches;
      }
    }

    try {
      let res;
      if (editingTradeId) {
        // Update trade
        res = await authenticatedFetch(`/api/trades/${editingTradeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData)
        });
      } else {
        // Create trade
        res = await authenticatedFetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData)
        });
      }

      if (res && res.ok) {
        closeModal();
        fetchTrades();
      } else if (res) {
        const err = await res.json();
        alert('保存交易失败: ' + err.error);
      }
    } catch (err) {
      console.error('Error saving trade:', err);
      alert('网络连接错误');
    }
  });

  el.refreshPricesBtn.addEventListener('click', () => {
    fetchPrices();
  });
}

function openModal(title, trade = null) {
  el.modalTitle.textContent = title;
  
  if (trade) {
    editingTrade = trade;
    editingTradeId = trade.id;
    el.tradeIdInput.value = trade.id;
    el.tradeCode.value = trade.code;
    el.tradeName.value = trade.name;
    el.tradeType.value = trade.type;
    el.tradePrice.value = trade.price;
    el.tradeQty.value = trade.quantity;
    
    // Format date for datetime-local input
    const localDate = new Date(trade.date);
    const offset = localDate.getTimezoneOffset();
    const formatted = new Date(localDate.getTime() - (offset * 60 * 1000)).toISOString().slice(0, 16);
    el.tradeDate.value = formatted;
    
    el.tradeFee.value = trade.fee;
    el.tradeNotes.value = trade.notes;

    if (trade.type === 'SELL') {
      el.sellMatchingSection.style.display = 'block';
      updateSellMatchingLots();
    } else {
      el.sellMatchingSection.style.display = 'none';
    }
  } else {
    editingTrade = null;
    editingTradeId = null;
    el.tradeForm.reset();
    
    // Default current time
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const formatted = new Date(now.getTime() - (offset * 60 * 1000)).toISOString().slice(0, 16);
    el.tradeDate.value = formatted;
    
    el.sellMatchingSection.style.display = 'none';
    el.sellMatchingBody.innerHTML = '';
  }

  el.tradeModal.classList.add('active');
}

function closeModal() {
  el.tradeModal.classList.remove('active');
  el.tradeForm.reset();
  editingTrade = null;
  editingTradeId = null;
  el.sellMatchingSection.style.display = 'none';
  el.sellMatchingBody.innerHTML = '';
}

function updateSellMatchingLots() {
  el.sellMatchingBody.innerHTML = '';
  const code = el.tradeCode.value.trim().toLowerCase();
  if (!code) {
    el.sellMatchingBody.innerHTML = '<tr><td colspan="5" class="empty-state">请输入股票代码以加载批次明细。</td></tr>';
    return;
  }

  const activeLots = [];
  if (portfolioData && portfolioData.holdings[code]) {
    const h = portfolioData.holdings[code];
    h.lots.forEach(lot => {
      let matchedByThis = 0;
      if (editingTrade && editingTrade.matches) {
        const m = editingTrade.matches.find(match => match.buyTradeId === lot.id);
        if (m) matchedByThis = m.quantity;
      }
      const availableQty = lot.remainingQuantity + matchedByThis;
      if (availableQty > 0) {
        activeLots.push({
          ...lot,
          availableQty,
          matchedByThis
        });
      }
    });
  }

  if (activeLots.length === 0) {
    el.sellMatchingBody.innerHTML = '<tr><td colspan="5" class="empty-state">该股暂无可用买入批次。若直接保存，将自动按先进先出 (FIFO) 匹配。</td></tr>';
    return;
  }

  activeLots.forEach(lot => {
    const row = document.createElement('tr');
    const isChecked = lot.matchedByThis > 0;
    const dateStr = new Date(lot.date).toLocaleDateString() + ' ' + new Date(lot.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    row.innerHTML = `
      <td style="padding: 6px 8px; text-align: center;">
        <input type="checkbox" class="match-lot-check" data-lot-id="${lot.id}" ${isChecked ? 'checked' : ''}>
      </td>
      <td style="padding: 6px 8px;">${dateStr}</td>
      <td style="padding: 6px 8px;">¥${lot.buyPrice.toFixed(3)}</td>
      <td style="padding: 6px 8px;">${lot.availableQty.toLocaleString()} 股</td>
      <td style="padding: 6px 8px;">
        <input type="number" step="0.0001" min="0.0001" max="${lot.availableQty}" 
               class="match-lot-qty" data-lot-id="${lot.id}" 
               value="${isChecked ? lot.matchedByThis : ''}"
               ${isChecked ? '' : 'disabled'} 
               style="width: 90px; padding: 4px; border-radius: 4px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.25); color: white; font-size: 11px;">
      </td>
    `;

    const check = row.querySelector('.match-lot-check');
    const qtyInput = row.querySelector('.match-lot-qty');

    check.addEventListener('change', () => {
      if (check.checked) {
        qtyInput.disabled = false;
        
        // Auto allocate remaining quantity
        const totalSellQty = parseFloat(el.tradeQty.value) || 0;
        let sumOfOthers = 0;
        el.sellMatchingBody.querySelectorAll('.match-lot-qty').forEach(input => {
          if (input !== qtyInput && !input.disabled) {
            sumOfOthers += parseFloat(input.value) || 0;
          }
        });
        const remainingToMatch = Math.max(0, totalSellQty - sumOfOthers);
        qtyInput.value = Math.min(lot.availableQty, remainingToMatch) || '';
        qtyInput.focus();
        qtyInput.select();
      } else {
        qtyInput.disabled = true;
        qtyInput.value = '';
      }
    });

    el.sellMatchingBody.appendChild(row);
  });
}

// Data Loading
async function fetchTrades() {
  try {
    const res = await authenticatedFetch('/api/trades');
    if (res && res.ok) {
      allTrades = await res.json();
      recalculateAndRender();
      fetchPrices(); // Fetch fresh prices for holdings
    }
  } catch (error) {
    console.error('Error fetching trades:', error);
  }
}

// Primary Recalculation Flow
function recalculateAndRender() {
  // Step 1: Calculate basic portfolio matrices chronologically
  portfolioData = calculatePortfolio(allTrades);

  // Step 2: Merge in manual overrides or stored real-time prices
  const mergedPrices = { ...realTimePrices };
  Object.keys(manualPriceOverrides).forEach(code => {
    mergedPrices[code] = {
      price: manualPriceOverrides[code],
      changePercent: realTimePrices[code]?.changePercent || 0
    };
  });

  // Step 3: Compute floating profits with prices
  const finalPortfolio = updatePortfolioWithPrices(portfolioData.holdings, mergedPrices);

  // Step 4: Populate DOM elements
  renderSummary(finalPortfolio.summary, portfolioData);
  renderHoldingsTable(finalPortfolio.activeHoldings, finalPortfolio.closedHoldings);
  renderClosedTable(finalPortfolio.closedHoldings);
  renderTradesTable(portfolioData.sortedTrades);
  
  // Step 5: Update Charts
  updateCharts();
  
  // Period filter updates
  updatePeriodStatistics();
}

// Fetch prices from server proxy
async function fetchPrices() {
  if (!portfolioData || Object.keys(portfolioData.holdings).length === 0) {
    el.lastUpdateTime.textContent = '暂无持仓代码';
    return;
  }

  // Find all active holding codes + any closed ones that might have trades
  const activeCodes = Object.keys(portfolioData.holdings);

  if (activeCodes.length === 0) {
    el.lastUpdateTime.textContent = '无持仓股票';
    return;
  }

  try {
    const res = await authenticatedFetch(`/api/prices?symbols=${activeCodes.join(',')}`);
    if (res && res.ok) {
      const data = await res.json();
      
      // Update global price state
      realTimePrices = data;
      el.lastUpdateTime.textContent = '更新于: ' + new Date().toLocaleTimeString();
      
      // Recalculate portfolio with new prices
      recalculateAndRender();
    }
  } catch (err) {
    console.error('Failed to fetch real-time prices:', err);
    el.lastUpdateTime.textContent = '价格获取失败: ' + err.message;
  }
}

// Render summary cards
function renderSummary(pSummary, rawData) {
  const totalValue = pSummary.totalMarketValue;
  const floatingProfit = pSummary.totalFloatingProfit;
  const floatingProfitRate = pSummary.totalFloatingProfitRate;
  const realizedProfit = rawData.totalRealizedProfit;
  const totalFees = rawData.totalFees;

  el.totalAssetsVal.textContent = '¥' + totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 });
  
  // Floating Profit formatting
  formatProfitValue(el.floatingProfitVal, floatingProfit, '¥');
  formatProfitValue(el.floatingProfitPercent, floatingProfitRate, '', '%');

  // Realized Profit formatting
  formatProfitValue(el.realizedProfitVal, realizedProfit, '¥');

  // Fees
  el.totalFeesVal.textContent = '¥' + totalFees.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function formatProfitValue(element, value, prefix = '', suffix = '') {
  const absVal = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const text = `${value >= 0 ? '+' : '-'}${prefix}${absVal}${suffix}`;
  element.textContent = text;
  
  element.classList.remove('up', 'down');
  if (value > 0) {
    element.classList.add('up');
  } else if (value < 0) {
    element.classList.add('down');
  }
}

// Render Holdings Table
function renderHoldingsTable(activeHoldings, closedHoldings = []) {
  // Capture expanded detail row IDs before rendering
  const expandedCodes = Array.from(el.holdingsTableBody.querySelectorAll('.holding-details-row'))
    .map(row => row.id.replace('details-', ''));

  el.holdingsTableBody.innerHTML = '';
  
  const combinedHoldings = [
    ...activeHoldings,
    ...closedHoldings
  ];

  if (combinedHoldings.length === 0) {
    el.holdingsTableBody.innerHTML = `<tr><td colspan="10" class="empty-state">暂无持仓股票，请前往录入交易。</td></tr>`;
    return;
  }

  combinedHoldings.forEach(h => {
    const isClosedPosition = h.heldQuantity === 0;
    const row = document.createElement('tr');
    row.className = isClosedPosition ? 'holding-row closed-position' : 'holding-row';
    
    const profitClass = h.floatingProfit >= 0 ? 'up' : 'down';
    const profitSign = h.floatingProfit >= 0 ? '+' : '';
    
    // Check if price is manually overridden
    const isOverridden = manualPriceOverrides[h.code] !== undefined;
    const priceDisplayClass = isOverridden ? 'price-manual' : '';

    row.innerHTML = `
      <td>
        <div class="stock-name-cell">
          <span class="stock-name">${h.name}${isClosedPosition ? '<span class="closed-badge">已结清</span>' : ''}</span>
          <span class="stock-code">${h.code.toUpperCase()}</span>
        </div>
      </td>
      <td>${h.heldQuantity.toLocaleString()}</td>
      <td>¥${h.averageBuyingPrice.toFixed(3)}</td>
      <td>¥${h.costValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>
        <div class="price-input-cell">
          <input type="number" step="0.001" class="price-override-input ${priceDisplayClass}" 
                 value="${h.currentPrice.toFixed(3)}" data-code="${h.code}" title="双击输入手动修改价格">
          ${isOverridden ? '<button class="clear-override-btn" data-code="'+h.code+'" title="清除手动定价">×</button>' : ''}
        </div>
      </td>
      <td>¥${h.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>
        <span class="${h.changePercent >= 0 ? 'up' : 'down'}">
          ${h.changePercent >= 0 ? '+' : ''}${h.changePercent.toFixed(2)}%
        </span>
      </td>
      <td class="${profitClass}">${profitSign}¥${h.floatingProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td class="${profitClass}">${profitSign}${h.floatingProfitRate.toFixed(2)}%</td>
      <td>¥${h.dilutedAverageCost.toFixed(3)}</td>
    `;

    // Toggle lot details on row click
    row.addEventListener('click', (e) => {
      if (e.target.closest('.price-input-cell') || e.target.closest('.clear-override-btn') || e.target.closest('.price-override-input')) {
        return;
      }
      toggleLotDetails(h, row);
    });

    // Attach Price Override Events
    const input = row.querySelector('.price-override-input');
    input.addEventListener('change', (e) => {
      const code = e.target.getAttribute('data-code');
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 0) {
        manualPriceOverrides[code] = val;
        saveManualOverrides();
        recalculateAndRender();
      }
    });

    // Clear override button
    const clearBtn = row.querySelector('.clear-override-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        const code = e.target.getAttribute('data-code');
        delete manualPriceOverrides[code];
        saveManualOverrides();
        recalculateAndRender();
      });
    }

    el.holdingsTableBody.appendChild(row);

    // Re-expand if previously expanded
    if (expandedCodes.includes(h.code)) {
      toggleLotDetails(h, row);
    }
  });
}

function toggleLotDetails(h, rowElement) {
  const code = h.code;
  const detailsRowId = `details-${code}`;
  let detailsRow = document.getElementById(detailsRowId);

  if (detailsRow) {
    detailsRow.remove();
    rowElement.classList.remove('expanded');
    return;
  }

  // Create details sub-row
  detailsRow = document.createElement('tr');
  detailsRow.id = detailsRowId;
  detailsRow.className = 'holding-details-row';

  let lotRowsHtml = '';
  if (h.lots && h.lots.length > 0) {
    // Sort lots: closed lots (remainingQuantity === 0) at the end, others first, then by date ascending
    const sortedLots = [...h.lots].sort((a, b) => {
      const aClosed = a.remainingQuantity === 0;
      const bClosed = b.remainingQuantity === 0;
      if (aClosed !== bClosed) {
        return aClosed ? 1 : -1;
      }
      return new Date(a.date) - new Date(b.date);
    });

    sortedLots.forEach((lot, index) => {
      const idx = index + 1;
      const dateStr = new Date(lot.date).toLocaleDateString();
      const isClosed = lot.remainingQuantity === 0;
      const soldQtyText = lot.soldQuantity > 0 ? `-${lot.soldQuantity.toLocaleString()}` : '0';
      
      const profitVal = lot.floatingProfit;
      const profitClass = profitVal >= 0 ? 'up' : 'down';
      const profitSign = profitVal >= 0 ? '+' : '';
      
      const realizedVal = lot.realizedProfit;
      const realizedClass = realizedVal >= 0 ? 'up' : 'down';
      const realizedSign = realizedVal >= 0 ? '+' : '';

      const returnRateVal = lot.returnRate || 0;
      const returnClass = returnRateVal >= 0 ? 'up' : 'down';
      const returnSign = returnRateVal >= 0 ? '+' : '';

      const sellPriceText = lot.soldQuantity > 0 ? `¥${lot.weightedSellPrice.toFixed(3)}` : '¥0.000';
      const floatingProfitText = isClosed ? '¥0.00' : `${profitSign}¥${profitVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const realizedProfitText = lot.soldQuantity > 0 ? `${realizedSign}¥${realizedVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '¥0.00';

      lotRowsHtml += `
        <tr>
          <td>${idx}</td>
          <td>${dateStr}</td>
          <td>${lot.buyQuantity.toLocaleString()}</td>
          <td>¥${lot.buyCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td>¥${lot.buyPrice.toFixed(3)}</td>
          <td>${sellPriceText}</td>
          <td class="${isClosed ? '' : profitClass}">${floatingProfitText}</td>
          <td class="${lot.soldQuantity > 0 ? realizedClass : ''}">${realizedProfitText}</td>
          <td>${soldQtyText}</td>
          <td class="${returnClass}">${returnSign}${returnRateVal.toFixed(2)}%</td>
        </tr>
      `;
    });
  } else {
    lotRowsHtml = `<tr><td colspan="10" class="empty-state">暂无批次持仓明细。</td></tr>`;
  }

  detailsRow.innerHTML = `
    <td colspan="10">
      <div class="lot-details-container">
        <div class="lot-details-title">💼 <b>${h.name} (${code.toUpperCase()})</b> 持仓与交易批次明细 (点击持仓行可收起)</div>
        <table class="lot-details-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>日期</th>
              <th>买入股数</th>
              <th>买入本金</th>
              <th>买入价</th>
              <th>卖出价</th>
              <th>当前盈亏</th>
              <th>本次纯收入</th>
              <th>已卖出股数</th>
              <th>收益率</th>
            </tr>
          </thead>
          <tbody>
            ${lotRowsHtml}
          </tbody>
        </table>
      </div>
    </td>
  `;

  rowElement.parentNode.insertBefore(detailsRow, rowElement.nextSibling);
  rowElement.classList.add('expanded');
}

// Render Closed Positions
function renderClosedTable(closedHoldings) {
  el.realizedTableBody.innerHTML = '';
  
  const closedWithTrades = closedHoldings.filter(h => h.totalBuyQuantity > 0);
  
  if (closedWithTrades.length === 0) {
    el.realizedTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">无清仓交易统计记录。</td></tr>`;
    return;
  }

  closedWithTrades.forEach(h => {
    const row = document.createElement('tr');
    const profitClass = h.realizedProfit >= 0 ? 'up' : 'down';
    const profitSign = h.realizedProfit >= 0 ? '+' : '';

    row.innerHTML = `
      <td>
        <div class="stock-name-cell">
          <span class="stock-name">${h.name}</span>
          <span class="stock-code">${h.code.toUpperCase()}</span>
        </div>
      </td>
      <td>${h.totalBuyQuantity.toLocaleString()}</td>
      <td>¥${h.totalBuyCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>¥${h.totalSellValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>¥${(h.totalBuyCost / h.totalBuyQuantity).toFixed(3)}</td>
      <td>¥${(h.totalSellValue / h.totalBuyQuantity).toFixed(3)}</td>
      <td class="${profitClass}">${profitSign}¥${h.realizedProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    `;
    el.realizedTableBody.appendChild(row);
  });
}

// Render Trade Records Table
function renderTradesTable(sortedTrades) {
  el.tradesTableBody.innerHTML = '';
  
  // Show in reverse chronological order for history list (newest first)
  const listTrades = [...sortedTrades].reverse();

  if (listTrades.length === 0) {
    el.tradesTableBody.innerHTML = `<tr><td colspan="9" class="empty-state">没有记录任何交易。</td></tr>`;
    return;
  }

  listTrades.forEach(t => {
    const row = document.createElement('tr');
    const typeClass = t.type === 'BUY' ? 'type-buy' : 'type-sell';
    const typeText = t.type === 'BUY' ? '买入' : '卖出';
    const dateStr = new Date(t.date).toLocaleString();

    row.innerHTML = `
      <td>${dateStr}</td>
      <td>
        <div class="stock-name-cell">
          <span class="stock-name">${t.name}</span>
          <span class="stock-code">${t.code.toUpperCase()}</span>
        </div>
      </td>
      <td><span class="badge ${typeClass}">${typeText}</span></td>
      <td>¥${t.price.toFixed(3)}</td>
      <td>${t.quantity.toLocaleString()}</td>
      <td>¥${(t.price * t.quantity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>¥${t.fee.toFixed(2)}</td>
      <td class="notes-cell" title="${t.notes}">${t.notes || '-'}</td>
      <td>
        <div class="table-actions">
          <button class="edit-btn" data-id="${t.id}">编辑</button>
          <button class="delete-btn" data-id="${t.id}">删除</button>
        </div>
      </td>
    `;

    // Attach actions
    row.querySelector('.edit-btn').addEventListener('click', () => {
      openModal('编辑交易记录', t);
    });
    row.querySelector('.delete-btn').addEventListener('click', async () => {
      if (confirm(`确定要删除 [${t.name}] 的这笔交易记录吗？`)) {
        try {
          const res = await authenticatedFetch(`/api/trades/${t.id}`, { method: 'DELETE' });
          if (res && res.ok) {
            fetchTrades();
          } else if (res) {
            alert('删除交易失败');
          }
        } catch (err) {
          console.error(err);
        }
      }
    });

    el.tradesTableBody.appendChild(row);
  });
}

// Update charts using calculations results
function updateCharts() {
  if (activeTab !== 'dashboard' || !portfolioData) return;

  const activeHoldings = [];
  Object.keys(portfolioData.holdings).forEach(code => {
    const h = portfolioData.holdings[code];
    if (h.heldQuantity > 0) activeHoldings.push(h);
  });

  // Active holdings distribution doughnut
  renderHoldingsChart('holdings-chart', activeHoldings);

  // Profit curve timeline
  const currentFloatingProfit = activeHoldings.reduce((sum, h) => sum + (h.floatingProfit || 0), 0);
  renderProfitChart('profit-chart', portfolioData.profitTimeline, currentFloatingProfit);
}

// Period Filters & Analysis Panel
function initFilters() {
  // Set default filter: current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const toDateInputString = (date) => {
    return date.toISOString().split('T')[0];
  };

  el.startDateFilter.value = toDateInputString(startOfMonth);
  el.endDateFilter.value = toDateInputString(now);

  el.applyFilterBtn.addEventListener('click', () => {
    updatePeriodStatistics();
  });

  el.resetFilterBtn.addEventListener('click', () => {
    el.startDateFilter.value = '';
    el.endDateFilter.value = '';
    updatePeriodStatistics();
  });
}

function updatePeriodStatistics() {
  if (!allTrades || allTrades.length === 0) return;

  const startVal = el.startDateFilter.value;
  const endVal = el.endDateFilter.value;

  const stats = analyzePeriod(allTrades, startVal, endVal);

  // Update DOM cards
  formatProfitValue(el.periodRealizedVal, stats.realizedProfit, '¥');
  el.periodVolumeVal.textContent = '¥' + (stats.buyVolume + stats.sellVolume).toLocaleString(undefined, { minimumFractionDigits: 2 });
  el.periodFeesVal.textContent = '¥' + stats.fees.toLocaleString(undefined, { minimumFractionDigits: 2 });
  el.periodCountVal.textContent = stats.tradeCount + ' 笔';
}

// Data Backup (JSON & CSV)
function initBackup() {
  el.exportJsonBtn.addEventListener('click', () => {
    // Backup export via top-level navigation (cookie is sent on same-site navigation)
    window.location.href = API_BASE + '/api/backup/export';
  });

  el.exportCsvBtn.addEventListener('click', () => {
    exportToCsv();
  });

  el.importBtn.addEventListener('click', () => {
    el.importFileInput.click();
  });

  el.importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    
    // Check if JSON or CSV
    if (file.name.endsWith('.json')) {
      reader.onload = async (evt) => {
        try {
          const raw = JSON.parse(evt.target.result);
          await importData(raw);
        } catch (err) {
          alert('解析 JSON 失败: ' + err.message);
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith('.csv')) {
      reader.onload = async (evt) => {
        try {
          const csvText = evt.target.result;
          const raw = parseCsvToJSON(csvText);
          await importData(raw);
        } catch (err) {
          alert('解析 CSV 失败: ' + err.message);
        }
      };
      reader.readAsText(file, 'utf-8');
    } else {
      alert('仅支持 .json 或 .csv 文件！');
    }
    
    // Clear input
    el.importFileInput.value = '';
  });
}

async function importData(tradesArray) {
  if (!confirm(`确定导入这 ${tradesArray.length} 条交易流水记录吗？这将和已有流水合并或进行复盖处理。`)) {
    return;
  }

  try {
    const res = await authenticatedFetch('/api/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tradesArray)
    });
    
    if (res && res.ok) {
      alert('导入数据成功！');
      fetchTrades();
    } else if (res) {
      const err = await res.json();
      alert('导入失败: ' + err.error);
    }
  } catch (err) {
    console.error(err);
    alert('网络导入失败');
  }
}

// Convert current trades to CSV and prompt download
function exportToCsv() {
  if (allTrades.length === 0) {
    alert('没有任何交易记录可导出！');
    return;
  }

  const headers = ['时间', '代码', '名称', '类型', '单价', '数量', '费用', '备注'];
  const rows = allTrades.map(t => [
    new Date(t.date).toISOString(),
    t.code,
    t.name,
    t.type,
    t.price,
    t.quantity,
    t.fee,
    t.notes.replace(/,/g, '，') // Escape comma
  ]);

  const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `stock_trades_export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// CSV Parser Helper
function parseCsvToJSON(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV 文件数据不足');

  // Verify headers or detect column positions
  const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, '')); // strip BOM
  
  const trades = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 6) continue;

    // Headers map: 时间,代码,名称,类型,单价,数量,费用,备注
    // ISO Date, Code, Name, BUY/SELL, Price, Qty, Fee, Notes
    const trade = {
      date: cols[0] ? new Date(cols[0]).toISOString() : new Date().toISOString(),
      code: cols[1] || 'UNKNOWN',
      name: cols[2] || 'Unknown',
      type: cols[3] === '卖出' || cols[3] === 'SELL' ? 'SELL' : 'BUY',
      price: parseFloat(cols[4]) || 0,
      quantity: parseFloat(cols[5]) || 0,
      fee: parseFloat(cols[6]) || 0,
      notes: cols[7] || ''
    };

    trades.push(trade);
  }

  return trades;
}
