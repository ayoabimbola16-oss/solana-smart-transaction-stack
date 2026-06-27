import { VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';
import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';

export class BundleSubmitter {
  private blockEngineUrl: string;

  constructor() {
    this.blockEngineUrl = CONFIG.JITO_BLOCK_ENGINE_URL;
  }

  public async getTipAccounts(): Promise<string[]> {
    try {
      const response = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTipAccounts',
          params: []
        }),
        timeout: 5000
      });
      const data: any = await response.json();
      return data.result || [];
    } catch (err: any) {
      logger.warn(`Failed to fetch Jito tip accounts: ${err.message}. Using fallback tip accounts.`);
      return [
        '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
        'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiY8m2oh8',
        'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'
      ];
    }
  }

  public async submitBundle(transaction: VersionedTransaction): Promise<string> {
    const serializedTx = Buffer.from(transaction.serialize()).toString('base64');
    
    // In simulator mode, skip Jito call and return a mock signature/bundleId
    if (CONFIG.SIMULATE_TRANSACTIONS) {
      const mockSignature = this.generateMockSignature();
      logger.info(`[Simulator] Mocking bundle submission. Signature: ${mockSignature}`);
      return mockSignature;
    }

    try {
      const response = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [[serializedTx], { encoding: 'base64' }]
        }),
        timeout: 5000
      });

      const body = await response.json();
      if (body.error) {
        throw new Error(JSON.stringify(body.error));
      }

      const bundleId = body.result;
      logger.info(`Bundle successfully submitted to Jito. Bundle ID: ${bundleId}`);
      return bundleId;
    } catch (err: any) {
      logger.error(`Error submitting bundle to Jito: ${err.message}`);
      throw err;
    }
  }

  public async getBundleStatus(bundleId: string): Promise<'Landed' | 'Failed' | 'Pending' | 'Unknown'> {
    if (CONFIG.SIMULATE_TRANSACTIONS) {
      return 'Landed'; // Simulator handles status transitions via Slot stream
    }

    try {
      const response = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getInflightBundleStatuses',
          params: [[bundleId]]
        }),
        timeout: 5000
      });
      const data: any = await response.json();
      if (data.result && data.result.value && data.result.value.length > 0) {
        const status = data.result.value[0].status;
        return status; // 'Landed', 'Failed', 'Pending'
      }
      return 'Unknown';
    } catch (err: any) {
      logger.warn(`Failed to check bundle status: ${err.message}`);
      return 'Unknown';
    }
  }

  private generateMockSignature(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
export const bundleSubmitter = new BundleSubmitter();
