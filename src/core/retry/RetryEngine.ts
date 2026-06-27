import { lifecycleTracker } from '../lifecycle/LifecycleTracker';
import { lifecycleLogger } from '../lifecycle/LifecycleLogger';
import { aiAgent } from '../../ai/AIAgent';
import { blockhashManager } from './BlockhashManager';
import { tipCalculator } from '../bundle/TipCalculator';
import { bundleBuilder } from '../bundle/BundleBuilder';
import { bundleSubmitter } from '../bundle/BundleSubmitter';
import { logger } from '../../utils/logger';
import { TransactionLifecycleState } from '../../types';
const bs58 = require('bs58');


export class RetryEngine {
  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    lifecycleTracker.on('failed', async (failedState: TransactionLifecycleState) => {
      logger.info(`RetryEngine caught failed transaction: ${failedState.signature}. Initiating AI analysis...`);
      await this.handleFailureAndRetry(failedState);
    });
  }

  private async handleFailureAndRetry(failedState: TransactionLifecycleState): Promise<void> {
    try {
      const retryCount = failedState.retryCount + 1;
      
      // 1. Let AI Agent analyze the failure and decide strategy
      const decision = await aiAgent.analyzeFailureAndDecideRetry(
        failedState.signature,
        failedState.failureReason || 'UNKNOWN',
        failedState.failureDetails || 'No details provided',
        failedState.retryCount
      );

      logger.info(`AI Agent Recommendation for ${failedState.signature}: Retry=${decision.shouldRetry}, Reason: ${decision.reason}`);

      if (!decision.shouldRetry) {
        logger.info(`AI decided to terminate retries for transaction ${failedState.signature}.`);
        lifecycleLogger.logState({
          ...failedState,
          status: 'failed'
        });
        return;
      }

      // 2. Fetch fresh blockhash (Always confirmed, never finalized)
      const freshBlockhash = await blockhashManager.getLatestBlockhash();

      // 3. Compute dynamic tip with AI-adjusted multipliers
      const baseTip = await tipCalculator.getDynamicTipLamports(decision.adjustedTipPercentile);
      const adjustedTip = Math.floor(baseTip * decision.adjustedTipMultiplier);
      logger.info(`Original Tip: ${baseTip} lamports. AI Adjusted Tip: ${adjustedTip} lamports (${decision.adjustedTipPercentile} * ${decision.adjustedTipMultiplier})`);

      // 4. Rebuild the bundle
      const transaction = bundleBuilder.buildTransactionWithTip(freshBlockhash, adjustedTip);
      const newSignature = bs58.encode(transaction.signatures[0]); // unique key for simulator/tracking

      // 5. Register the new retry transaction in lifecycleTracker
      lifecycleTracker.registerTransaction(
        newSignature,
        failedState.bundleId || 'retry-bundle',
        adjustedTip,
        `${decision.adjustedTipPercentile} (AI Adjusted)`
      );

      // Fetch the newly registered state to update its retry count
      const activeTransactions = lifecycleTracker.getActiveTransactions();
      const newState = activeTransactions.find(t => t.signature === newSignature);
      if (newState) {
        newState.retryCount = retryCount;
      }

      // Log the old failed state with the fact it was retried
      lifecycleLogger.logState({
        ...failedState,
        status: 'failed',
        failureDetails: `${failedState.failureDetails} | Retried under signature ${newSignature}`
      });

      // 6. Submit the new bundle
      const bundleId = await bundleSubmitter.submitBundle(transaction);
      logger.info(`Resubmitted retry bundle successfully. Signature: ${newSignature}, Bundle ID: ${bundleId}`);
      
    } catch (err: any) {
      logger.error(`RetryEngine failed to execute retry flow: ${err.message}`);
    }
  }
}
export const retryEngine = new RetryEngine();
