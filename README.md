# Solana Smart Transaction Stack

An advanced, production-ready transaction ingestion and submission infrastructure for Solana. Powering transactions with Jito bundles, Yellowstone gRPC stream tracking, and an autonomous AI agent decision engine.

Includes a live real-time dashboard displaying slot heights, transaction states, network latency, and AI agent reasoning chains.

---

## 1. Features & Differentiators

- **Yellowstone gRPC streaming**: Subscribes to live slots and transaction status updates (PROCESSED, CONFIRMED, FINALIZED) to track consensus in real-time, falling back to Web3 WebSockets.
- **Dynamic Jito Tip Estimation**: Queries recent tip floors via Jito block engine endpoints to calculate percentile-based tips, with no hardcoded values.
- **AI Agent Orchestrator**: Implements all 4 AI operational roles:
  1. *Failure Reasoning*: Diagnoses why a bundle failed (slippage, fee, hash) and adjusts parameters.
  2. *Tip Intelligence*: Adjusts tips depending on real-time network congestion.
  3. *Submission Timing*: Calculates slot distances to upcoming Jito leaders and holds bundles when needed.
  4. *Autonomous Expiry Recovery*: Detects blockhash expiration, fetches a fresh confirmed blockhash, recalculates tips, and resubmits autonomously.
- **Visual dashboard**: A premium glassmorphism dark-themed dashboard showing live transaction lifecycle bars and AI reasoning logs.
- **Simulation Harness**: Toggle simulated transaction states for easy testing and verification without requiring a funded Solana mainnet wallet.

---

## 2. System Architecture

For a detailed view of data flows, sequences, and class structures, see the [ARCHITECTURE.md](docs/ARCHITECTURE.md) document.

```
+------------------+     +------------------------+     +-------------------+
| Yellowstone gRPC | --> |  Slot & Tx Stream Mgr  | --> |  Lifecycle Tracker|
|  / WS Fallbacks  |     |   (Real-time Streams)  |     |  (Time & States)  |
+------------------+     +------------------------+     +-------------------+
                                                                  |
                                                                  v
+------------------+     +------------------------+     +-------------------+
|  Jito Block Eng  | <-- |  Bundle Builder/Sub   | <-- |   Retry Engine    |
| (Bundle Submission)    | (Dynamic Tip & Hash)   |     |   & AI Agent      |
+------------------+     +------------------------+     +-------------------+
```

---

## 3. Setup & Installation

### Dependencies
- [Node.js](https://nodejs.org) (v18 or higher)
- npm

### Installation
1. Clone the project and navigate to the directory:
   ```bash
   npm install
   ```

2. Copy the environment variables template and configure your values:
   ```bash
   cp .env.example .env
   ```
   *Note: If no private key or RPC endpoint is provided, the stack runs in simulated mainnet mode automatically.*

3. Start the application:
   ```bash
   npm run dev
   ```

4. Open the monitoring dashboard:
   Open your browser and navigate to `http://localhost:3000`.

---

## 4. Bounty README Questions

### Question 1: What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?

**Answer:**
The delta between `processed_at` and `confirmed_at` represents the time required for a supermajority (2/3+) of the Solana cluster's stake to vote on and confirm the block containing your transaction.

- **Healthy Network (< 500ms)**: Indicates validators are processing blocks quickly, vote propagation is fast, consensus is reached without fork churn, and network bandwidth is uninhibited.
- **Congested/Unhealthy Network (> 1.5s)**: Signals validator issues, block propagation latency, high fork contention, or network partitions. In this scenario, validators take longer to build consensus, which increases the likelihood of transaction drop and requires higher priority fees or Jito tips to secure prompt block insertion.

### Question 2: Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?

**Answer:**
Solana blockhashes are valid for **150 slots** (~1 minute). When fetching a blockhash at `finalized` commitment:
1. **Implicit Slot Age**: Finalized commitment means at least 31 blocks have been built on top of the block where the blockhash was created. This means the blockhash you receive is already **32 slots (~12-13 seconds) old** at the moment of retrieval.
2. **Reduced Lifetime Window**: Using a finalized blockhash shrinks your transaction's validity window from 150 slots to ~118 slots. 
3. **High Expiry Risk**: Under network congestion, Jito bundles, or time-sensitive arbitrage, every slot is critical. An aged blockhash is highly prone to being flagged as `BlockhashNotFound` or expiring before it reaches the leader's banking stage. 
4. **Best Practice**: Use `confirmed` commitment. This guarantees you get a fresh blockhash that has reached supermajority vote (usually <1 second old), giving you the maximum remaining slot window (~148 slots) while guaranteeing block safety.

### Question 3: What happens to your bundle if the Jito leader skips their slot?

**Answer:**
If the Jito validator scheduled to produce the block skips their slot:
1. **The Bundle is Dropped**: Jito bundles can only be processed and executed by validators running the Jito-Solana client. If the leader skips the slot, the block is not produced, and all bundles queued for that slot are discarded.
2. **No Forwarding**: Unlike normal transactions, which are forwarded to subsequent leaders in the schedule, Jito bundles are not forwarded. The bundle is immediately dropped by the Jito Block Engine.
3. **Loss of Atomicity**: Since the bundle fails, none of the transactions inside execute. 
4. **Mitigation Strategy**: The ingestion stack must detect the slot skip via slot streams, refresh the blockhash (using `confirmed` commitment), recalculate the dynamic Jito tip floor, and resubmit the bundle to the next scheduled Jito leader window.
