import { slotStream } from './core/stream/SlotStreamManager';
import { transactionStream } from './core/stream/TransactionStreamManager';
import { dashboardServer } from './monitoring/DashboardServer';
import { retryEngine } from './core/retry/RetryEngine';
import { blockhashManager } from './core/retry/BlockhashManager';
import { tipCalculator } from './core/bundle/TipCalculator';
import { bundleBuilder } from './core/bundle/BundleBuilder';
import { bundleSubmitter } from './core/bundle/BundleSubmitter';
import { aiAgent } from './ai/AIAgent';
import { logger } from './utils/logger';
import { CONFIG } from './config';
const bs58 = require('bs58');


async function startStack() {
  logger.info('===========================================================');
  logger.info('🤖 Starting Smart Transaction Stack Ingestion Engine...');
  logger.info('===========================================================');

  // 1. Initialize streams
  await slotStream.start();
  await transactionStream.start();

  // 2. Initialize retry engine listener hooks
  // This instantiates retryEngine and hooks failed transaction events
  const _engine = retryEngine;

  // 3. Start web server dashboard
  dashboardServer.start();

  // 4. Submission loop for demo & logging purposes (10+ logs requirement)
  let submissionCount = 0;
  
  // Wait a moment for slot stream to populate initial data
  setTimeout(async () => {
    logger.info('Starting transaction submission loop...');
    runSubmissionCycle();
    
    // Run every 15 seconds to generate required logs automatically in the background
    setInterval(() => runSubmissionCycle(false), 15000);
  }, 3000);

  async function runSubmissionCycle(forceExpired = false) {
    submissionCount++;
    logger.info(`-----------------------------------------------------------`);
    logger.info(`Submission Cycle #${submissionCount}`);
    logger.info(`-----------------------------------------------------------`);

    try {
      const currentSlot = slotStream.getCurrentSlot() || 260000000;
      
      // AI Decision 1: Timing
      // Simulate leader schedule details
      const distanceToNextJitoLeader = Math.floor(Math.random() * 5) + 1; // 1 to 5 slots
      const timingDecision = await aiAgent.decideSubmissionTiming(currentSlot, distanceToNextJitoLeader);
      logger.info(`AI Submission Timing: ${timingDecision.action.toUpperCase()}. Reason: ${timingDecision.reason}`);

      if (timingDecision.action === 'hold') {
        logger.info(`Holding transaction for ${timingDecision.delayMs}ms as advised by AI Agent.`);
        await new Promise(r => setTimeout(r, timingDecision.delayMs));
      }

      // AI Decision 2: Tip Intelligence
      const recentStats = await tipCalculator.getRecentTipFloor();
      const congestionLevel = submissionCount % 4 === 0 ? 'high' : (submissionCount % 3 === 0 ? 'medium' : 'low');
      const tipDecision = await aiAgent.decideTipAmount(recentStats, congestionLevel as any);
      logger.info(`AI Tip Decision: ${tipDecision.percentile} percentile with ${tipDecision.multiplier}x multiplier. Reason: ${tipDecision.reason}`);

      // Calculate dynamic tip based on AI recommendations
      const baseTip = await tipCalculator.getDynamicTipLamports(tipDecision.percentile);
      const finalTip = Math.floor(baseTip * tipDecision.multiplier);

      // Construct transaction
      let transaction;
      let isExpiredTest = forceExpired;

      // Fault Injection Test: Every 5th transaction OR if forced by fault injection control
      if (forceExpired || (submissionCount % 5 === 0)) {
        isExpiredTest = true;
        logger.warn(`!!! [Fault Injection] Creating a transaction with stale expired blockhash to test AI recovery...`);
        transaction = bundleBuilder.buildExpiredTransaction(finalTip);
      } else {
        const freshBlockhash = await blockhashManager.getLatestBlockhash();
        transaction = bundleBuilder.buildTransactionWithTip(freshBlockhash, finalTip);
      }

      const signature = bs58.encode(transaction.signatures[0]);
      
      // Register in Tracker
      lifecycleTracker.registerTransaction(
        signature,
        `bundle-${submissionCount}`,
        finalTip,
        `${tipDecision.percentile} (AI Choice)`,
        isExpiredTest
      );

      // Submit Bundle
      const bundleId = await bundleSubmitter.submitBundle(transaction);
      logger.info(`Bundle submitted. Bundle ID: ${bundleId}`);

    } catch (err: any) {
      logger.error(`Error in submission cycle: ${err.message}`);
    }
  }

  // Register global hooks for Dashboard Server API control
  (global as any).triggerManualSubmission = async (forceExpired = false) => {
    logger.info(`[Control Panel] Manual submission triggered (forceExpired = ${forceExpired})`);
    await runSubmissionCycle(forceExpired);
  };

  (global as any).toggleSimulationMode = (enabled: boolean) => {
    CONFIG.SIMULATE_TRANSACTIONS = enabled;
    logger.info(`[Control Panel] Simulation Mode toggled to: ${enabled}`);
    // Broadcast status update to all connected dashboard websockets
    if ((global as any).dashboardWsServer) {
      (global as any).dashboardWsServer.broadcast({
        type: 'config-update',
        data: {
          simulateTransactions: CONFIG.SIMULATE_TRANSACTIONS,
          aiProvider: CONFIG.AI_PROVIDER
        }
      });
    }
  };

  (global as any).updateAIProvider = (provider: string) => {
    CONFIG.AI_PROVIDER = provider;
    logger.info(`[Control Panel] AI Provider updated to: ${provider}`);
    // Broadcast status update to all connected dashboard websockets
    if ((global as any).dashboardWsServer) {
      (global as any).dashboardWsServer.broadcast({
        type: 'config-update',
        data: {
          simulateTransactions: CONFIG.SIMULATE_TRANSACTIONS,
          aiProvider: CONFIG.AI_PROVIDER
        }
      });
    }
  };
}

// Helper to keep references clean
import { lifecycleTracker } from './core/lifecycle/LifecycleTracker';

startStack().catch((err) => {
  logger.error(`Fatal crash starting stack: ${err.message}`);
});
