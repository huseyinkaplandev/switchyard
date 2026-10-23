import { AGENTS } from '../_lib/agents';
import antigravity from '../../public/agents/antigravity.svg';
import claudeCode from '../../public/agents/claude-code.svg';
import codex from '../../public/agents/codex.png';
import cursor from '../../public/agents/cursor.png';
import kiro from '../../public/agents/kiro.png';
import opencode from '../../public/agents/opencode.svg';
import vscode from '../../public/agents/vscode.png';
import vscodeInsiders from '../../public/agents/vscode-insiders.png';

const aliases: Record<string, string> = { claude: 'claude-code' };

/** Next imports an image as `{ src }`, other bundlers as a URL string. */
type ImageAsset = string | { src: string };
const logos: Record<string, ImageAsset> = {
  antigravity, 'claude-code': claudeCode, codex, cursor, kiro, opencode, vscode, 'vscode-insiders': vscodeInsiders,
};
const url = (asset: ImageAsset) => (typeof asset === 'string' ? asset : asset.src);

/**
 * The tool's own logo, unmodified. Decorative: it always sits beside the
 * tool's name, which carries the accessible label. Product names and logos
 * are trademarks of their owners (see THIRD_PARTY_NOTICES.txt).
 */
export default function AgentIcon({ agent, size = 20 }: { agent: string; size?: number }) {
  const id = aliases[agent] ?? agent;
  const meta = AGENTS.find((item) => item.id === id);
  const logo = logos[id];
  if (!meta || !logo) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed-size static mark needs no optimisation.
    <img
      src={url(logo)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className={`agent-brand-icon agent-brand-${agent}`}
      style={{ width: size, height: size, borderRadius: Math.round(size / 4) }}
    />
  );
}
