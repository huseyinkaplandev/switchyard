#!/usr/bin/env node
const endpoint = process.env.SWITCHYARD_SYNC_URL || 'http://127.0.0.1:3010/api/agent/sync';
const intervalMs = Number(process.env.SWITCHYARD_SYNC_INTERVAL_MS || 5000);

async function sync() {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as { imported?: number; updated?: number; skipped?: number };
    console.log(`[agent-sync] imported=${result.imported || 0} updated=${result.updated || 0} skipped=${result.skipped || 0}`);
  } catch (error) {
    console.log(`[agent-sync] waiting for Switchyard: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void sync();
setInterval(() => { void sync(); }, intervalMs);
