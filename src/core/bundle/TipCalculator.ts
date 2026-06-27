import fetch from 'node-fetch';
import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';

export interface JitoTipStats {
  landed_tips_25th_percentile: number;
  landed_tips_50th_percentile: number;
  landed_tips_75th_percentile: number;
  landed_tips_95th_percentile: number;
  landed_tips_99th_percentile: number;
}

export class TipCalculator {
  private blockEngineUrl: string;

  constructor() {
    this.blockEngineUrl = CONFIG.JITO_BLOCK_ENGINE_URL;
  }

  public async getRecentTipFloor(): Promise<JitoTipStats> {
    try {
      const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 5000
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const body = await response.json();
      const stats = Array.isArray(body) ? body[0] : body;

      if (stats && stats.landed_tips_50th_percentile !== undefined) {
        return {
          landed_tips_25th_percentile: stats.landed_tips_25th_percentile || 0.00001,
          landed_tips_50th_percentile: stats.landed_tips_50th_percentile || 0.00005,
          landed_tips_75th_percentile: stats.landed_tips_75th_percentile || 0.0001,
          landed_tips_95th_percentile: stats.landed_tips_95th_percentile || 0.0005,
          landed_tips_99th_percentile: stats.landed_tips_99th_percentile || stats.landed_tips_95th_percentile * 1.5 || 0.001
        };
      }

      throw new Error('Invalid tip statistics format returned from Jito API.');
    } catch (err: any) {
      logger.warn(`Failed to fetch live Jito tip floor: ${err.message}. Using dynamic fallback tip estimates.`);
      // Dynamic fallback that fluctuates based on time/simulated congestion
      const timeFactor = Math.sin(Date.now() / 60000) * 0.0001; // oscillates
      const baseTip = 0.0002; // SOL
      const estimate = baseTip + Math.max(0, timeFactor);

      return {
        landed_tips_25th_percentile: estimate * 0.5,
        landed_tips_50th_percentile: estimate,
        landed_tips_75th_percentile: estimate * 1.5,
        landed_tips_95th_percentile: estimate * 3.0,
        landed_tips_99th_percentile: estimate * 5.0
      };
    }
  }

  public async getDynamicTipLamports(percentile: '25th' | '50th' | '75th' | '95th' | '99th' = '50th'): Promise<number> {
    const stats = await this.getRecentTipFloor();
    let tipSol = stats.landed_tips_50th_percentile;

    if (percentile === '25th') tipSol = stats.landed_tips_25th_percentile;
    else if (percentile === '75th') tipSol = stats.landed_tips_75th_percentile;
    else if (percentile === '95th') tipSol = stats.landed_tips_95th_percentile;
    else if (percentile === '99th') tipSol = stats.landed_tips_99th_percentile;

    const lamports = Math.floor(tipSol * 1e9);
    // Return at least Jito's absolute floor limit of 1000 lamports
    return Math.max(lamports, 1000);
  }
}
export const tipCalculator = new TipCalculator();
