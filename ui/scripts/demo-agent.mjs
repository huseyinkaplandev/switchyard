// Stand-in for the codex / claude / opencode CLIs in demo mode. It reads the message from stdin (or the
// last argument for opencode) and prints one simulated reply in the provider's own JSON event format.
const args = process.argv.slice(2);
const provider = args[0] === 'exec' ? 'codex' : args[0] === 'run' ? 'opencode' : 'claude-code';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const message = (provider === 'opencode' ? args.at(-1) : input).trim().slice(0, 200);
  const reply = `Demo mode: this reply is simulated and no agent CLI was started. A real run would resume the session and answer:\n\n> ${message}`;
  const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  setTimeout(() => {
    if (provider === 'codex') write({ type: 'item.completed', item: { type: 'agent_message', text: reply } });
    else if (provider === 'opencode') write({ type: 'text', part: { text: reply } });
    else {
      for (const word of reply.split(/(?<=\s)/)) write({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } });
      write({ type: 'result', is_error: false, result: reply });
    }
  }, 800);
});
