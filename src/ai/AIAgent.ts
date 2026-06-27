import { FailureType, AIReasoningLog } from '../types';
import { logger } from '../utils/logger';
import { CONFIG } from '../config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export class AIAgent {
  private logFilePath: string;

  constructor() {
    const logDir = 'logs';
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    this.logFilePath = path.join(logDir, 'ai-decisions.json');
    this.initializeLogFile();
  }

  private initializeLogFile(): void {
    if (!fs.existsSync(this.logFilePath)) {
      fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2));
    }
  }

  /**
   * AI Decision 1: Failure Reasoning & Retry Strategy
   */
  public async analyzeFailureAndDecideRetry(
    signature: string,
    failureType: FailureType,
    errorDetails: string,
    retryCount: number
  ): Promise<{ shouldRetry: boolean; adjustedTipPercentile: '25th' | '50th' | '75th' | '95th' | '99th'; adjustedTipMultiplier: number; reason: string }> {
    
    const context = { signature, failureType, errorDetails, retryCount };
    let reasoning = '';
    let decision = {
      shouldRetry: true,
      adjustedTipPercentile: '50th' as '25th' | '50th' | '75th' | '95th' | '99th',
      adjustedTipMultiplier: 1.0,
      reason: ''
    };

    if (retryCount >= 3) {
      reasoning = `Transaction ${signature} has already been retried ${retryCount} times. Max retry budget exceeded to avoid draining funds. Stopping execution.`;
      decision = { shouldRetry: false, adjustedTipPercentile: '50th', adjustedTipMultiplier: 1.0, reason: reasoning };
    } else if (failureType === 'EXPIRED_BLOCKHASH') {
      reasoning = `Detected blockhash expiry. This typically occurs under heavy network load or slot skips. Decision: refresh blockhash immediately, elevate tip percentile to 75th to increase priority in the next Jito block, and resubmit.`;
      decision = { shouldRetry: true, adjustedTipPercentile: '75th', adjustedTipMultiplier: 1.2, reason: reasoning };
    } else if (failureType === 'FEE_TOO_LOW') {
      reasoning = `Transaction failed due to insufficient prioritisation fees. Current tip floor is rising. Decision: escalate tip to 95th percentile with a 1.5x multiplier to guarantee entry in the upcoming Jito auction slot.`;
      decision = { shouldRetry: true, adjustedTipPercentile: '95th', adjustedTipMultiplier: 1.5, reason: reasoning };
    } else if (failureType === 'SLOT_SKIP') {
      reasoning = `Leader skipped slot. The bundle was dropped before processing. This is a network timing issue, not a fee issue. Decision: retry immediately with the same fee levels (50th percentile) targeting the next leader window.`;
      decision = { shouldRetry: true, adjustedTipPercentile: '50th', adjustedTipMultiplier: 1.0, reason: reasoning };
    } else {
      reasoning = `Encountered custom or simulation error: ${errorDetails}. Re-verifying conditions. Decision: retry with 75th percentile tip and 1.1x multiplier.`;
      decision = { shouldRetry: true, adjustedTipPercentile: '75th', adjustedTipMultiplier: 1.1, reason: reasoning };
    }

    if (CONFIG.AI_PROVIDER !== 'mock') {
      try {
        const llmDecision = await this.queryLLM('RETRY_ANALYSIS', context, reasoning);
        if (llmDecision) {
          decision = llmDecision;
          reasoning = llmDecision.reason;
        }
      } catch (e: any) {
        logger.warn(`${CONFIG.AI_PROVIDER} retry analysis LLM call failed: ${e.message}`);
      }
    }

    this.logDecision('RETRY_ANALYSIS', context, reasoning, decision);
    return decision;
  }

  /**
   * AI Decision 2: Tip Intelligence
   */
  public async decideTipAmount(
    recentStats: any,
    currentCongestion: 'low' | 'medium' | 'high'
  ): Promise<{ percentile: '25th' | '50th' | '75th' | '95th' | '99th'; multiplier: number; reason: string }> {
    const context = { recentStats, currentCongestion };
    let reasoning = '';
    let decision = {
      percentile: '50th' as '25th' | '50th' | '75th' | '95th' | '99th',
      multiplier: 1.0,
      reason: ''
    };

    if (currentCongestion === 'high') {
      reasoning = `Network congestion is HIGH. Standard 50th percentile tips are likely to be outbid in the Jito Block Engine auction. Upgrading tip recommendation to 95th percentile with 1.3x multiplier to ensure slot inclusion.`;
      decision = { percentile: '95th', multiplier: 1.3, reason: reasoning };
    } else if (currentCongestion === 'medium') {
      reasoning = `Network congestion is MEDIUM. Raising tip recommendation to 75th percentile with 1.1x multiplier to balance landing probability and cost.`;
      decision = { percentile: '75th', multiplier: 1.1, reason: reasoning };
    } else {
      reasoning = `Network conditions are healthy (low congestion). Standard 50th percentile tip with 1.0x multiplier is sufficient to win bundle bids.`;
      decision = { percentile: '50th', multiplier: 1.0, reason: reasoning };
    }

    if (CONFIG.AI_PROVIDER !== 'mock') {
      try {
        const llmDecision = await this.queryLLM('TIP_SELECTION', context, reasoning);
        if (llmDecision) {
          decision = llmDecision;
          reasoning = llmDecision.reason;
        }
      } catch (e: any) {
        logger.warn(`${CONFIG.AI_PROVIDER} tip selection LLM call failed: ${e.message}`);
      }
    }

    this.logDecision('TIP_SELECTION', context, reasoning, decision);
    return decision;
  }

  /**
   * AI Decision 3: Submission Timing
   */
  public async decideSubmissionTiming(
    currentSlot: number,
    jitoLeaderSlotDistance: number
  ): Promise<{ action: 'submit' | 'hold'; delayMs: number; reason: string }> {
    const context = { currentSlot, jitoLeaderSlotDistance };
    let reasoning = '';
    let decision = {
      action: 'submit' as 'submit' | 'hold',
      delayMs: 0,
      reason: ''
    };

    if (jitoLeaderSlotDistance > 8) {
      reasoning = `Next Jito leader window is too far away (${jitoLeaderSlotDistance} slots). Submitting now will result in transaction/blockhash expiration before the block is produced. Decision: HOLD bundle submission.`;
      decision = { action: 'hold', delayMs: 400 * (jitoLeaderSlotDistance - 4), reason: reasoning };
    } else {
      reasoning = `Jito leader window is close (${jitoLeaderSlotDistance} slots). Ideal timing for ingestion. Decision: SUBMIT bundle immediately.`;
      decision = { action: 'submit', delayMs: 0, reason: reasoning };
    }

    if (CONFIG.AI_PROVIDER !== 'mock') {
      try {
        const llmDecision = await this.queryLLM('SUBMISSION_TIMING', context, reasoning);
        if (llmDecision) {
          decision = llmDecision;
          reasoning = llmDecision.reason;
        }
      } catch (e: any) {
        logger.warn(`${CONFIG.AI_PROVIDER} submission timing LLM call failed: ${e.message}`);
      }
    }

    this.logDecision('SUBMISSION_TIMING', context, reasoning, decision);
    return decision;
  }

  private async queryLLM(
    decisionType: 'RETRY_ANALYSIS' | 'TIP_SELECTION' | 'SUBMISSION_TIMING',
    context: any,
    fallbackReason: string
  ): Promise<any> {
    const provider = CONFIG.AI_PROVIDER.toLowerCase();

    if (provider === 'gemini' && CONFIG.GEMINI_API_KEY) {
      return await this.callGeminiAPI(decisionType, context, fallbackReason);
    } else if (provider === 'openai' && CONFIG.OPENAI_API_KEY) {
      return await this.callOpenaiAPI(decisionType, context, fallbackReason);
    } else if (provider === 'anthropic' && CONFIG.ANTHROPIC_API_KEY) {
      return await this.callAnthropicAPI(decisionType, context, fallbackReason);
    }

    return this.generateMockLLMResponse(decisionType, context, fallbackReason);
  }

  private async callGeminiAPI(decisionType: string, context: any, fallbackReason: string): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    
    const systemPrompt = this.getSystemPrompt(decisionType);
    const userPrompt = `Context JSON: ${JSON.stringify(context)}\nFallback Reasoning: ${fallbackReason}`;

    const body = {
      contents: [{
        parts: [
          { text: `${systemPrompt}\n\nUser Context:\n${userPrompt}` }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 5000
    });

    if (!res.ok) {
      throw new Error(`Gemini API returned status ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("No text candidate returned from Gemini.");
    }

    return JSON.parse(text);
  }

  private async callOpenaiAPI(decisionType: string, context: any, fallbackReason: string): Promise<any> {
    const url = 'https://api.openai.com/v1/chat/completions';
    const systemPrompt = this.getSystemPrompt(decisionType);
    const userPrompt = `Context JSON: ${JSON.stringify(context)}\nFallback Reasoning: ${fallbackReason}`;

    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body),
      timeout: 5000
    });

    if (!res.ok) {
      throw new Error(`OpenAI API returned status ${res.status}`);
    }

    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("No text returned from OpenAI.");
    }

    return JSON.parse(text);
  }

  private async callAnthropicAPI(decisionType: string, context: any, fallbackReason: string): Promise<any> {
    const url = 'https://api.anthropic.com/v1/messages';
    const systemPrompt = this.getSystemPrompt(decisionType);
    const userPrompt = `Context JSON: ${JSON.stringify(context)}\nFallback Reasoning: ${fallbackReason}`;

    const body = {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt }
      ]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      timeout: 5000
    });

    if (!res.ok) {
      throw new Error(`Anthropic API returned status ${res.status}`);
    }

    const data: any = await res.json();
    const text = data.content?.[0]?.text;
    if (!text) {
      throw new Error("No text returned from Anthropic.");
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  }

  private getSystemPrompt(decisionType: string): string {
    if (decisionType === 'RETRY_ANALYSIS') {
      return `You are the AI Decision Engine of a Solana Smart Transaction Stack. 
Your task is to analyze a failed transaction bundle and decide if it should be retried and how tip settings should be adjusted.
Input context contains: signature, failureType, errorDetails, retryCount.
You must respond with raw JSON matching this TypeScript interface:
{
  "shouldRetry": boolean,
  "adjustedTipPercentile": "25th" | "50th" | "75th" | "95th" | "99th",
  "adjustedTipMultiplier": number (a float between 1.0 and 2.0),
  "reason": "a detailed string explaining why you made this retry decision and tip adjustment"
}`;
    } else if (decisionType === 'TIP_SELECTION') {
      return `You are the AI Decision Engine of a Solana Smart Transaction Stack.
Your task is to analyze Jito block engine tip statistics and network congestion level to recommend the optimal tip percentile and multiplier.
Input context contains: recentStats, currentCongestion.
You must respond with raw JSON matching this TypeScript interface:
{
  "percentile": "25th" | "50th" | "75th" | "95th" | "99th",
  "multiplier": number (a float between 1.0 and 2.0),
  "reason": "a detailed string explaining how you balanced landing probability against cost"
}`;
    } else {
      return `You are the AI Decision Engine of a Solana Smart Transaction Stack.
Your task is to analyze slot progression and Jito leader scheduling to decide whether to submit a bundle immediately or hold it.
Input context contains: currentSlot, jitoLeaderSlotDistance.
You must respond with raw JSON matching this TypeScript interface:
{
  "action": "submit" | "hold",
  "delayMs": number (delay in milliseconds to hold, e.g. 0 to 2000),
  "reason": "a detailed string explaining slot alignment and timing decision"
}`;
    }
  }

  private generateMockLLMResponse(decisionType: string, context: any, fallbackReason: string): any {
    const providerLabel = `[${CONFIG.AI_PROVIDER.toUpperCase()} - Simulated Reasoning]`;
    
    if (decisionType === 'RETRY_ANALYSIS') {
      let percentile: '25th' | '50th' | '75th' | '95th' | '99th' = '75th';
      let multiplier = 1.2;
      let shouldRetry = true;

      if (context.retryCount >= 3) {
        shouldRetry = false;
        percentile = '50th';
        multiplier = 1.0;
      } else if (context.failureType === 'FEE_TOO_LOW') {
        percentile = '95th';
        multiplier = 1.5;
      } else if (context.failureType === 'SLOT_SKIP') {
        percentile = '50th';
        multiplier = 1.0;
      }

      return {
        shouldRetry,
        adjustedTipPercentile: percentile,
        adjustedTipMultiplier: multiplier,
        reason: `${providerLabel} Verified error type: ${context.failureType}. Internal logic confirms: ${fallbackReason}. Rebuilding with fresh confirmed blockhash.`
      };
    } else if (decisionType === 'TIP_SELECTION') {
      let percentile: '25th' | '50th' | '75th' | '95th' | '99th' = '50th';
      let multiplier = 1.0;

      if (context.currentCongestion === 'high') {
        percentile = '95th';
        multiplier = 1.3;
      } else if (context.currentCongestion === 'medium') {
        percentile = '75th';
        multiplier = 1.1;
      }

      return {
        percentile,
        multiplier,
        reason: `${providerLabel} Analysing live slot updates and tip accounts. Network congestion is ${context.currentCongestion.toUpperCase()}. Tip floor set to ${percentile} with a ${multiplier}x safety margin.`
      };
    } else {
      let action: 'submit' | 'hold' = 'submit';
      let delayMs = 0;

      if (context.jitoLeaderSlotDistance > 8) {
        action = 'hold';
        delayMs = 400 * (context.jitoLeaderSlotDistance - 4);
      }

      return {
        action,
        delayMs,
        reason: `${providerLabel} Checked upcoming validator slot schedules. Jito leader is ${context.jitoLeaderSlotDistance} slots away. Recommendation: ${action.toUpperCase()} (delay: ${delayMs}ms).`
      };
    }
  }

  private logDecision(
    decisionType: 'TIP_SELECTION' | 'SUBMISSION_TIMING' | 'RETRY_ANALYSIS',
    inputContext: any,
    reasoningChain: string,
    outputDecision: any
  ): void {
    try {
      const fileContent = fs.readFileSync(this.logFilePath, 'utf-8');
      const logs: AIReasoningLog[] = JSON.parse(fileContent);

      const entry: AIReasoningLog = {
        timestamp: Date.now(),
        decisionType,
        inputContext,
        reasoningChain,
        outputDecision
      };

      logs.push(entry);
      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));
      logger.info(`AI Agent Decision Logged: ${decisionType} - ${reasoningChain.substring(0, 60)}...`);
      this.emitDecisionEvent(entry);
    } catch (err: any) {
      logger.error(`Failed to log AI decision: ${err.message}`);
    }
  }

  private emitDecisionEvent(log: AIReasoningLog): void {
    if ((global as any).dashboardWsServer) {
      (global as any).dashboardWsServer.broadcast({
        type: 'ai-decision',
        data: log
      });
    }
  }

  public getDecisions(): AIReasoningLog[] {
    try {
      const fileContent = fs.readFileSync(this.logFilePath, 'utf-8');
      return JSON.parse(fileContent);
    } catch {
      return [];
    }
  }
}
export const aiAgent = new AIAgent();
