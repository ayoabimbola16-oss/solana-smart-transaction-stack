import { FailureType } from '../../types';

export class FailureClassifier {
  public static classify(errorMsg: string): FailureType {
    const msg = errorMsg.toUpperCase();
    
    if (msg.includes('BLOCKHASH') || msg.includes('EXPIRED')) {
      return 'EXPIRED_BLOCKHASH';
    }
    
    if (msg.includes('FEE_TOO_LOW') || msg.includes('INSUFFICIENT_PRIORITY') || msg.includes('PRIORITY_FEE')) {
      return 'FEE_TOO_LOW';
    }
    
    if (msg.includes('COMPUTE') || msg.includes('BUDGET') || msg.includes('COMPUTE LIMIT EXCEEDED')) {
      return 'COMPUTE_EXCEEDED';
    }
    
    if (msg.includes('DROPPED') || msg.includes('BUNDLE_DROPPED') || msg.includes('WINNING_BATCH_REJECTED')) {
      return 'BUNDLE_DROPPED';
    }

    if (msg.includes('SKIP') || msg.includes('LEADER_SKIP') || msg.includes('SLOT_SKIP')) {
      return 'SLOT_SKIP';
    }

    if (msg.includes('SIMULATION') || msg.includes('INSTRUCTION_ERROR') || msg.includes('CUSTOM')) {
      return 'SIMULATION_ERROR';
    }

    return 'UNKNOWN';
  }
}
export const failureClassifier = FailureClassifier;
