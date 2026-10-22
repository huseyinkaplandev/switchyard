import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sameLocalOrigin } from '../../../_lib/desktopHandoff/origin';

const execFileAsync = promisify(execFile);
const APP_NAMES = { codex: 'Codex', 'claude-code': 'Claude', opencode: 'OpenCode', antigravity: 'Antigravity' } as const;

export async function POST(request: Request) {
  if (!sameLocalOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  const body = await request.json().catch(() => null) as { provider?: keyof typeof APP_NAMES } | null;
  const provider = body?.provider;
  if (!provider || !Object.hasOwn(APP_NAMES, provider)) return NextResponse.json({ error: 'Invalid provider.' }, { status: 400 });
  try {
    if (process.platform === 'win32') {
      // Resolve the installed app identity, including Store-packaged Codex.
      // No client-provided command, executable or app ID is accepted.
      const script = `
$ErrorActionPreference = 'Stop'
$patterns = @{ codex = '^OpenAI\\.Codex_[^!]+!App$'; 'claude-code' = '^com\\.squirrel\\.AnthropicClaude\\.claude$'; opencode = '^ai\\.opencode\\.desktop$'; antigravity = '^Google\\.Antigravity$' }
$app = @(Get-StartApps | Where-Object { $_.AppID -match $patterns[$env:SWITCHYARD_DESKTOP_PROVIDER] })
if ($app.Count -ne 1) { throw 'Installed Desktop application could not be uniquely located in the Windows Start menu.' }
Start-Process -FilePath explorer.exe -ArgumentList ('shell:AppsFolder\\' + $app[0].AppID) -WindowStyle Hidden
`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true, timeout: 15000, env: { ...process.env, SWITCHYARD_DESKTOP_PROVIDER: provider },
      });
    } else if (process.platform === 'darwin') {
      await execFileAsync('/usr/bin/open', ['-a', APP_NAMES[provider]]);
    } else {
      return NextResponse.json({ error: 'Desktop application launch is supported on Windows and macOS.' }, { status: 501 });
    }
    return NextResponse.json({ ok: true, app: APP_NAMES[provider] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not open the application.' }, { status: 500 });
  }
}
