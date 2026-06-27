import { Connection } from '@solana/web3.js';
import { CONFIG } from '../../config';
import { CommitmentLevel } from '../../types';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';
import { bundleBuilder } from '../bundle/BundleBuilder';
const bs58 = require('bs58');

let Client: any = null;
try {
  Client = require('@triton-one/yellowstone-grpc').default;
} catch (e: any) {
  // Silent warning since SlotStreamManager already outputs it
}

export class TransactionStreamManager extends EventEmitter {
  private connection: Connection;
  private grpcClient: any = null;
  private trackedSignatures = new Set<string>();

  constructor() {
    super();
    this.connection = new Connection(CONFIG.SOLANA_RPC_URL, {
      wsEndpoint: CONFIG.SOLANA_WS_URL
    });

    if (CONFIG.YELLOWSTONE_GRPC_URL && Client) {
      this.grpcClient = new Client(
        CONFIG.YELLOWSTONE_GRPC_URL,
        CONFIG.YELLOWSTONE_GRPC_TOKEN,
        undefined
      );
    }
  }

  public trackSignature(signature: string): void {
    logger.info(`Tracking signature for real-time lifecycle: ${signature}`);
    this.trackedSignatures.add(signature);
    
    // Always start fallback standard listeners in parallel to ensure reliability
    this.trackViaWebSocket(signature);
  }

  private trackViaWebSocket(signature: string): void {
    // Processed level
    this.connection.onSignatureWithOptions(
      signature,
      (notification: any, context: any) => {
        if (notification.err) {
          this.emit('failure', { signature, err: notification.err });
        } else {
          this.emit('status', {
            signature,
            commitment: CommitmentLevel.PROCESSED,
            slot: context.slot,
            timestamp: Date.now()
          });
        }
      },
      { commitment: 'processed' }
    );

    // Confirmed level
    this.connection.onSignatureWithOptions(
      signature,
      (notification: any, context: any) => {
        if (!notification.err) {
          this.emit('status', {
            signature,
            commitment: CommitmentLevel.CONFIRMED,
            slot: context.slot,
            timestamp: Date.now()
          });
        }
      },
      { commitment: 'confirmed' }
    );

    // Finalized level
    this.connection.onSignatureWithOptions(
      signature,
      (notification: any, context: any) => {
        if (!notification.err) {
          this.emit('status', {
            signature,
            commitment: CommitmentLevel.FINALIZED,
            slot: context.slot,
            timestamp: Date.now()
          });
          // Stop tracking once finalized
          this.trackedSignatures.delete(signature);
        }
      },
      { commitment: 'finalized' }
    );
  }

  public async start(): Promise<void> {
    if (this.grpcClient) {
      try {
        await this.connectGrpc();
      } catch (err: any) {
        logger.error(`Transaction gRPC connection failed: ${err.message}. Using WebSocket fallbacks.`);
      }
    }
  }

  private async connectGrpc(): Promise<void> {
    if (!this.grpcClient) return;

    const stream = await this.grpcClient.subscribe();
    const walletAddress = bundleBuilder.getPayerPublicKey().toBase58();
    logger.info(`Subscribing to Yellowstone gRPC transaction updates for account: ${walletAddress}`);
    
    const request = {
      transactions: {
        "wallet-tx-sub": {
          vote: false,
          failed: false,
          accountInclude: [walletAddress]
        }
      },
      commitment: 0, // PROCESSED in protobuf
      accounts: {},
      slots: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: []
    };

    stream.write(request);

    stream.on('data', (data: any) => {
      if (data.transaction) {
        const sigBytes = data.transaction.transaction.signature;
        if (sigBytes) {
          const sig = bs58.encode(Buffer.from(sigBytes));
          if (this.trackedSignatures.has(sig)) {
            const slot = Number(data.transaction.slot);
            const meta = data.transaction.transaction.meta;
            const err = meta ? meta.err : null;
            
            if (err) {
              this.emit('failure', { signature: sig, err });
            } else {
              this.emit('status', {
                signature: sig,
                commitment: CommitmentLevel.PROCESSED,
                slot,
                timestamp: Date.now()
              });
            }
          }
        }
      }
    });

    stream.on('error', (err: any) => {
      logger.error(`Transaction gRPC stream error: ${err.message}`);
    });
  }
}
export const transactionStream = new TransactionStreamManager();
