import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  
  // Solana Config
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  SOLANA_WS_URL: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
  
  // Yellowstone gRPC Config
  YELLOWSTONE_GRPC_URL: process.env.YELLOWSTONE_GRPC_URL || '',
  YELLOWSTONE_GRPC_TOKEN: process.env.YELLOWSTONE_GRPC_TOKEN || '',
  
  // Jito Block Engine Config
  JITO_BLOCK_ENGINE_URL: process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf',
  
  // Wallet Config (Falls back to a random keypair if not provided, for testing)
  SENDER_PRIVATE_KEY: process.env.SENDER_PRIVATE_KEY || '',
  
  // AI Config
  AI_PROVIDER: process.env.AI_PROVIDER || 'mock', // 'openai' | 'anthropic' | 'gemini' | 'mock'
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  
  // Simulator Mode (Set to true if you want to run simulated transaction lifecycles for testing/verification)
  SIMULATE_TRANSACTIONS: process.env.SIMULATE_TRANSACTIONS !== 'false',
};

export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiY8m2oh8',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2o2J7Z5pKOaLaRVcuyor6z',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];
