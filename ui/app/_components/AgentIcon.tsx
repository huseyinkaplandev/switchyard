import { AGENTS } from '../_lib/agents';

const aliases: Record<string, string> = { claude: 'claude-code' };

/**
 * A small initials badge in the tool's accent colour. Vendor logos are not
 * bundled; the badge is decorative beside an existing accessible name.
 */
export default function AgentIcon({ agent, size = 20 }: { agent: string; size?: number }) {
  const meta = AGENTS.find((item) => item.id === (aliases[agent] ?? agent));
  if (!meta) return null;
  return (
    <span
      aria-hidden="true"
      className={`agent-brand-icon agent-brand-${agent}`}
      style={{
        width: size, height: size, lineHeight: `${size}px`, fontSize: Math.max(8, Math.round(size * 0.42)),
        borderRadius: Math.round(size / 4), background: `${meta.color}26`, color: meta.color,
        border: `1px solid ${meta.color}66`, textAlign: 'center', fontWeight: 700, fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: '-0.02em',
      }}
    >
      {meta.initial}
    </span>
  );
}
