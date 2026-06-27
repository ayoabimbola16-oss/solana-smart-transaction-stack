export enum CommitmentLevel {
  PROCESSED = 'processed',
  CONFIRMED = 'confirmed',
  FINALIZED = 'finalized'
}

export interface SlotUpdate {
  slot: number;
  parent: number;
  commitment: CommitmentLevel;
  timestamp: number;
  leader?: string;
  isJitoLeader?: boolean;
}

export type FailureType = 
  | 'EXPIRED_BLOCKHASH'
  | 'FEE_TOO_LOW'
  | 'COMPUTE_EXCEEDED'
  | 'BUNDLE_DROPPED'
  | 'SLOT_SKIP'
  | 'SIMULATION_ERROR'
  | 'UNKNOWN';

export interface TransactionLifecycleState {
  signature: string;
  bundleId?: string;
  submittedAt: number;
  submittedSlot: number;
  processedAt?: number;
  processedSlot?: number;
  confirmedAt?: number;
  confirmedSlot?: number;
  finalizedAt?: number;
  finalizedSlot?: number;
  status: 'submitted' | 'processed' | 'confirmed' | 'finalized' | 'failed';
  tipAmountLamports: number;
  tipPercentileSelected: string;
  failureReason?: FailureType;
  failureDetails?: string;
  retryCount: number;
}

export interface AIReasoningLog {
  timestamp: number;
  decisionType: 'TIP_SELECTION' | 'SUBMISSION_TIMING' | 'RETRY_ANALYSIS';
  inputContext: any;
  reasoningChain: string;
  outputDecision: any;
}
