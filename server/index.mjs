import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEther, formatEther, keccak256, toUtf8Bytes } from 'ethers';
import { createChain } from './chain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const roles = ['maintainer', 'sponsor', 'maya', 'alex', 'sam'];
const people = [
  { id: 'maya', name: 'Maya Chen', username: 'mayac', initials: 'MC', color: 'purple', signer: 2 },
  { id: 'alex', name: 'Alex Rivera', username: 'alexr', initials: 'AR', color: 'orange', signer: 3 },
  { id: 'sam', name: 'Sam Okafor', username: 'samcodes', initials: 'SO', color: 'blue', signer: 4 },
];
const seedContributions = () => [
  { id: 'pr-148', person: 'maya', number: 148, title: 'Fix session refresh race condition', category: 'Bug fix', description: 'Prevents parallel refresh requests from invalidating active sessions. Includes regression coverage for concurrent requests.', scores: { impact: 32, complexity: 24, testing: 18, documentation: 8 }, proposed: 82, status: 'Reviewed', files: 7, tests: true, merged: '2 days ago', url: null },
  { id: 'pr-145', person: 'alex', number: 145, title: 'Add keyboard navigation to command menu', category: 'Accessibility', description: 'Adds arrow-key navigation, focus restoration, and screen reader labels to the command menu.', scores: { impact: 28, complexity: 20, testing: 16, documentation: 8 }, proposed: 72, status: 'Reviewed', files: 5, tests: true, merged: '3 days ago', url: null },
  { id: 'pr-142', person: 'sam', number: 142, title: 'Rewrite the self-hosting setup guide', category: 'Documentation', description: 'Documents the environment setup, database migrations, and a troubleshooting guide for first-time contributors.', scores: { impact: 26, complexity: 14, testing: 4, documentation: 10 }, proposed: 54, status: 'Needs review', files: 3, tests: false, merged: '4 days ago', url: null },
];
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const fail = message => { throw new Error(message); };
const requireRole = (body, role) => { if (body.role !== role) fail(`Switch to the ${role} demo wallet to perform this action.`); };
const amountValue = value => {
  if (!/^\d+(\.\d{1,6})?$/.test(String(value))) fail('Enter an amount with at most 6 decimal places.');
  const amount = parseEther(String(value));
  if (amount <= 0n || amount > parseEther('100')) fail('Amount must be greater than 0 and at most 100 local ETH.');
  return amount;
};
async function readBody(req) {
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32000) fail('Request too large.'); }
  try { return JSON.parse(body || '{}'); } catch { fail('Invalid JSON request.'); }
}
async function github(endpoint) {
  const response = await fetch(`https://api.github.com/${endpoint}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MergePaid-Local-Demo' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(response.status === 403 ? 'GitHub rate limit reached. Try again later or use the sample round.' : `GitHub returned ${response.status}. Check the public repository name.`);
  return response.json();
}

export async function startServer({ port = 3017, quiet = false } = {}) {
  const chain = await createChain();
  const { signers, provider, factory } = chain;
  const addresses = await Promise.all(signers.map(x => x.getAddress()));
  const contributors = people.map(p => ({ ...p, address: addresses[p.signer] }));
  let rounds = [];
  let seq = 0;
  const recordTx = async (round, tx, label) => {
    const receipt = await tx.wait();
    round.transactions.unshift({ hash: tx.hash, label, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), at: new Date().toISOString() });
    return receipt;
  };
  async function makeRound({ repo, description, match = '0', sample = false, icon = 'terminal', color = 'purple' }) {
    const contract = await factory.deploy(addresses[0], { value: parseEther(match) }); await contract.waitForDeployment();
    const round = { id: `round-${++seq}`, repo, description, sample, icon, color, contract, address: await contract.getAddress(), matchCap: match, contributions: sample ? seedContributions() : [], appeals: [], allocations: [], transactions: [], notes: [], createdAt: new Date().toISOString(), evidenceHash: null };
    const deploy = contract.deploymentTransaction(); await recordTx(round, deploy, 'Funding contract deployed');
    rounds.push(round); return round;
  }
  const main = await makeRound({ repo: 'orbitkit / orbit', description: 'The open-source toolkit for building better developer experiences.', match: '1.5', sample: true });
  await recordTx(main, await main.contract.connect(signers[1]).sponsor({ value: parseEther('1.2') }), 'Community sponsorship + 1:1 match');
  const second = await makeRound({ repo: 'leaf / leaf-ui', description: 'Accessible components. Thoughtful defaults. Built for everyone.', match: '0.5', sample: true, icon: 'layers', color: 'green' });
  await recordTx(second, await second.contract.connect(signers[1]).sponsor({ value: parseEther('0.35') }), 'Community sponsorship + 1:1 match');
  const third = await makeRound({ repo: 'atlas / docs', description: 'Making developer documentation a little more human.', sample: true, icon: 'book', color: 'orange' });
  await recordTx(third, await third.contract.connect(signers[1]).sponsor({ value: parseEther('0.25') }), 'Community sponsorship');

  async function roundView(r) {
    const [funded, paid, phase, matchRemaining] = await Promise.all([r.contract.funded(), r.contract.paid(), r.contract.phase(), r.contract.matchRemaining()]);
    return { ...r, contract: undefined, funded: formatEther(funded), paid: formatEther(paid), phase: ['Funding', 'Review', 'Finalized'][Number(phase)], matchRemaining: formatEther(matchRemaining), allocations: await Promise.all(r.allocations.map(async a => ({ ...a, claimable: formatEther(await r.contract.claimable(a.address)) }))) };
  }
  async function snapshot() {
    return { rounds: await Promise.all(rounds.map(roundView)), contributors, wallets: await Promise.all(roles.map(async (id, i) => ({ id, address: addresses[i], balance: formatEther(await provider.getBalance(addresses[i], 'latest')) }))), network: { name: 'Local Ganache', chainId: 1337, mode: 'demo', resetsOnRestart: true }, rubric: { impact: 40, complexity: 30, testing: 20, documentation: 10 } };
  }
  async function mutate(url, b) {
    if (!roles.includes(b.role)) fail('Choose a demo wallet first.');
    if (url === '/api/rounds') {
      requireRole(b, 'maintainer');
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(b.repo || '')) fail('Use a repository name like owner/repository.');
      const info = await github(`repos/${b.repo}`);
      const match = b.match && Number(b.match) ? formatEther(amountValue(b.match)) : '0';
      const r = await makeRound({ repo: info.full_name.replace('/', ' / '), description: info.description || 'A community-funded open-source project.', match });
      return { message: 'Funding round created on the local blockchain.', roundId: r.id };
    }
    const match = url.match(/^\/api\/rounds\/([^/]+)\/([a-z-]+)$/);
    if (!match) fail('Unknown action.');
    const r = rounds.find(x => x.id === match[1]); if (!r) fail('Round not found.');
    const action = match[2];
    const phase = Number(await r.contract.phase());
    if (action === 'sponsor') {
      requireRole(b, 'sponsor');
      await recordTx(r, await r.contract.connect(signers[1]).sponsor({ value: amountValue(b.amount) }), 'Community sponsorship + matching');
      return { message: 'Sponsorship confirmed on-chain. Matching funds applied where available.' };
    }
    if (action === 'import') {
      requireRole(b, 'maintainer'); if (phase !== 0) fail('Import contributions before opening review.');
      if (r.sample) fail('Sample repositories use fixture contributions. Create a round for a real public repository to import GitHub PRs.');
      const repo = r.repo.replaceAll(' ', '');
      const pulls = await github(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`);
      const merged = pulls.filter(p => p.merged_at).slice(0, 6);
      if (!merged.length) fail('No merged pull requests found among the last 30 closed PRs.');
      const items = await Promise.all(merged.map(async p => {
        const files = await github(`repos/${repo}/pulls/${p.number}/files?per_page=100`);
        const tests = files.some(f => /(^|\/)(__tests__|tests?|spec)(\/|\.)|\.(test|spec)\./i.test(f.filename));
        const docs = files.some(f => /\.mdx?$|(^|\/)docs\//i.test(f.filename));
        const scores = { impact: 20, complexity: 15, testing: tests ? 12 : 0, documentation: docs ? 8 : 0 };
        return { id: `github-${p.number}`, person: null, githubUser: p.user.login, title: p.title, number: p.number, category: docs ? 'Documentation' : 'Contribution', description: `Imported from GitHub. Impact and complexity start at neutral defaults; a reviewer must assess the diff. ${tests ? 'Test-related files detected; passing tests have not been verified.' : 'No test-related filenames detected.'}`, scores, proposed: Object.values(scores).reduce((a, x) => a + x, 0), status: 'Needs review', files: files.length, tests, merged: new Date(p.merged_at).toLocaleDateString('en-US'), url: p.html_url };
      }));
      r.contributions = items;
      return { message: `Imported ${items.length} merged PRs. Map authors to demo wallets and review the proposed scores.` };
    }
    if (action === 'review') {
      requireRole(b, 'maintainer'); if (!r.contributions.length) fail('Import contributions before starting review.');
      await recordTx(r, await r.contract.startReview(), 'Funding closed; review opened');
      return { message: 'Funding closed on-chain. Review scores and resolve appeals before finalizing.' };
    }
    if (action === 'score') {
      requireRole(b, 'maintainer'); if (phase === 2) fail('Finalized scores cannot be changed.');
      const c = r.contributions.find(x => x.id === b.contributionId); if (!c) fail('Contribution not found.');
      const caps = { impact: 40, complexity: 30, testing: 20, documentation: 10 };
      for (const [key, cap] of Object.entries(caps)) if (!Number.isInteger(b.scores?.[key]) || b.scores[key] < 0 || b.scores[key] > cap) fail(`Invalid ${key} score.`);
      if (!contributors.some(p => p.id === b.person)) fail('Assign a demo contributor wallet. This is a manual mapping, not GitHub identity verification.');
      if (!b.reason?.trim() || b.reason.length > 1000) fail('Provide a review reason of 1–1000 characters.');
      c.scores = b.scores; c.proposed = Object.values(b.scores).reduce((a, x) => a + x, 0); c.status = 'Reviewed'; c.person = b.person; c.reviewReason = b.reason.trim();
      r.notes.unshift({ text: `PR #${c.number}: ${c.reviewReason}`, at: new Date().toISOString() });
      return { message: 'Review saved with a public explanation.' };
    }
    if (action === 'appeal') {
      if (phase !== 1) fail('Appeals are accepted during review.');
      const c = r.contributions.find(x => x.id === b.contributionId); if (!c || c.person !== b.role) fail('You can appeal only contributions assigned to your demo wallet.');
      if (!b.reason?.trim() || b.reason.length > 1000) fail('Explain your appeal in 1–1000 characters.');
      if (r.appeals.some(a => a.contributionId === c.id && a.status === 'Open')) fail('This contribution already has an open appeal.');
      r.appeals.unshift({ id: `appeal-${Date.now()}`, contributionId: c.id, person: b.role, title: c.title, reason: b.reason.trim(), status: 'Open', at: new Date().toISOString() });
      return { message: 'Appeal submitted. Finalization is blocked until it is resolved.' };
    }
    if (action === 'resolve') {
      requireRole(b, 'maintainer'); if (phase !== 1) fail('Round is not in review.');
      const a = r.appeals.find(x => x.id === b.appealId); if (!a || a.status !== 'Open') fail('Open appeal not found.');
      if (!b.reason?.trim()) fail('Explain the decision.');
      a.status = 'Resolved'; a.resolution = b.reason.trim().slice(0, 1000);
      return { message: 'Appeal resolved. Any score change must also be saved in the contribution review.' };
    }
    if (action === 'finalize') {
      requireRole(b, 'maintainer'); if (phase !== 1) fail('Open review first.');
      if (r.appeals.some(a => a.status === 'Open')) fail('Resolve all open appeals first.');
      if (!r.contributions.length || r.contributions.some(c => c.status !== 'Reviewed' || !c.person)) fail('Review every contribution and assign a demo wallet before finalizing.');
      const totals = contributors.map(p => ({ ...p, score: r.contributions.filter(c => c.person === p.id).reduce((a, c) => a + c.proposed, 0) })).filter(p => p.score > 0);
      const sum = totals.reduce((a, p) => a + p.score, 0); if (!sum) fail('Total score must be greater than zero.');
      const funded = await r.contract.funded(); let used = 0n;
      const amounts = totals.map((p, i) => { const amount = i === totals.length - 1 ? funded - used : funded * BigInt(p.score) / BigInt(sum); used += amount; return amount; });
      const evidence = JSON.stringify({ repo: r.repo, contributions: r.contributions, appeals: r.appeals, allocations: totals.map((p, i) => ({ address: p.address, amountWei: amounts[i].toString() })) });
      r.evidenceHash = keccak256(toUtf8Bytes(evidence)); r.evidence = evidence;
      await recordTx(r, await r.contract.finalize(totals.map(p => p.address), amounts, r.evidenceHash), 'Reward allocation finalized');
      r.allocations = totals.map((p, i) => ({ person: p.id, address: p.address, score: p.score, amount: formatEther(amounts[i]) }));
      return { message: 'Allocation committed on-chain. Contributors can now claim their rewards.' };
    }
    if (action === 'claim') {
      const person = contributors.find(p => p.id === b.role); if (!person) fail('Switch to a contributor demo wallet to claim.');
      if (await r.contract.claimable(person.address) === 0n) fail('No unclaimed allocation for this wallet. Duplicate claims are blocked by the contract.');
      await recordTx(r, await r.contract.connect(signers[person.signer]).claim(), `${person.name} claimed rewards`);
      return { message: 'Reward transferred to your local demo wallet.' };
    }
    fail('Unknown round action.');
  }
  let queue = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, await snapshot());
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, chainId: 1337 });
      if (req.method === 'GET' && /^\/api\/rounds\/[^/]+\/evidence$/.test(pathname)) {
        const r = rounds.find(x => x.id === pathname.split('/')[3]);
        if (!r?.evidence) return json(res, 404, { error: 'No finalized evidence.' });
        return json(res, 200, { hash: r.evidenceHash, evidence: JSON.parse(r.evidence), canonical: r.evidence });
      }
      if (req.method === 'POST' && pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && !['http://127.0.0.1:5187', 'http://localhost:5187', `http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return json(res, 403, { error: 'Local origin required.' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { error: 'JSON required.' });
        const body = await readBody(req);
        const operation = queue.then(() => mutate(pathname, body)); queue = operation.catch(() => {});
        const result = await operation; return json(res, 200, { ...result, state: await snapshot() });
      }
      if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Endpoint not found.' });
      if (process.argv.includes('--production')) {
        const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
        let filename = path.resolve(root, 'dist', relative || 'index.html');
        if (!filename.startsWith(path.join(root, 'dist') + path.sep)) return json(res, 403, { error: 'Forbidden.' });
        let data; try { data = await readFile(filename); } catch { filename = path.join(root, 'dist', 'index.html'); data = await readFile(filename); }
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); res.end(data); return;
      }
      json(res, 404, { error: 'Use the frontend at http://127.0.0.1:5187' });
    } catch (error) { json(res, 400, { error: error.shortMessage || error.message || 'Action failed.' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  if (!quiet) console.log(`\nMergePaid API + local blockchain ready at http://127.0.0.1:${port}\nDemo wallets only. All chain and application state reset on restart.\n`);
  return { server, chain, snapshot, close: async () => { await new Promise(resolve => server.close(resolve)); await chain.rpc.disconnect(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startServer();
