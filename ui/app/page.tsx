import { getState, listCodexThreads, listTasks } from './_actions';
import Dashboard from './_components/Dashboard';

// Force dynamic rendering and prevent caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const activeTab = (Array.isArray(params.tab) ? params.tab[0] : params.tab) || 'codex';
  const [initial, initialTasks, initialCodexThreads] = await Promise.all([
    getState(),
    listTasks(),
    activeTab === 'codex' ? listCodexThreads() : Promise.resolve([]),
  ]);

  const normalizedEntries = initial.entries.map((entry) => ({
    ...entry,
    ts: entry.ts instanceof Date ? entry.ts : new Date(entry.ts),
  }));

  const initialNormalized = {
    ...initial,
    entries: normalizedEntries,
  };

  return (
    <Dashboard
      initial={initialNormalized}
      initialTasks={initialTasks}
      initialCodexThreads={initialCodexThreads}
    />
  );
}
