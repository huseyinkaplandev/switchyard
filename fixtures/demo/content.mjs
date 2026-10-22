// Invented demo content. Acme is a fictional company; all accounts use example.com.
// Identifiers follow obviously synthetic patterns (runs of zeros) so they can never collide with real ones.

const windows = process.platform === 'win32';
const root = windows ? 'C:\\code' : '/work';
const join = (name) => (windows ? `${root}\\${name}` : `${root}/${name}`);

export const projects = {
  web: join('acme-web'),
  api: join('acme-api'),
  billing: join('acme-billing'),
  docs: join('acme-docs'),
  landing: join('acme-landing'),
};

export const accounts = {
  a: { account: 'acc00000-0000-4000-8000-00000000000a', org: '0a900000-0000-4000-8000-00000000000a', label: 'demo-a@example.com' },
  b: { account: 'acc00000-0000-4000-8000-00000000000b', org: '0a900000-0000-4000-8000-00000000000b', label: 'demo-b@example.com' },
};

const codexId = (n) => `c0de0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const claudeId = (n) => `c1a0de00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const antigravityId = (n) => `a9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const localId = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The Codex conversation that `npm run demo:live` keeps appending to. */
export const liveConversationId = codexId(11);

export const conversations = [
  {
    provider: 'claude-code', id: claudeId(5), project: 'web', title: 'Checkout redesign: split CartSummary', today: true,
    startMinutesAgo: 170, stepMinutes: 4, branch: 'feat/checkout-redesign',
    desktop: { account: 'a', local: localId(5) },
    turns: [
      {
        user: 'The checkout page is one 900-line component. Split CartSummary out of src/checkout/CheckoutPage.tsx, keep the props typed, and do not change behaviour. Tests must stay green.',
        steps: [
          { think: 'CheckoutPage mixes cart totals, coupon handling and the payment form. CartSummary only needs items, currency and the applied coupon, so the extraction boundary is clear.' },
          { tool: { name: 'Read', input: { file_path: 'src/checkout/CheckoutPage.tsx' }, result: '1  import { useCart } from "../cart/useCart";\n2  import { formatMoney } from "../lib/money";\n...\n412  function CartSummary({ items, coupon }: Props) {\n413    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n...' } },
          { tool: { name: 'Write', input: { file_path: 'src/checkout/CartSummary.tsx', content: 'export function CartSummary({ items, currency, coupon }: CartSummaryProps) { ... }' }, result: 'File created successfully at: src/checkout/CartSummary.tsx' } },
          { tool: { name: 'Edit', input: { file_path: 'src/checkout/CheckoutPage.tsx', old_string: 'function CartSummary(', new_string: 'import { CartSummary } from "./CartSummary";' }, result: 'The file src/checkout/CheckoutPage.tsx has been updated.' } },
          { tool: { name: 'Bash', input: { command: 'npm test -- checkout', description: 'Run checkout tests' }, result: 'PASS src/checkout/CheckoutPage.test.tsx\nPASS src/checkout/CartSummary.test.tsx\n\nTests: 24 passed, 24 total' } },
          { say: 'CartSummary now lives in `src/checkout/CartSummary.tsx` with a `CartSummaryProps` type (items, currency, optional coupon). CheckoutPage dropped from 902 to 611 lines. All 24 checkout tests pass.\n\nNext I would move the coupon form the same way.' },
        ],
      },
      {
        user: 'Good. Do the coupon form next, and add a test for an expired coupon.',
        steps: [
          { think: 'CouponForm owns its own input state and calls applyCoupon. The expired case is handled by the API returning 410; the UI should show the message and keep the old total.' },
          { tool: { name: 'Edit', input: { file_path: 'src/checkout/CouponForm.tsx', old_string: '', new_string: 'export function CouponForm({ onApply }: CouponFormProps) { ... }' }, result: 'The file src/checkout/CouponForm.tsx has been updated.' } },
          { tool: { name: 'Bash', input: { command: 'npm test -- coupon', description: 'Run coupon tests' }, result: 'FAIL src/checkout/CouponForm.test.tsx\n  x shows an error for an expired coupon (31 ms)\n    Expected: "This coupon has expired"\n    Received: "Something went wrong"', error: true } },
          { say: 'The new expired-coupon test fails: the form maps every non-200 response to a generic error. I am adding a 410 branch to `applyCoupon` so the message comes from the API.' },
          { limit: 'Claude usage limit reached. Your limit will reset at 3pm.' },
        ],
      },
    ],
  },
  {
    provider: 'codex', id: codexId(3), project: 'web', title: 'Continue checkout redesign after usage limit', today: true,
    startMinutesAgo: 120, stepMinutes: 3,
    turns: [
      {
        user: 'DESKTOP-HANDOFF:demo\nThis chat continues "Checkout redesign: split CartSummary" from Claude Code, which stopped at its usage limit. Read the handoff brief first. The last open item: the expired-coupon test fails because applyCoupon maps every non-200 response to a generic error.',
        steps: [
          { think: 'The brief says CartSummary and CouponForm are extracted, 24 tests passed before the coupon change, and the only failing test is the expired coupon case. Start by confirming the working tree matches the brief.' },
          { shell: 'git status --short && npm test -- coupon', exit: 1, output: ' M src/checkout/CheckoutPage.tsx\n?? src/checkout/CartSummary.tsx\n?? src/checkout/CouponForm.tsx\nFAIL src/checkout/CouponForm.test.tsx\n  x shows an error for an expired coupon' },
          { patch: { file: 'src/checkout/applyCoupon.ts', diff: '-  if (!response.ok) throw new Error("Something went wrong");\n+  if (response.status === 410) throw new CouponError("This coupon has expired");\n+  if (!response.ok) throw new Error("Something went wrong");' } },
          { shell: 'npm test -- checkout coupon', output: 'Tests: 27 passed, 27 total' },
          { say: 'Picked up where the Claude Code session stopped. `applyCoupon` now throws a `CouponError` for HTTP 410, and the form shows its message. 27 checkout and coupon tests pass. The working tree still has the uncommitted extraction from the previous session; nothing was redone.' },
        ],
      },
    ],
  },
  {
    provider: 'codex', id: codexId(1), project: 'web', title: 'Fix flaky date-picker test', today: true,
    startMinutesAgo: 95, stepMinutes: 2,
    turns: [
      {
        user: 'DatePicker.test.tsx fails about one run in five on CI. Find out why and fix the cause, not the symptom.',
        steps: [
          { think: 'Intermittent failures in a date test usually mean the test depends on the current time or time zone. Check whether the test freezes the clock.' },
          { shell: 'grep -n "new Date" src/components/DatePicker.test.tsx', output: '18:    const today = new Date();\n41:    expect(screen.getByText(format(today, "MMMM yyyy"))).toBeVisible();' },
          { shell: 'for i in 1 2 3 4 5 6 7 8; do TZ=Pacific/Kiritimati npm test -- DatePicker --silent | tail -1; done', output: 'Tests: 6 passed\nTests: 1 failed, 5 passed\nTests: 6 passed\n...' },
          { patch: { file: 'src/components/DatePicker.test.tsx', diff: '-    const today = new Date();\n+    vi.useFakeTimers();\n+    vi.setSystemTime(new Date("2026-03-31T23:30:00Z"));\n+    const today = new Date();' } },
          { say: 'The test read the real clock twice: once to build the expected month and once inside the component. Near midnight in UTC+14 the two reads land in different months. The test now freezes the clock at a month boundary, which reproduces the old failure every time without the fix and passes with it. 40 consecutive runs passed.' },
        ],
      },
    ],
  },
  {
    provider: 'codex', id: codexId(11), project: 'api', title: 'Payment webhook retries with backoff', today: true,
    startMinutesAgo: 40, stepMinutes: 2,
    turns: [
      {
        user: 'Webhook deliveries to merchants are retried immediately and hammer slow endpoints. Add exponential backoff with jitter, max 6 attempts, and keep the delivery log.',
        steps: [
          { think: 'Retries are scheduled in src/webhooks/deliver.ts with a fixed 0 ms delay. The queue supports a delay option, so backoff can be computed per attempt.' },
          { shell: 'npm test -- webhooks', output: 'Tests: 12 passed, 12 total' },
          { patch: { file: 'src/webhooks/deliver.ts', diff: '-  await queue.add("deliver", job, { delay: 0 });\n+  const delay = Math.min(60_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);\n+  await queue.add("deliver", job, { delay, attempts: 6 });' } },
          { say: 'Backoff is in place: 500 ms doubling per attempt, capped at 60 s, with 50 to 100 percent jitter and at most 6 attempts. Writing the tests for the delay schedule now.' },
        ],
      },
    ],
  },
  {
    provider: 'codex', id: codexId(2), project: 'billing', title: 'Add CSV export to invoices',
    startMinutesAgo: 26 * 60, stepMinutes: 3,
    turns: [
      {
        user: 'Finance wants a CSV export of invoices for a date range: number, customer, issue date, total, status. Stream it so large months do not load into memory.',
        steps: [
          { think: 'The invoices repository already exposes a cursor. A Node stream that writes rows as they arrive keeps memory flat.' },
          { patch: { file: 'src/invoices/exportCsv.ts', diff: '+export function exportInvoicesCsv(range: DateRange): Readable {\n+  return Readable.from(rows(range)).pipe(toCsv(["number", "customer", "issued", "total", "status"]));\n+}' } },
          { shell: 'npm test -- exportCsv', output: 'Tests: 5 passed, 5 total' },
          { say: 'Added `GET /invoices/export.csv?from=&to=`. Rows stream from the database cursor, so memory stays flat; a 40,000-invoice month exported in 3.1 s in the benchmark test. Commas and quotes in customer names are escaped.' },
        ],
      },
    ],
  },
  {
    provider: 'codex', id: codexId(4), project: 'docs', title: 'Upgrade the docs site to Next.js 15', archived: true,
    startMinutesAgo: 6 * 24 * 60, stepMinutes: 5,
    turns: [
      {
        user: 'Upgrade acme-docs from Next 14 to 15 and fix whatever breaks.',
        steps: [
          { shell: 'npx @next/codemod@latest upgrade latest', output: 'Updated 14 files.\nManual review: 2 uses of synchronous cookies() in app/(auth)/layout.tsx' },
          { patch: { file: 'app/(auth)/layout.tsx', diff: '-  const session = cookies().get("session");\n+  const session = (await cookies()).get("session");' } },
          { shell: 'npm run build', output: 'Compiled successfully.\nRoute (app) ... 38 static pages' },
          { say: 'Upgraded to Next 15. The codemod handled 14 files; I fixed the two synchronous `cookies()` calls by hand. The build produces the same 38 static pages.' },
        ],
      },
    ],
  },
  {
    provider: 'claude-code', id: claudeId(6), project: 'api', title: 'Rate limiter middleware review', today: true,
    startMinutesAgo: 75, stepMinutes: 3,
    desktop: { account: 'a', local: localId(6) },
    turns: [
      {
        user: 'Review src/middleware/rateLimit.ts before we merge it. Focus on correctness under concurrency.',
        steps: [
          { think: 'The limiter reads the counter, compares, then writes. Two requests can read the same value between those calls.' },
          { tool: { name: 'Read', input: { file_path: 'src/middleware/rateLimit.ts' }, result: '22  const count = Number(await redis.get(key)) || 0;\n23  if (count >= limit) return reject(res);\n24  await redis.set(key, count + 1, "EX", windowSeconds);' } },
          { say: 'One blocking issue: lines 22-24 are a read-then-write race. Under load two requests both read 99 and both pass a limit of 100. Use `INCR` and set the expiry only when the result is 1, or a small Lua script. Minor: the 429 response is missing a `Retry-After` header.\n\nDo you want me to make the change, or leave it as review comments?' },
        ],
      },
    ],
  },
  {
    provider: 'claude-code', id: claudeId(7), project: 'web', title: 'Nightly dependency audit', startMinutesAgo: 3 * 24 * 60 + 300, stepMinutes: 2,
    desktop: { account: 'a', local: localId(7), scheduledTaskId: 'nightly-dependency-audit' },
    turns: [{ user: 'Run the nightly dependency audit for acme-web and summarise anything new.', steps: [
      { tool: { name: 'Bash', input: { command: 'npm audit --omit=dev --json | npx audit-summary' }, result: '0 critical, 0 high, 1 moderate (postcss-url)' } },
      { say: 'No critical or high advisories. One moderate advisory in postcss-url, only reachable at build time. No action needed tonight.' },
    ] }],
  },
  {
    provider: 'claude-code', id: claudeId(8), project: 'web', title: 'Nightly dependency audit', startMinutesAgo: 2 * 24 * 60 + 300, stepMinutes: 2,
    desktop: { account: 'a', local: localId(8), scheduledTaskId: 'nightly-dependency-audit' },
    turns: [{ user: 'Run the nightly dependency audit for acme-web and summarise anything new.', steps: [] }],
  },
  {
    provider: 'claude-code', id: claudeId(9), project: 'web', title: 'Nightly dependency audit', startMinutesAgo: 24 * 60 + 300, stepMinutes: 2,
    desktop: { account: 'b', local: localId(9), scheduledTaskId: 'nightly-dependency-audit' },
    turns: [{ user: 'Run the nightly dependency audit for acme-web and summarise anything new.', steps: [
      { tool: { name: 'Bash', input: { command: 'npm audit --omit=dev --json | npx audit-summary' }, result: '0 critical, 1 high (undici < 6.21.1), 1 moderate' } },
      { say: 'New high advisory: undici below 6.21.1 (request smuggling), pulled in through the fetch polyfill. Upgrading the polyfill to 4.2.0 removes it; I opened TASK-0007 instead of changing the lockfile from a scheduled run.' },
    ] }],
  },
  {
    provider: 'opencode', id: 'ses_demo0000000000000012', project: 'docs', title: 'Write the v2 API migration guide',
    startMinutesAgo: 30 * 60, stepMinutes: 4,
    turns: [{ user: 'Draft a migration guide from API v1 to v2. Cover auth, pagination and the renamed fields.', steps: [
      { think: 'Collect the breaking changes from the changelog first so the guide does not miss any.' },
      { tool: { name: 'read', input: { filePath: 'CHANGELOG.md' }, result: '## 2.0.0\n- Bearer tokens replace API keys in query strings\n- Cursor pagination replaces page/limit\n- `amount_cents` renamed to `amount`' } },
      { tool: { name: 'write', input: { filePath: 'docs/migrate-v2.md' }, result: 'Wrote 182 lines' } },
      { say: 'Drafted `docs/migrate-v2.md`: a checklist, before-and-after requests for auth and pagination, and a field rename table. It links the deprecation date from the changelog.' },
    ] }],
  },
  {
    provider: 'opencode', id: 'ses_demo0000000000000013', project: 'api', title: 'Investigate slow search query', today: true,
    startMinutesAgo: 150, stepMinutes: 3,
    turns: [{ user: 'GET /products?q= takes 2 seconds on the staging dataset. Find out why.', steps: [
      { tool: { name: 'bash', input: { command: 'psql -c "EXPLAIN ANALYZE SELECT ..."' }, result: 'Seq Scan on products (cost=0.00..48211.00) (actual time=1874.2 ms)' } },
      { tool: { name: 'bash', input: { command: 'npm run migrate -- --dry-run' }, result: 'error: relation "products_search_idx" already exists', error: true } },
      { say: 'The query does a sequential scan because it searches `lower(name)` while the existing index is on `name`. The migration I tried collided with an index of the same name, so I left the schema unchanged. Proposed fix: an expression index on `lower(name)` under a new name; the dry run shows it drops the query to 14 ms.' },
    ] }],
  },
  {
    provider: 'opencode', id: 'ses_demo0000000000000014', project: 'api', title: 'Refactor logger to structured JSON',
    startMinutesAgo: 3 * 24 * 60, stepMinutes: 4,
    turns: [{ user: 'Switch our console.log calls in src/server to structured JSON logs with request ids.', steps: [
      { tool: { name: 'edit', input: { filePath: 'src/server/logger.ts' }, result: 'Applied 1 edit' } },
      { say: 'Added a pino-based logger with a request-id child logger per request and replaced 37 console.log calls. Log lines now carry `reqId`, `route` and `durationMs`.' },
    ] }],
  },
  {
    provider: 'antigravity', id: antigravityId(15), project: 'landing', title: 'Prototype the landing page hero',
    startMinutesAgo: 2 * 24 * 60 + 90, stepMinutes: 5,
    turns: [{ user: 'Prototype a hero section for the Acme landing page: headline, two CTAs, product screenshot on the right.', steps: [
      { think: 'Start with a two-column grid that stacks on small screens.' },
      { tool: { name: 'write_to_file', input: { TargetFile: 'src/sections/Hero.tsx' }, result: 'Created file src/sections/Hero.tsx' } },
      { say: 'Hero is in place with a responsive two-column grid, primary and secondary CTAs, and a lazy-loaded screenshot. It stacks below 768 px.' },
    ] }],
  },
  {
    provider: 'antigravity', id: antigravityId(16), project: 'landing', title: 'Accessibility pass on the pricing page',
    startMinutesAgo: 20 * 60, stepMinutes: 5,
    turns: [{ user: 'Run an accessibility pass on the pricing page and fix what you can.', steps: [
      { tool: { name: 'run_command', input: { CommandLine: 'npx axe http://127.0.0.1:4000/pricing' }, result: '4 violations: color-contrast (2), button-name (1), heading-order (1)' } },
      { tool: { name: 'replace_file_content', input: { TargetFile: 'src/pages/pricing.tsx' }, result: 'Applied 3 replacements' } },
      { say: 'Fixed all four axe violations: raised the muted text contrast to 4.6:1, gave the icon-only toggle an accessible name, and corrected the heading order.' },
    ] }],
  },
];

export const scheduledTasks = {
  claude: [
    { id: 'nightly-dependency-audit', name: 'Nightly dependency audit', cron: '0 2 * * *', enabled: true, project: 'web', accounts: ['a', 'b'], lastRunMinutesAgo: 24 * 60 + 300,
      prompt: 'Run npm audit for acme-web without dev dependencies. Report only new critical or high advisories, with the dependency path and the smallest safe upgrade. Do not change the lockfile; open a task instead.' },
    { id: 'weekly-changelog-draft', name: 'Weekly changelog draft', cron: '0 9 * * 1', enabled: true, project: 'docs', accounts: ['a', 'b'], lastRunMinutesAgo: 4 * 24 * 60,
      prompt: 'Draft next week\'s changelog for acme-docs from merged pull requests since last Monday. Group by feature, fix and internal change. Leave it as a draft file.' },
    { id: 'morning-ci-triage', name: 'Morning CI triage', cron: '30 8 * * 1,2,3,4,5', enabled: true, project: 'api', accounts: ['a'],
      prompt: 'Check the overnight CI runs for acme-api. For each failure, say whether it is flaky or real, with the failing test and the first bad commit.' },
  ],
  codex: [
    { id: 'nightly-test-sweep', name: 'Nightly test sweep', rrule: 'FREQ=DAILY;BYHOUR=1;BYMINUTE=0;BYSECOND=0', enabled: true, project: 'web',
      prompt: 'Run the full acme-web test suite three times and list any test that did not pass all three runs.' },
    { id: 'stale-branch-report', name: 'Stale branch report', rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=16;BYMINUTE=0;BYSECOND=0', enabled: false, project: 'api',
      prompt: 'List branches in acme-api with no commits in 30 days and no open pull request.' },
  ],
  antigravity: [
    { id: 'lighthouse-weekly', name: 'Weekly Lighthouse check', cron: '0 7 * * 1', enabled: true,
      prompt: 'Run Lighthouse on the acme-landing preview and compare the scores with last week.' },
  ],
};

export const tasks = [
  { id: 'TASK-0001', slug: 'invoice-csv-export', title: 'Invoice CSV export', status: 'done', assignee: 'codex', role: 'architect', priority: 'normal', createdDaysAgo: 3,
    body: 'Stream invoices for a date range as CSV: number, customer, issue date, total, status.' },
  { id: 'TASK-0002', slug: 'flaky-date-picker-test', title: 'Fix flaky date-picker test', status: 'done', assignee: 'codex', role: 'architect', priority: 'high', createdDaysAgo: 1,
    body: 'DatePicker.test.tsx fails about one CI run in five. Fix the cause.' },
  { id: 'TASK-0003', slug: 'checkout-redesign', title: 'Checkout redesign', status: 'in_progress', assignee: 'claude-code', role: 'frontend', priority: 'high', createdDaysAgo: 2,
    body: 'Split CheckoutPage into CartSummary, CouponForm and PaymentForm. No behaviour change. Keep tests green.' },
  { id: 'TASK-0004', slug: 'v2-migration-guide', title: 'v2 API migration guide', status: 'review', assignee: 'opencode', role: 'reviewer', priority: 'normal', createdDaysAgo: 2,
    body: 'Guide from API v1 to v2: auth, pagination, renamed fields.' },
  { id: 'TASK-0005', slug: 'webhook-backoff', title: 'Webhook retries with backoff', status: 'in_progress', assignee: 'codex', role: 'backend', priority: 'high', createdDaysAgo: 1,
    body: 'Exponential backoff with jitter, max 6 attempts, keep the delivery log.' },
  { id: 'TASK-0006', slug: 'rate-limiter-review', title: 'Rate limiter race condition', status: 'review', assignee: 'claude-code', role: 'backend', priority: 'high', createdDaysAgo: 2,
    body: 'Read-then-write race in rateLimit.ts. Use INCR or a Lua script; add Retry-After.' },
  { id: 'TASK-0007', slug: 'undici-advisory', title: 'Upgrade fetch polyfill for undici advisory', status: 'inbox', assignee: null, role: null, priority: 'high', createdDaysAgo: 0,
    body: 'The nightly audit found a high advisory in undici below 6.21.1. Upgrade the polyfill to 4.2.0.' },
  { id: 'TASK-0008', slug: 'search-index', title: 'Expression index for product search', status: 'inbox', assignee: 'opencode', role: 'backend', priority: 'normal', createdDaysAgo: 0,
    body: 'GET /products?q= scans the table. Add an index on lower(name) under a new name.' },
  { id: 'TASK-0009', slug: 'pricing-a11y', title: 'Pricing page accessibility fixes', status: 'done', assignee: 'antigravity', role: 'frontend', priority: 'low', createdDaysAgo: 1,
    body: 'Fix the four axe violations on /pricing.' },
];

export const liveLog = [
  [190, 'lead/claude-code: planning the day: checkout redesign, webhook backoff, search index'],
  [168, 'frontend/claude-code: TASK-0003 CartSummary extracted, 24 checkout tests green'],
  [150, 'backend/opencode: TASK-0008 seq scan on products, index proposal written'],
  [131, 'frontend/claude-code: TASK-0003 usage limit reached on account A, handing off to @codex'],
  [118, 'architect/codex: picked up TASK-0003 from the handoff brief, expired coupon fix in progress'],
  [106, 'architect/codex: TASK-0003 coupon fix done, 27 tests green'],
  [93, 'architect/codex: TASK-0002 done, root cause was a real clock read at a month boundary'],
  [74, 'backend/claude-code: TASK-0006 review: read-then-write race, @backend please switch to INCR'],
  [52, 'qa/vscode-insiders: @all staging deploy at 16:00, please push before then'],
  [38, 'backend/codex: TASK-0005 backoff implemented, writing delay schedule tests'],
  [12, 'reviewer/opencode: TASK-0004 migration guide ready for @lead review'],
];
