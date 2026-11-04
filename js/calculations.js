/**
 * Core Calculations for Stock Portfolio
 */

/**
 * Process all trades chronologically and compute current holdings and realized profits.
 * @param {Array} trades List of trade objects
 * @returns {Object} { holdings: Object, statistics: Object, historyChartData: Array }
 */
function calculatePortfolio(trades) {
  // Sort trades chronologically
  const sortedTrades = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));

  const holdings = {};
  let totalRealizedProfit = 0;
  let totalFees = 0;

  // Track historical realized profit timeline
  const profitTimeline = [];

  sortedTrades.forEach(trade => {
    const code = trade.code;
    const name = trade.name;
    const type = trade.type;
    const price = parseFloat(trade.price);
    const qty = parseFloat(trade.quantity);
    const fee = parseFloat(trade.fee || 0);

    totalFees += fee;

    if (!holdings[code]) {
      holdings[code] = {
        code,
        name,
        heldQuantity: 0,
        averageBuyingPrice: 0, // 加权买入均价
        totalBuyQuantity: 0,
        totalBuyCost: 0,       // 累计买入花费(含佣金)
        totalSellQuantity: 0,
        totalSellValue: 0,     // 累计卖出所得(扣除佣金)
        realizedProfit: 0,     // 该股已实现盈亏
        lots: []               // 持仓批次明细
      };
    }

    const h = holdings[code];

    if (type === 'BUY') {
      const cost = price * qty + fee;
      
      // If previous position was empty, reset buying price
      if (h.heldQuantity === 0) {
        h.averageBuyingPrice = 0;
      }
      
      h.averageBuyingPrice = (h.heldQuantity * h.averageBuyingPrice + cost) / (h.heldQuantity + qty);
      h.heldQuantity += qty;
      h.totalBuyQuantity += qty;
      h.totalBuyCost += cost;

      // Add new buy lot
      h.lots.push({
        id: trade.id,
        date: trade.date,
        buyPrice: price,
        buyQuantity: qty,
        buyFee: fee,
        buyCapital: cost,
        soldQuantity: 0,
        remainingQuantity: qty,
        weightedSellPrice: 0,
        sellProceeds: 0,
        sellFees: 0,
        realizedProfit: 0,
        completed: false,
        notes: trade.notes || ''
      });
    } else if (type === 'SELL') {
      const proceeds = price * qty - fee;
      
      // Compute actual matches (either from trade.matches or FIFO fallback)
      let matches = [];
      if (trade.matches && Array.isArray(trade.matches) && trade.matches.length > 0) {
        matches = trade.matches;
      } else {
        // Fallback: FIFO matching
        let remainingToMatch = qty;
        h.lots.forEach(lot => {
          if (lot.remainingQuantity <= 0 || remainingToMatch <= 0) return;
          const matchQty = Math.min(lot.remainingQuantity, remainingToMatch);
          matches.push({
            buyTradeId: lot.id,
            quantity: matchQty
          });
          remainingToMatch -= matchQty;
        });

        // Safe Fallback: if selling more than owned, allocate remaining to the first lot
        if (remainingToMatch > 0 && h.lots.length > 0) {
          matches.push({
            buyTradeId: h.lots[0].id,
            quantity: remainingToMatch
          });
        }
      }

      // Process matches and calculate realized profit on lots
      let tradeProfit = 0;
      matches.forEach(match => {
        const lot = h.lots.find(l => l.id === match.buyTradeId);
        if (lot) {
          // Cap match quantity to avoid over-allocation
          const matchQty = Math.min(match.quantity, lot.remainingQuantity || match.quantity);
          if (matchQty <= 0) return;

          lot.soldQuantity += matchQty;
          lot.remainingQuantity = Math.max(0, lot.remainingQuantity - matchQty);

          const propBuyCost = (matchQty / lot.buyQuantity) * lot.buyCapital;
          const propSellValue = matchQty * price;
          const propSellFee = (matchQty / qty) * fee;
          const propSellProceeds = propSellValue - propSellFee;

          const lotProfit = propSellProceeds - propBuyCost;
          lot.realizedProfit += lotProfit;
          lot.sellProceeds += propSellValue;
          lot.sellFees += propSellFee;
          lot.weightedSellPrice = lot.soldQuantity > 0 ? lot.sellProceeds / lot.soldQuantity : 0;

          if (lot.remainingQuantity === 0) {
            lot.completed = true;
          }

          tradeProfit += lotProfit;
        }
      });

      // Update aggregate states using precise lot-matching profit
      h.realizedProfit += tradeProfit;
      totalRealizedProfit += tradeProfit;
      
      h.heldQuantity = Math.max(0, h.heldQuantity - qty);
      h.totalSellQuantity += qty;
      h.totalSellValue += proceeds;
      
      if (h.heldQuantity === 0) {
        h.averageBuyingPrice = 0; // Position closed
      }

      // Record timeline event
      profitTimeline.push({
        date: trade.date,
        realizedProfitChange: tradeProfit,
        accumulatedRealizedProfit: totalRealizedProfit,
        stockCode: code,
        stockName: name
      });
    }
  });

  // Calculate diluted cost basis for active holdings
  Object.keys(holdings).forEach(code => {
    const h = holdings[code];
    if (h.heldQuantity > 0) {
      // 摊薄持仓均价 = (累计买入金额 - 累计卖出金额) / 当前持仓数量
      h.dilutedAverageCost = (h.totalBuyCost - h.totalSellValue) / h.heldQuantity;
    } else {
      h.dilutedAverageCost = 0;
    }
  });

  return {
    holdings,
    totalRealizedProfit,
    totalFees,
    profitTimeline,
    sortedTrades
  };
}

