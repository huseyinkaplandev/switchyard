import {
  SYSTEM_AUTO_PROGRESS,
  SYSTEM_CHAT,
  SYSTEM_CLASSIFY,
  SYSTEM_DAILY_REPORT,
  SYSTEM_DONE_CHECK,
  SYSTEM_ENHANCE_TASK,
  SYSTEM_INSIGHTS,
  SYSTEM_SEARCH,
} from './prompts';

const NOTE = 'Demo mode: canned answer. Leave demo mode and run Ollama for a real one.';

/** Fixed replies for the local AI features in demo mode, in the JSON shape each route expects. */
export function demoAiReply(system: string | undefined, prompt: string): string {
  if (system === SYSTEM_CLASSIFY) {
    return JSON.stringify({ priority: 'high', suggestedAssignee: 'claude-code', suggestedRole: 'backend', reason: NOTE });
  }
  if (system === SYSTEM_DONE_CHECK) {
    return JSON.stringify({ isDone: false, confidence: 0.4, reason: NOTE });
  }
  if (system === SYSTEM_SEARCH) return '[]';
  if (system === SYSTEM_INSIGHTS) {
    return JSON.stringify([
      { type: 'summary', title: 'Checkout work is the bottleneck', content: 'Two of the three in-progress tasks touch the Acme storefront checkout. Both waited on the same failing payment webhook test this morning.', severity: 'warn', relatedTaskIds: ['TASK-0003', 'TASK-0005'] },
      { type: 'top_agents', title: 'Claude Code and Codex closed the most work', content: 'Claude Code finished the invoice export and Codex finished the flaky test fix. OpenCode picked up the docs pass after the usage-limit handoff.', severity: 'info', relatedTaskIds: ['TASK-0001', 'TASK-0002'] },
      { type: 'stuck_tasks', title: 'Rate limiter review has waited two days', content: 'TASK-0006 is in review with no log entry since Tuesday. Assign a reviewer or move it back to in progress.', severity: 'alert', relatedTaskIds: ['TASK-0006'] },
    ]);
  }
  if (system === SYSTEM_AUTO_PROGRESS) {
    return JSON.stringify({ updates: [{ taskId: 'TASK-0005', suggestedStatus: 'review', confidence: 0.82, reason: 'The log says the webhook retry fix is pushed and waiting for review.', sourceLogLine: 'backend/claude-code: TASK-0005 retry fix pushed, @qa please review' }], summary: NOTE });
  }
  if (system === SYSTEM_ENHANCE_TASK) {
    const title = prompt.match(/^Task title: (.*)$/m)?.[1]?.trim() || 'Untitled task';
    const body = prompt.split('Task description:\n')[1]?.split('\n\nImprove this task')[0]?.trim() || '';
    return JSON.stringify({
      enhancedTitle: title === '(no title)' ? 'Clarify the task goal' : title,
      enhancedBody: `## Goal\n${body || 'Describe the expected outcome.'}\n\n## Acceptance criteria\n- The change is covered by a test\n- The README or changelog mentions user-visible behaviour\n\n## Notes\n${NOTE}`,
      changes: ['Added a goal section', 'Added acceptance criteria'],
      summary: NOTE,
    });
  }
  if (system === SYSTEM_DAILY_REPORT) {
    return [
      '**Summary** - Steady day across the Acme projects. One usage-limit interruption was handed off from Claude Code to Codex without losing context.',
      '',
      '**Completed** - TASK-0001 invoice CSV export, TASK-0002 flaky date-picker test.',
      '',
      '**In progress** - TASK-0003 checkout redesign, TASK-0005 payment webhook retries.',
      '',
      '**Blockers and risks** - TASK-0006 rate limiter review has no reviewer.',
      '',
      '**Agent activity** - Claude Code: 2 tasks, Codex: 2 tasks, OpenCode: docs pass, Antigravity: landing page prototype.',
      '',
      `**Suggestions** - Assign a reviewer to TASK-0006. ${NOTE}`,
    ].join('\n');
  }
  if (system === SYSTEM_CHAT) {
    return `In the demo data, TASK-0003 (checkout redesign) and TASK-0005 (webhook retries) are in progress; TASK-0006 is waiting for review. ${NOTE}`;
  }
  return NOTE;
}
