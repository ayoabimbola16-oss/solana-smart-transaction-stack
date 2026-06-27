import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { lifecycleTracker } from '../core/lifecycle/LifecycleTracker';
import { lifecycleLogger } from '../core/lifecycle/LifecycleLogger';
import { aiAgent } from '../ai/AIAgent';
import { slotStream } from '../core/stream/SlotStreamManager';

export class DashboardServer {
  private app: express.Express;
  private server: http.Server;
  private wss: WebSocketServer;

  constructor() {
    this.app = express();
    // Add json parsing middleware for API configuration post requests
    this.app.use(express.json());
    
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    
    // Set global reference for AIAgent log notifications
    (global as any).dashboardWsServer = this;

    this.setupRoutes();
    this.setupSockets();
    this.setupLifecycleHooks();
  }

  private setupRoutes(): void {
    const dashboardPath = path.join(__dirname, '../../dashboard');
    this.app.use(express.static(dashboardPath));

    // Fallback index.html
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(dashboardPath, 'index.html'));
    });

    // API endpoints
    this.app.get('/api/logs', (req, res) => {
      res.json(lifecycleLogger.getLogs());
    });

    this.app.get('/api/ai-decisions', (req, res) => {
      res.json(aiAgent.getDecisions());
    });

    this.app.get('/api/config', (req, res) => {
      res.json({
        simulateTransactions: CONFIG.SIMULATE_TRANSACTIONS,
        aiProvider: CONFIG.AI_PROVIDER,
        hasGeminiKey: !!CONFIG.GEMINI_API_KEY,
        hasOpenaiKey: !!CONFIG.OPENAI_API_KEY,
        hasAnthropicKey: !!CONFIG.ANTHROPIC_API_KEY
      });
    });

    this.app.post('/api/submit', async (req, res) => {
      if ((global as any).triggerManualSubmission) {
        try {
          await (global as any).triggerManualSubmission(false);
          res.json({ success: true, message: 'Manual submission triggered' });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      } else {
        res.status(500).json({ success: false, error: 'Engine not fully initialized' });
      }
    });

    this.app.post('/api/inject-fault', async (req, res) => {
      if ((global as any).triggerManualSubmission) {
        try {
          await (global as any).triggerManualSubmission(true);
          res.json({ success: true, message: 'Fault injection triggered' });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      } else {
        res.status(500).json({ success: false, error: 'Engine not fully initialized' });
      }
    });

    this.app.post('/api/toggle-simulation', (req, res) => {
      const { enabled } = req.body || {};
      const targetState = enabled === undefined ? !CONFIG.SIMULATE_TRANSACTIONS : !!enabled;
      
      if ((global as any).toggleSimulationMode) {
        (global as any).toggleSimulationMode(targetState);
      } else {
        CONFIG.SIMULATE_TRANSACTIONS = targetState;
      }
      
      res.json({ success: true, simulateTransactions: CONFIG.SIMULATE_TRANSACTIONS });
    });

    this.app.post('/api/update-ai-provider', (req, res) => {
      const { provider } = req.body || {};
      if (provider) {
        if ((global as any).updateAIProvider) {
          (global as any).updateAIProvider(provider);
        } else {
          CONFIG.AI_PROVIDER = provider;
        }
        res.json({ success: true, provider: CONFIG.AI_PROVIDER });
      } else {
        res.status(400).json({ success: false, error: 'Provider not specified' });
      }
    });

    this.app.get('/api/export-logs', (req, res) => {
      const logs = lifecycleLogger.getLogs();
      const decisions = aiAgent.getDecisions();
      
      const formatted = {
        title: "Solana Smart Transaction Stack - Telemetry Export",
        timestamp: new Date().toISOString(),
        totalSubmissions: logs.length,
        logs: logs.slice(-20),
        aiDecisions: decisions.slice(-20)
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=telemetry-export.json');
      res.send(JSON.stringify(formatted, null, 2));
    });
  }

  private setupSockets(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('Dashboard client connected via WebSockets.');
      
      // Send initial states
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          logs: lifecycleLogger.getLogs(),
          decisions: aiAgent.getDecisions(),
          currentSlot: slotStream.getCurrentSlot(),
          config: {
            simulateTransactions: CONFIG.SIMULATE_TRANSACTIONS,
            aiProvider: CONFIG.AI_PROVIDER
          }
        }
      }));

      ws.on('error', (err) => {
        logger.error(`WebSocket client error: ${err.message}`);
      });
    });
  }

  private setupLifecycleHooks(): void {
    const broadcastStateChange = (type: string, state: any) => {
      this.broadcast({
        type,
        data: state
      });
    };

    lifecycleTracker.on('registered', (state) => {
      broadcastStateChange('tx-registered', state);
      lifecycleLogger.logState(state);
    });

    lifecycleTracker.on('processed', (state) => {
      broadcastStateChange('tx-processed', state);
      lifecycleLogger.logState(state);
    });

    lifecycleTracker.on('confirmed', (state) => {
      broadcastStateChange('tx-confirmed', state);
      lifecycleLogger.logState(state);
    });

    lifecycleTracker.on('finalized', (state) => {
      broadcastStateChange('tx-finalized', state);
      lifecycleLogger.logState(state);
    });

    lifecycleTracker.on('failed', (state) => {
      broadcastStateChange('tx-failed', state);
      lifecycleLogger.logState(state);
    });

    slotStream.on('slot', (slotUpdate) => {
      this.broadcast({
        type: 'slot-update',
        data: slotUpdate
      });
    });
  }

  public broadcast(message: { type: string; data: any }): void {
    const payload = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  public start(): void {
    this.server.listen(CONFIG.PORT, () => {
      logger.info(`===========================================================`);
      logger.info(`🚀 Smart Transaction Dashboard running at http://localhost:${CONFIG.PORT}`);
      logger.info(`===========================================================`);
    });
  }
}
export const dashboardServer = new DashboardServer();