/**
 * Update holdings with real-time price info and compute floating P&L.
 * @param {Object} holdings Calculated holdings dictionary
 * @param {Object} realTimePrices Dictionary of symbol -> { price, changePercent }
 * @returns {Object} Updated holdings & portfolio statistics
 */
function updatePortfolioWithPrices(holdings, realTimePrices) {
  let totalHoldingsMarketValue = 0;
  let totalHoldingsCost = 0;
  let totalFloatingProfit = 0;

  const activeHoldings = [];
  const closedHoldings = [];

  Object.keys(holdings).forEach(code => {
    const h = holdings[code];
    const rt = realTimePrices[code] || realTimePrices[code.toUpperCase()] || realTimePrices[code.toLowerCase()];
    
    // Default current price to average buying price if no real-time price is available
    const currentPrice = rt ? parseFloat(rt.price) : (h.averageBuyingPrice || 0);
    const changePercent = rt ? parseFloat(rt.changePercent || 0) : 0;

    h.currentPrice = currentPrice;
    h.changePercent = changePercent;
    h.marketValue = h.heldQuantity * currentPrice;
    h.costValue = h.heldQuantity * h.averageBuyingPrice;
    
    if (h.heldQuantity > 0) {
      h.floatingProfit = h.marketValue - h.costValue;
      h.floatingProfitRate = h.costValue > 0 ? (h.floatingProfit / h.costValue) * 100 : 0;
      
      totalHoldingsMarketValue += h.marketValue;
      totalHoldingsCost += h.costValue;
      totalFloatingProfit += h.floatingProfit;
      
      activeHoldings.push(h);
    } else {
      h.floatingProfit = 0;
      h.floatingProfitRate = 0;
      h.marketValue = 0;
      h.currentPrice = 0;
      closedHoldings.push(h);
    }

    // Update individual lot details for this stock
    if (h.lots && h.lots.length > 0) {
      h.lots.forEach(lot => {
        const lotCurrentPrice = rt ? parseFloat(rt.price) : lot.buyPrice;
        
        lot.currentPrice = lotCurrentPrice;
        lot.marketValue = lot.remainingQuantity * lotCurrentPrice;
        // Proportional cost including proportional fee
        lot.costValue = lot.remainingQuantity * lot.buyPrice + (lot.remainingQuantity / lot.buyQuantity) * lot.buyFee;
        lot.floatingProfit = lot.marketValue - lot.costValue;
        lot.floatingProfitRate = lot.costValue > 0 ? (lot.floatingProfit / lot.costValue) * 100 : 0;

        // Return rate: (CurrentPrice - BuyPrice) / BuyPrice if active, (SellPrice - BuyPrice) / BuyPrice if closed
        if (lot.remainingQuantity > 0) {
          lot.returnRate = ((lotCurrentPrice - lot.buyPrice) / lot.buyPrice) * 100;
        } else {
          lot.returnRate = ((lot.weightedSellPrice - lot.buyPrice) / lot.buyPrice) * 100;
        }
      });
    }
  });

  return {
    activeHoldings,
    closedHoldings,
    summary: {
      totalMarketValue: totalHoldingsMarketValue,
      totalCost: totalHoldingsCost,
      totalFloatingProfit: totalFloatingProfit,
      totalFloatingProfitRate: totalHoldingsCost > 0 ? (totalFloatingProfit / totalHoldingsCost) * 100 : 0
    }
  };
}

/**
 * Filter and analyze trades and earnings in a specific time range.
 * @param {Array} trades List of trades
 * @param {string} startDate ISO date string
 * @param {string} endDate ISO date string
 * @returns {Object} Statistics for the period
 */
function analyzePeriod(trades, startDate, endDate) {
  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();
  
  // Make end date inclusive of the whole day
  end.setHours(23, 59, 59, 999);

  const periodTrades = trades.filter(t => {
    const d = new Date(t.date);
    return d >= start && d <= end;
  });

  // Calculate statistics for this period
  let periodBuyVolume = 0;
  let periodSellVolume = 0;
  let periodFees = 0;

  periodTrades.forEach(t => {
    const amount = parseFloat(t.price) * parseFloat(t.quantity);
    const fee = parseFloat(t.fee || 0);
    periodFees += fee;

    if (t.type === 'BUY') {
      periodBuyVolume += amount;
    } else if (t.type === 'SELL') {
      periodSellVolume += amount;
    }
  });

  // Period realized profit requires sorting and stepping through
  const portfolio = calculatePortfolio(trades);
  
  // Filter profit timeline inside the period
  const timelineInPeriod = portfolio.profitTimeline.filter(e => {
    const d = new Date(e.date);
    return d >= start && d <= end;
  });

  const periodRealizedProfit = timelineInPeriod.reduce((sum, e) => sum + e.realizedProfitChange, 0);

  return {
    trades: periodTrades,
    buyVolume: periodBuyVolume,
    sellVolume: periodSellVolume,
    fees: periodFees,
    realizedProfit: periodRealizedProfit,
    tradeCount: periodTrades.length
  };
}

// Export for Node environments if running tests, otherwise define on window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculatePortfolio,
    updatePortfolioWithPrices,
    analyzePeriod
  };
}
