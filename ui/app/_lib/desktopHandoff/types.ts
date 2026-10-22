export type DesktopProvider = 'claude-code' | 'codex';
export type ChatType = 'normal' | 'scheduled' | 'unknown';
export type SourcePlatform = 'windows' | 'macos';
export type TimePreset = 'today' | '8h' | '24h' | '7d' | 'all' | 'custom';
export type TimeWindow = { from: string | null; to: string; zone: string };
export type ActivityPreview = { messageId: string; text: string; at: string };
export type HandoffCandidate = {
  key: string; sourceId: string; desktopId: string | null; currentSourceId?: string;
  provider: DesktopProvider; platform: SourcePlatform; sourceAccount: string | null;
  projectRoot: string; cwd: string; title: string; chatType: ChatType;
  scheduledTaskId: string | null; archived: boolean; sourceAvailable: boolean;
  lastUser: ActivityPreview | null; lastAssistant: ActivityPreview | null; activityAt: string | null;
};
export type ItemState = 'prepared' | 'queued' | 'opening' | 'opened' | 'sent' | 'reply-observed' | 'failed' | 'uncertain';
export type ItemProgress = { itemId: string; state: ItemState; blockedBy?: string; destinationId?: string; destinationAccount?: string; titleVerified?: boolean; submittedAt?: string; firstReplyAt?: string; error?: string; updatedAt: string };
export type DesktopRuntime = { status: string; running: boolean; pid?: number; error?: string; updatedAt?: string };
export type PackageItem = { id: string; source: HandoffCandidate; marker: string; transcriptFile: string; handoffFile: string; promptFile: string; hashes: Record<string, string> };
export type HandoffPackage = { version: 1; id: string; createdAt: string; window: TimeWindow; targetProvider: DesktopProvider; items: PackageItem[] };
