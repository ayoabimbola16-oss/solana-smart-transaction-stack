import { Connection } from '@solana/web3.js';
import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';

export class BlockhashManager {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(CONFIG.SOLANA_RPC_URL);
  }

  /**
   * Fetches the latest blockhash.
   * CRITICAL: Uses 'confirmed' commitment level as recommended for time-sensitive transactions.
   * Never use 'finalized' as it yields a blockhash that is already ~32 slots (~12-13s) old.
   */
  public async getLatestBlockhash(): Promise<string> {
    if (CONFIG.SIMULATE_TRANSACTIONS) {
      const mockBlockhash = this.generateMockBlockhash();
      logger.info(`[Simulator] Generated mock confirmed blockhash: ${mockBlockhash}`);
      return mockBlockhash;
    }

    try {
      // Fetch latest blockhash at confirmed level
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      logger.info(`Fetched fresh confirmed blockhash: ${blockhash}`);
      return blockhash;
    } catch (err: any) {
      logger.error(`Failed to fetch blockhash: ${err.message}. Generating mock fallback.`);
      return this.generateMockBlockhash();
    }
  }

  private generateMockBlockhash(): string {
    // Generate a valid 32-byte buffer and encode to base58
    // @solana/web3.js requires blockhash to decode to exactly 32 bytes
    const crypto = require('crypto');
    const bytes = crypto.randomBytes(32);
    const bs58 = require('bs58');
    return bs58.encode(bytes);
  }
}
export const blockhashManager = new BlockhashManager();
