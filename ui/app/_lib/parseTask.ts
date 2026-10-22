export type TaskStatus = 'inbox' | 'in_progress' | 'review' | 'done';

export type Task = Readonly<{
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  role: string | null;
  priority: 'low' | 'normal' | 'high';
  created: string;
  body: string;
  filename: string;
}>;

export function parseTask(filename: string, raw: string): Task {
  const parts = raw.split(/^---$/m);
  if (parts.length < 3) {
    throw new Error('Invalid frontmatter: missing delimiters');
  }

  const yamlText = parts[1];
  const body = parts.slice(2).join('---').trim();

  const metadata: Record<string, string> = {};
  const lines = yamlText.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    metadata[key] = val;
  }

  const id = metadata.id || '';
  const title = metadata.title || '';
  const status = (metadata.status || 'inbox') as TaskStatus;
  const assignee = metadata.assignee || null;
  const role = metadata.role || null;
  const priority = (metadata.priority || 'normal') as 'low' | 'normal' | 'high';
  const created = metadata.created || '';

  if (!id || !title) {
    throw new Error(`Missing mandatory frontmatter fields: id="${id}", title="${title}"`);
  }

  return {
    id,
    title,
    status,
    assignee: assignee === 'empty' || assignee === 'null' || !assignee ? null : assignee,
    role: role === 'empty' || role === 'null' || !role ? null : role,
    priority,
    created,
    body,
    filename,
  };
}
