import { EventEmitter } from 'events';
import { transactionStream } from '../stream/TransactionStreamManager';
import { slotStream } from '../stream/SlotStreamManager';
import { CommitmentLevel, TransactionLifecycleState, FailureType } from '../../types';
import { logger } from '../../utils/logger';
import { CONFIG } from '../../config';

import { failureClassifier } from './FailureClassifier';

export class LifecycleTracker extends EventEmitter {
  private activeTransactions = new Map<string, TransactionLifecycleState>();

  constructor() {
    super();
    this.setupListeners();
  }

  private setupListeners(): void {
    // Standard real-time transaction updates
    transactionStream.on('status', (data: { signature: string; commitment: CommitmentLevel; slot: number; timestamp: number }) => {
      this.updateState(data.signature, data.commitment, data.slot, data.timestamp);
    });

    transactionStream.on('failure', (data: { signature: string; err: any }) => {
      const errorStr = typeof data.err === 'string' ? data.err : JSON.stringify(data.err);
      const failureType = failureClassifier.classify(errorStr);
      this.handleFailure(data.signature, failureType, errorStr);
    });

    // Slot-based simulated progression for simulation mode
    slotStream.on('slot', (slotUpdate) => {
      if (CONFIG.SIMULATE_TRANSACTIONS) {
        this.processSimulatedSlot(slotUpdate.slot);
      }
    });
  }

  public registerTransaction(
    signature: string,
    bundleId: string,
    tipLamports: number,
    tipPercentileSelected: string,
    isExpiredTest = false
  ): void {
    const startSlot = slotStream.getCurrentSlot() || 260000000;
    
    const state: TransactionLifecycleState = {
      signature,
      bundleId,
      submittedAt: Date.now(),
      submittedSlot: startSlot,
      status: 'submitted',
      tipAmountLamports: tipLamports,
      tipPercentileSelected,
      retryCount: 0
    };

    if (isExpiredTest) {
      // Flag this so we simulate blockhash expiry failure
      (state as any).isExpiredTest = true;
    }

    this.activeTransactions.set(signature, state);
    
    if (!CONFIG.SIMULATE_TRANSACTIONS) {
      transactionStream.trackSignature(signature);
    }
    
    this.emit('registered', state);
  }

  private updateState(signature: string, commitment: CommitmentLevel, slot: number, timestamp: number): void {
    const state = this.activeTransactions.get(signature);
    if (!state) return;

    if (commitment === CommitmentLevel.PROCESSED && !state.processedAt) {
      state.processedAt = timestamp;
      state.processedSlot = slot;
      state.status = 'processed';
      logger.info(`Tx ${signature.substring(0, 8)}... processed at slot ${slot}`);
      this.emit('processed', state);
    } else if (commitment === CommitmentLevel.CONFIRMED && !state.confirmedAt) {
      state.confirmedAt = timestamp;
      state.confirmedSlot = slot;
      state.status = 'confirmed';
      logger.info(`Tx ${signature.substring(0, 8)}... confirmed at slot ${slot}`);
      this.emit('confirmed', state);
    } else if (commitment === CommitmentLevel.FINALIZED && !state.finalizedAt) {
      state.finalizedAt = timestamp;
      state.finalizedSlot = slot;
      state.status = 'finalized';
      logger.info(`Tx ${signature.substring(0, 8)}... finalized at slot ${slot}`);
      this.emit('finalized', state);
      this.activeTransactions.delete(signature); // Done tracking
    }
  }

  public handleFailure(signature: string, failureType: FailureType, details?: string): void {
    const state = this.activeTransactions.get(signature);
    if (!state) return;

    state.status = 'failed';
    state.failureReason = failureType;
    state.failureDetails = details;
    logger.warn(`Tx ${signature.substring(0, 8)}... FAILED. Type: ${failureType}, Details: ${details}`);
    this.emit('failed', state);
    this.activeTransactions.delete(signature);
  }

  private processSimulatedSlot(currentSlot: number): void {
    const now = Date.now();
    for (const [sig, state] of this.activeTransactions.entries()) {
      const slotDelta = currentSlot - state.submittedSlot;

      // Handle custom blockhash expiry test
      if ((state as any).isExpiredTest) {
        if (slotDelta >= 2) {
          this.handleFailure(sig, 'EXPIRED_BLOCKHASH', 'Blockhash is expired (simulated)');
        }
        continue;
      }

      // Handle normal transaction flow
      if (state.status === 'submitted' && slotDelta >= 1) {
        // Fast processing: lands in the next slot
        this.updateState(sig, CommitmentLevel.PROCESSED, currentSlot, now);
      } else if (state.status === 'processed' && slotDelta >= 3) {
        // Confirmed ~2 slots later
        this.updateState(sig, CommitmentLevel.CONFIRMED, currentSlot, now);
      } else if (state.status === 'confirmed' && slotDelta >= 32) {
        // Finalized ~31 slots later
        this.updateState(sig, CommitmentLevel.FINALIZED, currentSlot, now);
      }
    }
  }

  public getActiveTransactions(): TransactionLifecycleState[] {
    return Array.from(this.activeTransactions.values());
  }
}
export const lifecycleTracker = new LifecycleTracker();
