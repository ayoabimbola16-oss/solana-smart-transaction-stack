import { 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  TransactionMessage, 
  VersionedTransaction 
} from '@solana/web3.js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58');
import { CONFIG, JITO_TIP_ACCOUNTS } from '../../config';
import { logger } from '../../utils/logger';

export class BundleBuilder {
  private payer: Keypair;

  constructor() {
    if (CONFIG.SENDER_PRIVATE_KEY) {
      try {
        this.payer = Keypair.fromSecretKey(bs58.decode(CONFIG.SENDER_PRIVATE_KEY));
        logger.info(`Loaded wallet: ${this.payer.publicKey.toBase58()}`);
      } catch (err: any) {
        logger.error(`Failed to decode SENDER_PRIVATE_KEY: ${err.message}. Generating fallback random keypair.`);
        this.payer = Keypair.generate();
      }
    } else {
      logger.warn('No SENDER_PRIVATE_KEY provided. Generating random fallback keypair.');
      this.payer = Keypair.generate();
    }
  }

  public getPayerPublicKey(): PublicKey {
    return this.payer.publicKey;
  }

  public buildTransactionWithTip(
    blockhash: string,
    tipLamports: number,
    tipAccountStr?: string
  ): VersionedTransaction {
    // Select Jito tip account
    const tipAccountPubkey = new PublicKey(
      tipAccountStr || JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
    );

    // Build simple transfer transaction
    const transferIx = SystemProgram.transfer({
      fromPubkey: this.payer.publicKey,
      toPubkey: this.payer.publicKey,
      lamports: 1000 // minimal dust transfer to self
    });

    const tipIx = SystemProgram.transfer({
      fromPubkey: this.payer.publicKey,
      toPubkey: tipAccountPubkey,
      lamports: tipLamports
    });

    const message = new TransactionMessage({
      payerKey: this.payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [transferIx, tipIx] // tip is final instruction
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    transaction.sign([this.payer]);

    return transaction;
  }

  // Fault injection: build a transaction using a stale/invalid blockhash
  public buildExpiredTransaction(tipLamports: number): VersionedTransaction {
    // A deterministic but valid-format blockhash that is guaranteed to be expired.
    // This is a base58-encoded 32-byte zero buffer — structurally valid but always expired on-chain.
    const bs58Local = require('bs58');
    const staleBytes = Buffer.alloc(32, 0); // 32 zero bytes
    staleBytes[0] = 0xDE; staleBytes[1] = 0xAD; // mark it recognisable
    const staleBlockhash = bs58Local.encode(staleBytes);
    return this.buildTransactionWithTip(staleBlockhash, tipLamports);
  }
}
export const bundleBuilder = new BundleBuilder();
