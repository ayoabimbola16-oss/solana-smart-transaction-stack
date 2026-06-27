import fs from 'fs';
import path from 'path';
import { TransactionLifecycleState } from '../../types';
import { logger } from '../../utils/logger';

export class LifecycleLogger {
  private logFilePath: string;

  constructor() {
    const logDir = 'logs';
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    this.logFilePath = path.join(logDir, 'lifecycle-log.json');
    this.initializeLogFile();
  }

  private initializeLogFile(): void {
    if (!fs.existsSync(this.logFilePath)) {
      fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2));
    }
  }

  public logState(state: TransactionLifecycleState): void {
    try {
      const fileContent = fs.readFileSync(this.logFilePath, 'utf-8');
      const logs: any[] = JSON.parse(fileContent);

      // Calculate latency deltas
      const processedDelta = state.processedAt ? state.processedAt - state.submittedAt : null;
      const confirmedDelta = state.processedAt && state.confirmedAt ? state.confirmedAt - state.processedAt : null;
      const totalDelta = state.finalizedAt ? state.finalizedAt - state.submittedAt : null;

      const logEntry = {
        signature: state.signature,
        bundleId: state.bundleId,
        status: state.status,
        tipAmountLamports: state.tipAmountLamports,
        tipPercentileSelected: state.tipPercentileSelected,
        timestamps: {
          submitted: new Date(state.submittedAt).toISOString(),
          processed: state.processedAt ? new Date(state.processedAt).toISOString() : null,
          confirmed: state.confirmedAt ? new Date(state.confirmedAt).toISOString() : null,
          finalized: state.finalizedAt ? new Date(state.finalizedAt).toISOString() : null
        },
        slots: {
          submitted: state.submittedSlot,
          processed: state.processedSlot || null,
          confirmed: state.confirmedSlot || null,
          finalized: state.finalizedSlot || null
        },
        deltas: {
          submitted_to_processed_ms: processedDelta,
          processed_to_confirmed_ms: confirmedDelta,
          total_lifecycle_ms: totalDelta
        },
        failure: state.status === 'failed' ? {
          type: state.failureReason,
          details: state.failureDetails
        } : null,
        retryCount: state.retryCount
      };

      // Upsert entry based on signature
      const index = logs.findIndex((l) => l.signature === state.signature);
      if (index !== -1) {
        logs[index] = logEntry;
      } else {
        logs.push(logEntry);
      }

      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));
      logger.info(`Saved transaction state to ${this.logFilePath}`);
    } catch (err: any) {
      logger.error(`Failed to write lifecycle log: ${err.message}`);
    }
  }

  public getLogs(): any[] {
    try {
      const fileContent = fs.readFileSync(this.logFilePath, 'utf-8');
      return JSON.parse(fileContent);
    } catch {
      return [];
    }
  }
}
export const lifecycleLogger = new LifecycleLogger();
