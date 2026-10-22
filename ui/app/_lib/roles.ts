import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from './paths';
import { AgentId, AGENTS } from './agents';
import { rolesGetAll, rolesReplaceAll } from './db';

export type RolesMap = Record<string, AgentId>;

export type RolesResult = {
  roles: RolesMap;
  error: string | null;
};

const DEFAULT_ROLES: RolesMap = {
  "lead": "claude-code",
  "architect": "codex",
  "backend": "claude-code",
  "frontend": "cursor",
  "reviewer": "opencode",
  "qa": "vscode-insiders"
};

export async function getRoles(): Promise<RolesResult> {
  let fromDb = rolesGetAll();
  if (Object.keys(fromDb).length) return { roles: fromDb as RolesMap, error: null };

  // Migrate from file
  const filePath = path.join(getDataDir(), 'roles.json');
  let errorMsg: string | null = null;
  const mergedRoles: RolesMap = { ...DEFAULT_ROLES };
  const validAgentIds = new Set<string>(AGENTS.map(a => a.id));

  try {
    await fs.mkdir(getDataDir(), { recursive: true });
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [role, agentId] of Object.entries(parsed)) {
          if (typeof agentId === 'string' && validAgentIds.has(agentId)) {
            mergedRoles[role] = agentId as AgentId;
          }
        }
      }
    }
  } catch (e: any) {
    errorMsg = `roles.json syntax error: ${e?.message || 'invalid JSON'}. Using defaults.`;
  }

  rolesReplaceAll(mergedRoles);
  return { roles: mergedRoles, error: errorMsg };
}
