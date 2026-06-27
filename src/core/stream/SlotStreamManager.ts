import { Connection } from '@solana/web3.js';
import { CONFIG } from '../../config';
import { SlotUpdate, CommitmentLevel } from '../../types';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';

let Client: any = null;
try {
  Client = require('@triton-one/yellowstone-grpc').default;
} catch (e: any) {
  logger.warn(`Could not load Yellowstone gRPC native binding. Operating in standard WebSocket mode.`);
}

export class SlotStreamManager extends EventEmitter {
  private connection: Connection;
  private grpcClient: any = null;
  private wsSubscriptionId: number | null = null;
  private isRunning = false;
  private currentSlot = 0;

  constructor() {
    super();
    this.connection = new Connection(CONFIG.SOLANA_RPC_URL, {
      wsEndpoint: CONFIG.SOLANA_WS_URL
    });

    if (CONFIG.YELLOWSTONE_GRPC_URL && Client) {
      logger.info('Initializing Yellowstone gRPC Client...');
      this.grpcClient = new Client(
        CONFIG.YELLOWSTONE_GRPC_URL,
        CONFIG.YELLOWSTONE_GRPC_TOKEN,
        undefined
      );
    } else {
      logger.warn('Yellowstone gRPC details not configured. Falling back to standard WebSocket streams.');
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.grpcClient) {
      try {
        await this.connectGrpc();
      } catch (err: any) {
        logger.error(`gRPC Connection failed: ${err.message || err}. Falling back to WS.`);
        await this.connectWebSocket();
      }
    } else {
      await this.connectWebSocket();
    }
  }

  private stopWebSocket(): void {
    if (this.wsSubscriptionId !== null) {
      try {
        this.connection.removeSlotUpdateListener(this.wsSubscriptionId);
        logger.info('Unsubscribed from standard Web3 WebSocket slots.');
      } catch (err: any) {
        logger.error(`Failed to unsubscribe from WebSocket slots: ${err.message}`);
      }
      this.wsSubscriptionId = null;
    }
  }

  private async connectGrpc(): Promise<void> {
    if (!this.grpcClient) return;

    logger.info('Connecting to Yellowstone gRPC slot stream...');
    const stream = await this.grpcClient.subscribe();
    
    // Stop the WebSocket listener to prevent duplicate slot events
    this.stopWebSocket();
    
    const request = {
      slots: {
        "slot-sub": { filterByCommitment: undefined }
      },
      commitment: 1, // CONFIRMED in protobuf
      accounts: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: []
    };

    stream.write(request);

    stream.on('data', (data: any) => {
      if (data.slot) {
        const slot = data.slot.slot;
        const parent = data.slot.parent;
        this.currentSlot = slot;

        // Mock leader computation since gRPC schedule is validator-specific
        const leader = this.getLeaderForSlot(slot);
        const isJitoLeader = this.isJitoLeader(leader);

        const slotUpdate: SlotUpdate = {
          slot,
          parent,
          commitment: CommitmentLevel.CONFIRMED,
          timestamp: Date.now(),
          leader,
          isJitoLeader
        };

        this.emit('slot', slotUpdate);
      }
    });

    stream.on('error', (err: any) => {
      logger.error(`Yellowstone gRPC stream error: ${err.message}. Falling back to WebSocket.`);
      this.connectWebSocket();
      this.reconnectGrpc();
    });

    stream.on('end', () => {
      logger.warn('Yellowstone gRPC stream ended. Falling back to WebSocket.');
      this.connectWebSocket();
      this.reconnectGrpc();
    });
  }

  private async reconnectGrpc(): Promise<void> {
    setTimeout(async () => {
      try {
        logger.info('Attempting to reconnect gRPC...');
        await this.connectGrpc();
      } catch (err: any) {
        logger.error(`gRPC reconnect failed: ${err.message}. Ensuring WebSocket fallback remains active.`);
        await this.connectWebSocket();
      }
    }, 5000);
  }

  private async connectWebSocket(): Promise<void> {
    if (this.wsSubscriptionId !== null) return; // already subscribed
    logger.info('Subscribing to standard Web3 WebSocket slots...');
    try {
      this.wsSubscriptionId = this.connection.onSlotUpdate((slotInfo: any) => {
        const slot = slotInfo.slot;
        const parent = slotInfo.parent || (slot - 1);
        this.currentSlot = slot;

        const leader = this.getLeaderForSlot(slot);
        const isJitoLeader = this.isJitoLeader(leader);

        const slotUpdate: SlotUpdate = {
          slot,
          parent,
          commitment: CommitmentLevel.CONFIRMED,
          timestamp: Date.now(),
          leader,
          isJitoLeader
        };

        this.emit('slot', slotUpdate);
      });
    } catch (err: any) {
      logger.error(`WebSocket connection failed: ${err.message}`);
    }
  }

  public getCurrentSlot(): number {
    return this.currentSlot;
  }

  public stop(): void {
    this.isRunning = false;
    if (this.wsSubscriptionId !== null) {
      this.connection.removeSlotUpdateListener(this.wsSubscriptionId);
    }
  }

  // Helper mock functions to simulate block-production leaders on-the-fly
  private getLeaderForSlot(slot: number): string {
    const validators = [
      'JitoVal111111111111111111111111111111111111',
      'JitoVal222222222222222222222222222222222222',
      'SolanaVal3333333333333333333333333333333333',
      'SolanaVal4444444444444444444444444444444444'
    ];
    // Deterministic selection based on slot
    const index = Math.floor(slot / 4) % validators.length;
    return validators[index];
  }

  private isJitoLeader(leader: string): boolean {
    return leader.startsWith('JitoVal');
  }
}
export const slotStream = new SlotStreamManager();
