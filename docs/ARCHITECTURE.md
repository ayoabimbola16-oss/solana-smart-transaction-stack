# Solana Smart Transaction Stack — System Architecture

This document describes the high-level system architecture, component breakdowns, data flows, and design decisions for the **Solana Smart Transaction Stack** submission.

---

## 1. System Overview

The stack is a modular, high-throughput transaction submission engine designed to construct Jito bundles, track transaction lifecycles in real-time using Yellowstone gRPC streaming, and apply artificial intelligence to operational decisions.

```mermaid
graph TD
    subgraph Stream Infrastructure
        gRPC[Yellowstone gRPC Stream]
        WS[Standard WS Web3 Fallback]
        StreamReconnector[Reconnector & Queue]
    end

    subgraph Core Transaction Stack
        SlotStream[SlotStreamManager]
        TxStream[TransactionStreamManager]
        BundleBuilder[BundleBuilder]
        BundleSubmitter[BundleSubmitter]
        TipCalculator[TipCalculator]
        LifecycleTracker[LifecycleTracker]
        LifecycleLogger[LifecycleLogger]
        RetryEngine[RetryEngine]
        BlockhashManager[BlockhashManager]
    end

    subgraph AI Decision Layer
        AIAgent[AI Agent Orchestrator]
        TipIntel[Tip Intelligence]
        TimingIntel[Submission Timing]
        ReasoningEngine[Failure Reasoning & Expiry Recovery]
    end

    subgraph Monitoring & Visualization
        Server[Express & WebSocket Server]
        UI[Glassmorphism Dashboard UI]
    end

    %% Connections
    gRPC --> StreamReconnector
    WS --> StreamReconnector
    StreamReconnector --> SlotStream
    StreamReconnector --> TxStream

    SlotStream --> TimingIntel
    TipCalculator --> TipIntel
    
    TimingIntel --> AIAgent
    TipIntel --> AIAgent
    
    AIAgent --> BundleBuilder
    BundleBuilder --> BundleSubmitter
    BundleSubmitter --> LifecycleTracker
    
    TxStream --> LifecycleTracker
    LifecycleTracker --> LifecycleLogger
    LifecycleTracker --> RetryEngine
    
    RetryEngine --> ReasoningEngine
    ReasoningEngine --> AIAgent
    
    LifecycleTracker --> Server
    SlotStream --> Server
    AIAgent --> Server
    Server --> UI
```

---

## 2. Core Components

### A. Stream Infrastructure
- **`SlotStreamManager`**: Connects to the Yellowstone gRPC endpoint. Subscribes to slots at processed, confirmed, and finalized levels to track block progress and leader rotations. Falls back to standard WebSocket updates if gRPC is unavailable.
- **`TransactionStreamManager`**: Listens for transaction status confirmations. It monitors transaction commitment level changes (Submitted → Processed → Confirmed → Finalized) in real-time.

### B. Bundle Management
- **`TipCalculator`**: Dynamically queries the Jito block engine's `getTipFloor` RPC method to retrieve landed tip distribution percentiles.
- **`BundleBuilder`**: Assembles a `VersionedTransaction` and appends a transfer instruction targeting one of Jito's 8 public tip accounts.
- **`BundleSubmitter`**: Sends base64-encoded bundles to the block engine via JSON-RPC.

### C. Lifecycle & Recovery
- **`LifecycleTracker`**: Acts as an in-memory coordinator calculating delta times between execution phases.
- **`LifecycleLogger`**: Appends telemetry to a structured JSON file (`logs/lifecycle-log.json`).
- **`RetryEngine`**: Automatically retries dropped/failed transactions.
- **`BlockhashManager`**: Fetches blockhashes using `confirmed` commitment level to maximize remaining lifecycle.

### D. AI Decision Layer
- **`AIAgent`**: Orchestrates operational decisions.
  - **Timing Intelligence**: submission schedules based on Jito slot distance.
  - **Tip Intelligence**: Adjusts tip percentiles and multipliers based on congestion.
  - **Failure Reasoning & Recovery**: Inspects error types (e.g. `EXPIRED_BLOCKHASH`) to adjust gas/tip params and trigger autonomous refreshes and resubmissions.

---

## 3. Detailed Data Flow

### Normal Transaction Flow

```mermaid
sequenceDiagram
    participant B as BundleBuilder
    participant S as BundleSubmitter
    participant T as LifecycleTracker
    participant G as Yellowstone stream
    participant D as Dashboard

    B->>B: Query dynamic tip & blockhash
    B->>S: Construct & sign VersionedTransaction
    S->>S: Submit bundle to Block Engine
    S->>T: Register transaction signature
    T->>D: Broadcast tx-registered (Submitted)
    G->>T: Stream: Tx processed in slot X
    T->>D: Broadcast tx-processed
    G->>T: Stream: Block confirmed by consensus
    T->>D: Broadcast tx-confirmed
    G->>T: Stream: Block finalized (31+ slots on top)
    T->>D: Broadcast tx-finalized
```

### AI Failure Recovery Flow (Fault Injection)

```mermaid
sequenceDiagram
    participant T as LifecycleTracker
    participant R as RetryEngine
    participant AI as AI Agent
    participant BM as BlockhashManager
    participant B as BundleBuilder
    participant S as BundleSubmitter

    T->>T: Detect transaction failure (e.g. Expired Blockhash)
    T->>R: Trigger failed event
    R->>AI: analyzeFailureAndDecideRetry()
    AI->>AI: Reason about failure cause
    AI-->>R: Recommendation: Retry=true, Tip=75th, Multiplier=1.2
    R->>BM: getLatestBlockhash(confirmed)
    R->>B: Rebuild bundle (new blockhash, elevated tip)
    R->>T: Register new transaction signature
    R->>S: Resubmit bundle
```

---

## 4. Key Design Decisions

1. **Rule-Based Fallback for AI Reasoning**: To guarantee execution without API key errors, the AI agent carries a deterministic fallback decision engine that mimics LLM outputs.
2. **Mainnet-Simulation Hybrid**: To allow testing without burning real SOL on bundles, a toggle (`SIMULATE_TRANSACTIONS=true`) simulates slot progression and bundle landing while using production interfaces.
3. **Confirmed Commitment for Blockhash**: Fetches blockhashes using `confirmed` commitment. This guarantees that blockhashes have 150 slots of lifetime (minus network delay), avoiding the slot loss typical of `finalized` commitment.
