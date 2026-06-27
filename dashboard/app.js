(function() {
  const isBackendPort = window.location.port === '3005';
  const backendHost = isBackendPort ? window.location.host : 'localhost:3005';
  const backendBase = isBackendPort ? '' : 'http://localhost:3005';

  const socket = new WebSocket(`ws://${backendHost}`);
  const transactionList = document.getElementById('transaction-list');
  const aiDecisionFeed = document.getElementById('ai-decision-feed');
  const currentSlotEl = document.getElementById('current-slot');
  const netHealthDeltaEl = document.getElementById('net-health-delta');
  const successRateEl = document.getElementById('success-rate');
  const activeTxCountEl = document.getElementById('active-tx-count');
  
  // Set the correct href for the export log button in case of proxy hosting
  const btnExportLogs = document.getElementById('btn-export-logs');
  if (btnExportLogs) {
    btnExportLogs.href = `${backendBase}/api/export-logs`;
  }
  
  // Controls elements
  const simulationStatusEl = document.getElementById('simulation-status');
  const btnSubmitTx = document.getElementById('btn-submit-tx');
  const btnInjectFault = document.getElementById('btn-inject-fault');
  const selectAIProvider = document.getElementById('select-ai-provider');
  
  // Navigation elements
  const tabDashboard = document.getElementById('tab-dashboard');
  const tabArchitecture = document.getElementById('tab-architecture');
  const dashboardView = document.getElementById('dashboard-view');
  const architectureViewPanel = document.getElementById('architecture-view-panel');


  let logs = [];
  let activeSignatures = new Set();

  function highlightArchStep(stepId) {
    const step = document.getElementById(stepId);
    if (!step) return;
    // Remove class first to re-trigger transition if active
    step.classList.remove('pulse-highlight');
    // Force reflow
    void step.offsetWidth;
    step.classList.add('pulse-highlight');
    setTimeout(() => {
      step.classList.remove('pulse-highlight');
    }, 1000);
  }

  socket.onopen = () => {
    console.log('WebSocket connection established.');
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'init') {
      logs = message.data.logs;
      currentSlotEl.innerText = message.data.currentSlot || '-----';
      renderLogs();
      renderDecisions(message.data.decisions);
      updateSummaryStats();
      if (message.data.config) {
        updateConfigUI(message.data.config);
      }
    } else if (message.type === 'slot-update') {
      currentSlotEl.innerText = message.data.slot;
      highlightArchStep('arch-step-1');
    } else if (message.type.startsWith('tx-')) {
      handleTxUpdate(message.type, message.data);
    } else if (message.type === 'ai-decision') {
      addDecisionCard(message.data);
      highlightArchStep('arch-step-2');
    } else if (message.type === 'config-update') {
      updateConfigUI(message.data);
    }
  };

  // Control action bindings
  btnSubmitTx.addEventListener('click', async () => {
    btnSubmitTx.disabled = true;
    btnSubmitTx.innerText = 'Triggering...';
    try {
      const res = await fetch(`${backendBase}/api/submit`, { method: 'POST' });
      const data = await res.json();
      console.log('Submission result:', data);
    } catch (err) {
      console.error('Failed to submit transaction:', err);
    } finally {
      setTimeout(() => {
        btnSubmitTx.disabled = false;
        btnSubmitTx.innerText = 'Trigger Tx Bundle';
      }, 1000);
    }
  });

  btnInjectFault.addEventListener('click', async () => {
    btnInjectFault.disabled = true;
    btnInjectFault.innerText = 'Injecting...';
    try {
      const res = await fetch(`${backendBase}/api/inject-fault`, { method: 'POST' });
      const data = await res.json();
      console.log('Fault injection result:', data);
    } catch (err) {
      console.error('Failed to inject blockhash fault:', err);
    } finally {
      setTimeout(() => {
        btnInjectFault.disabled = false;
        btnInjectFault.innerText = 'Inject Stale Blockhash';
      }, 1000);
    }
  });

  simulationStatusEl.addEventListener('click', async () => {
    const isSimulated = simulationStatusEl.classList.contains('simulated');
    try {
      const res = await fetch(`${backendBase}/api/toggle-simulation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !isSimulated })
      });
      const data = await res.json();
      setSimulationMode(data.simulateTransactions);
    } catch (err) {
      console.error('Failed to toggle simulation mode:', err);
    }
  });

  selectAIProvider.addEventListener('change', async () => {
    const provider = selectAIProvider.value;
    try {
      const res = await fetch(`${backendBase}/api/update-ai-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      const data = await res.json();
      console.log('AI Provider set to:', data.provider);
    } catch (err) {
      console.error('Failed to update AI provider:', err);
    }
  });

  // Tab bindings
  tabDashboard.addEventListener('click', () => {
    tabDashboard.classList.add('active');
    tabArchitecture.classList.remove('active');
    dashboardView.classList.remove('hidden');
    architectureViewPanel.classList.add('hidden');
  });

  tabArchitecture.addEventListener('click', () => {
    tabArchitecture.classList.add('active');
    tabDashboard.classList.remove('active');
    dashboardView.classList.add('hidden');
    architectureViewPanel.classList.remove('hidden');
  });

  function setSimulationMode(isSimulated) {
    if (isSimulated) {
      simulationStatusEl.className = 'status-indicator simulated';
      simulationStatusEl.innerText = 'Simulation Mode';
    } else {
      simulationStatusEl.className = 'status-indicator live';
      simulationStatusEl.innerText = 'Live Mode';
    }
  }

  function updateConfigUI(config) {
    setSimulationMode(config.simulateTransactions);
    selectAIProvider.value = config.aiProvider || 'mock';
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${backendBase}/api/config`);
      const data = await res.json();
      updateConfigUI(data);
    } catch (err) {
      console.error('Failed to fetch initial configuration:', err);
    }
  }

  // Load initial config
  loadConfig();

  function handleTxUpdate(type, state) {
    const existingIndex = logs.findIndex(l => l.signature === state.signature);
    
    // Normalize properties for unified state representation
    const normalizedState = {
      signature: state.signature,
      tipAmountLamports: state.tipAmountLamports,
      status: state.status,
      failure: state.failureReason ? { type: state.failureReason, details: state.failureDetails } : null
    };

    if (existingIndex !== -1) {
      logs[existingIndex] = { ...logs[existingIndex], ...normalizedState };
    } else {
      logs.unshift(normalizedState);
    }

    if (state.status === 'submitted' || state.status === 'processed' || state.status === 'confirmed') {
      activeSignatures.add(state.signature);
    } else {
      activeSignatures.delete(state.signature);
    }

    // Dynamic UI feedback on the interactive architecture view
    if (type === 'tx-registered') {
      highlightArchStep('arch-step-3');
    } else {
      highlightArchStep('arch-step-4');
    }

    renderLogs();
    updateSummaryStats();
  }

  function renderLogs() {
    if (logs.length === 0) {
      transactionList.innerHTML = '<div class="no-data">Waiting for transactions to register...</div>';
      return;
    }

    transactionList.innerHTML = '';
    logs.forEach(log => {
      const row = document.createElement('div');
      row.className = 'tx-row';
      
      const sigAbbr = `${log.signature.substring(0, 8)}...${log.signature.substring(log.signature.length - 8)}`;
      const tipSol = (log.tipAmountLamports / 1e9).toFixed(5);
      
      // Calculate progress width and node status
      let width = '0%';
      let pClass = '', cClass = '', fClass = '';

      if (log.status === 'processed') {
        width = '33%';
        pClass = 'active';
      } else if (log.status === 'confirmed') {
        width = '66%';
        pClass = 'completed';
        cClass = 'active';
      } else if (log.status === 'finalized') {
        width = '100%';
        pClass = 'completed';
        cClass = 'completed';
        fClass = 'completed';
      } else if (log.status === 'failed') {
        width = '0%';
      }

      const progressHtml = `
        <div class="lifecycle-progress">
          <div class="progress-bar-bg"></div>
          <div class="progress-bar-fill" style="width: ${width}"></div>
          <div class="step-node completed" title="Submitted">S</div>
          <div class="step-node ${pClass}" title="Processed">P</div>
          <div class="step-node ${cClass}" title="Confirmed">C</div>
          <div class="step-node ${fClass}" title="Finalized">F</div>
        </div>
      `;

      const isSimulated = simulationStatusEl.classList.contains('simulated');
      const explorerUrl = isSimulated
        ? 'javascript:void(0)'
        : `https://explorer.solana.com/tx/${log.signature}`;
      
      const sigHtml = isSimulated
        ? `<span class="tx-sig simulated-sig" title="Simulated Signature - No On-chain record">${sigAbbr}</span>`
        : `<a class="tx-sig live-sig" href="${explorerUrl}" target="_blank" title="View on Solana Explorer">${sigAbbr}</a>`;

      row.innerHTML = `
        ${sigHtml}
        <span class="tx-tip">${tipSol} SOL</span>
        ${progressHtml}
        <span class="status-pill ${log.status}">${log.status.toUpperCase()}</span>
      `;

      transactionList.appendChild(row);
    });
  }

  function renderDecisions(decisions) {
    if (!decisions || decisions.length === 0) {
      aiDecisionFeed.innerHTML = '<div class="no-data">Waiting for AI agent decisions...</div>';
      return;
    }
    aiDecisionFeed.innerHTML = '';
    // Copy and reverse to show oldest first, or just show them in order
    [...decisions].reverse().forEach(d => addDecisionCard(d));
  }

  function addDecisionCard(decision) {
    const noData = aiDecisionFeed.querySelector('.no-data');
    if (noData) noData.remove();

    const card = document.createElement('div');
    card.className = 'decision-card';
    
    const timeStr = new Date(decision.timestamp).toLocaleTimeString();
    
    // Parse the output decision JSON for premium formatting
    let outcomeHtml = '';
    try {
      const parsed = typeof decision.outputDecision === 'string'
        ? JSON.parse(decision.outputDecision)
        : decision.outputDecision;
      
      if (decision.decisionType === 'TIP_SELECTION') {
        outcomeHtml = `
          <div class="outcome-grid">
            <div class="outcome-item">
              <span class="outcome-label">Tip Target:</span>
              <span class="outcome-val pill-purple">${parsed.percentile || '50th'} percentile</span>
            </div>
            <div class="outcome-item">
              <span class="outcome-label">Multiplier:</span>
              <span class="outcome-val pill-blue">${parsed.multiplier ? parsed.multiplier + 'x' : '1.0x'}</span>
            </div>
          </div>
        `;
      } else if (decision.decisionType === 'SUBMISSION_TIMING') {
        const actionClass = parsed.action === 'submit' ? 'pill-green' : 'pill-amber';
        outcomeHtml = `
          <div class="outcome-grid">
            <div class="outcome-item">
              <span class="outcome-label">Action:</span>
              <span class="outcome-val ${actionClass}">${(parsed.action || 'submit').toUpperCase()}</span>
            </div>
            <div class="outcome-item">
              <span class="outcome-label">Delay:</span>
              <span class="outcome-val pill-gray">${parsed.delayMs !== undefined ? parsed.delayMs + 'ms' : '0ms'}</span>
            </div>
          </div>
        `;
      } else if (decision.decisionType === 'RETRY_ANALYSIS') {
        const retryClass = parsed.shouldRetry ? 'pill-green' : 'pill-red';
        const retryLabel = parsed.shouldRetry ? 'YES' : 'NO';
        outcomeHtml = `
          <div class="outcome-grid">
            <div class="outcome-item">
              <span class="outcome-label">Should Retry:</span>
              <span class="outcome-val ${retryClass}">${retryLabel}</span>
            </div>
            <div class="outcome-item">
              <span class="outcome-label">Adjusted Tip:</span>
              <span class="outcome-val pill-purple">${parsed.adjustedTipPercentile || '50th'} percentile</span>
            </div>
            <div class="outcome-item">
              <span class="outcome-label">Multiplier:</span>
              <span class="outcome-val pill-blue">${parsed.adjustedTipMultiplier ? parsed.adjustedTipMultiplier + 'x' : '1.0x'}</span>
            </div>
          </div>
        `;
      } else {
        outcomeHtml = `<pre class="raw-json">${JSON.stringify(parsed, null, 2)}</pre>`;
      }
    } catch (e) {
      outcomeHtml = `<span class="raw-text">${decision.outputDecision}</span>`;
    }

    card.innerHTML = `
      <div class="decision-header">
        <span class="decision-type">${decision.decisionType}</span>
        <span class="decision-time">${timeStr}</span>
      </div>
      <div class="decision-reasoning">
        ${decision.reasoningChain}
      </div>
      <div class="decision-outcome">
        ${outcomeHtml}
      </div>
    `;

    aiDecisionFeed.prepend(card);
  }

  function updateSummaryStats() {
    activeTxCountEl.innerText = `${activeSignatures.size} tracking`;
    
    // Compute stats
    const failedCount = logs.filter(l => l.status === 'failed').length;
    const finishedCount = logs.filter(l => l.status === 'finalized' || l.status === 'failed').length;
    
    if (finishedCount > 0) {
      const rate = ((finishedCount - failedCount) / finishedCount * 100).toFixed(0);
      successRateEl.innerText = `${rate}%`;
    } else {
      successRateEl.innerText = '100%';
    }

    // Dynamic mock delta for presentation
    const baseDelta = 400 + Math.floor(Math.random() * 150);
    netHealthDeltaEl.innerText = `${baseDelta}ms`;
  }
})();
