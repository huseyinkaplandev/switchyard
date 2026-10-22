import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function numbers(field, max, label) {
  if (!/^\d+(,\d+)*$/.test(field)) throw new Error(`Unsupported ${label}: ${field}. Use numeric lists.`);
  const values = [...new Set(field.split(',').map(Number))];
  if (values.some(n => n < 0 || n > max)) throw new Error(`Invalid ${label}: ${field}`);
  return values;
}

export function cronToRrule(cron) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Expected a recurring five-field cron schedule');
  const [minute, hour, day, month, weekday] = fields;
  if (day !== '*' || month !== '*') throw new Error('Day-of-month and month restrictions are not supported');
  const minutes = numbers(minute, 59, 'minutes');
  const hours = numbers(hour, 23, 'hours');
  const days = weekday === '*' ? null : numbers(weekday, 7, 'weekdays');
  const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  return `${days ? `FREQ=WEEKLY;BYDAY=${[...new Set(days.map(n => names[n]))].join(',')}` : 'FREQ=DAILY'};BYHOUR=${hours.join(',')};BYMINUTE=${minutes.join(',')};BYSECOND=0`;
}

/** First prompt line of every copied task; it is how a later copy finds and updates the same automation. */
export function sourceMarker(task) {
  return `Copied from: claude:${task.account}:${task.id}`;
}

/**
 * Claude task prompts can name Claude-only tools. The copy keeps the work itself and tells Codex how to read
 * the rest; it never invents capabilities the destination lacks.
 */
export function adaptClaudePrompt(task) {
  if (!task.prompt?.trim()) throw new Error(`Prompt missing: ${task.id}`);
  const body = task.prompt.replace(/\(Claude\)/g, '(Codex)');
  return [
    sourceMarker(task),
    `Local Codex scheduled task. Working directory: ${task.workingDirectory || '~'}. Change to this directory first.`,
    'Adaptation rules: the local AGENTS.md and current user rules take precedence. Where the prompt below names Claude models or Claude-only tools, use the current Codex model and the closest available Codex tool, or skip that step and say so in the run summary. Do not repeat work that another agent already finished. Report only meaningful changes, results, errors or required user actions.',
    '',
    body,
  ].join('\n');
}

function tomlValue(text, key) {
  const match = text.match(new RegExp(`^${key} = ("(?:[^"\\\\]|\\\\.)*")\\s*$`, 'm'));
  return match ? JSON.parse(match[1]) : '';
}

/**
 * @param {Array<{ id: string; source: string; platform: string; account: string; name: string; schedule: string; enabled: boolean; prompt: string; workingDirectory?: string }>} tasks
 * @param {{ home: string; codexHome?: string; model?: string; reasoningEffort?: string }} options
 */
export async function copyClaudeSchedules(tasks, { home, codexHome = path.join(home, '.codex'), model, reasoningEffort }) {
  // Validate the complete batch before writing any target.
  const prepared = tasks.map(task => {
    if (task.source !== 'claude' || task.platform !== (process.platform === 'darwin' ? 'macos' : 'windows')) throw new Error('Only local Claude tasks can be copied');
    if (!/^[a-zA-Z0-9_-]+$/.test(task.id)) throw new Error('Invalid source task id');
    return { task, prompt: adaptClaudePrompt(task), rrule: cronToRrule(task.schedule) };
  });
  const root = path.join(codexHome, 'automations');
  await fs.mkdir(root, { recursive: true });
  const existing = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
    try {
      const text = await fs.readFile(path.join(root, entry.name, 'automation.toml'), 'utf8');
      existing.push({ id: entry.name, text, prompt: tomlValue(text, 'prompt') });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const results = [];
  for (const { task, prompt, rrule } of prepared) {
    const found = existing.find(item => item.prompt.split('\n')[0] === sourceMarker(task));
    const digest = crypto.createHash('sha256').update(`${task.account}:${task.id}`).digest('hex').slice(0, 10);
    const id = found?.id || `claude-${digest}-${task.id}`;
    const directory = path.join(root, id);
    const file = path.join(directory, 'automation.toml');
    await fs.mkdir(directory, { recursive: true });
    const previous = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (!found && previous) throw new Error(`Target already exists without matching source: ${id}`);
    const now = Date.now();
    const name = `${task.name.replace(/\s*\(Claude\)/g, '')} (Codex)`;
    let text;
    if (previous) {
      // Preserve native project bindings, model choices, history and creation time.
      text = previous;
      for (const [key, value] of Object.entries({ name, prompt, rrule, status: task.enabled ? 'ACTIVE' : 'PAUSED' })) {
        text = text.replace(new RegExp(`^${key} = .*`, 'm'), () => `${key} = ${JSON.stringify(value)}`);
      }
      text = text.replace(/^updated_at = .*/m, `updated_at = ${now}`);
    } else {
      text = [
        'version = 1', `id = ${JSON.stringify(id)}`, 'kind = "cron"',
        `name = ${JSON.stringify(name)}`, `prompt = ${JSON.stringify(prompt)}`,
        `status = "${task.enabled ? 'ACTIVE' : 'PAUSED'}"`, `rrule = ${JSON.stringify(rrule)}`,
        ...(model ? [`model = ${JSON.stringify(model)}`] : []),
        ...(reasoningEffort ? [`reasoning_effort = ${JSON.stringify(reasoningEffort)}`] : []),
        'execution_environment = "local"', 'target = { type = "projectless" }',
        `cwds = [${JSON.stringify(task.workingDirectory || home)}]`, `created_at = ${now}`, `updated_at = ${now}`, '',
      ].join('\n');
    }
    if (previous) {
      const backup = path.join(codexHome, 'schedule-transfer-backups', `${now}-${crypto.randomUUID()}`);
      await fs.mkdir(backup, { recursive: true });
      await fs.writeFile(path.join(backup, `${id}.toml`), previous, { flag: 'wx' });
    }
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, text, { flag: 'wx' }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
    const saved = await fs.readFile(file, 'utf8');
    if (tomlValue(saved, 'prompt') !== prompt || tomlValue(saved, 'rrule') !== rrule || tomlValue(saved, 'status') !== (task.enabled ? 'ACTIVE' : 'PAUSED')) throw new Error(`Verification failed: ${id}`);
    results.push({ sourceId: task.id, id, name, rrule, enabled: task.enabled, updated: !!previous, verified: true });
  }
  return { copied: results.length, verified: true, tasks: results };
}
