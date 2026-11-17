import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, keccak256, toUtf8Bytes } from 'ethers';
import { createChain } from '../server/chain.mjs';
import { startServer } from '../server/index.mjs';

test('contract conserves funds, caps matching, restricts reviewer, and rejects duplicate claims', async () => {
  const { factory, signers, provider, rpc } = await createChain();
  try {
    const addresses = await Promise.all(signers.map(s => s.getAddress()));
    const round = await factory.deploy(addresses[0], { value: parseEther('0.5') }); await round.waitForDeployment();
    await (await round.connect(signers[1]).sponsor({ value: parseEther('0.3') })).wait();
    assert.equal(await round.funded(), parseEther('0.6'));
    await (await round.connect(signers[1]).sponsor({ value: parseEther('0.4') })).wait();
    assert.equal(await round.funded(), parseEther('1.2'));
    assert.equal(await round.matchRemaining(), 0n);
    await assert.rejects(async () => { await (await round.connect(signers[1]).startReview()).wait(); });
    await (await round.startReview()).wait();
    await assert.rejects(async () => { await (await round.connect(signers[1]).sponsor({ value: 1n })).wait(); });
    const hash = keccak256(toUtf8Bytes('review evidence'));
    await assert.rejects(async () => { await (await round.finalize([addresses[2]], [parseEther('1')], hash)).wait(); });
    await assert.rejects(async () => { await (await round.finalize([addresses[2], addresses[2]], [parseEther('0.6'), parseEther('0.6')], hash)).wait(); });
    await assert.rejects(async () => { await (await round.connect(signers[1]).finalize([addresses[2]], [parseEther('1.2')], hash)).wait(); });
    await (await round.finalize([addresses[2], addresses[3]], [parseEther('0.7'), parseEther('0.5')], hash)).wait();
    await (await round.connect(signers[2]).claim()).wait();
    assert.equal(await round.claimable(addresses[2]), 0n);
    assert.equal(await round.paid(), parseEther('0.7'));
    await assert.rejects(async () => { await (await round.connect(signers[2]).claim()).wait(); });
    await (await round.connect(signers[3]).claim()).wait();
    assert.equal(await round.paid(), await round.funded());
    assert.equal(await provider.getBalance(await round.getAddress(), 'latest'), 0n);
  } finally { await rpc.disconnect(); }
});

test('review workflow blocks unresolved appeals, freezes allocations, and produces verifiable evidence', async () => {
  const app = await startServer({ port: 0, quiet: true });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function post(action, body, expected = 200) {
    const response = await fetch(`${base}/api/rounds/round-1/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  try {
    await post('review', { role: 'sponsor' }, 400);
    await post('review', { role: 'maintainer' });
    await post('sponsor', { role: 'sponsor', amount: '0.1' }, 400);
    await post('appeal', { role: 'alex', contributionId: 'pr-148', reason: 'Not my contribution' }, 400);
    const appealed = await post('appeal', { role: 'sam', contributionId: 'pr-142', reason: 'Please recognize the rewritten deployment guide.' });
    await post('finalize', { role: 'maintainer' }, 400);
    const appealId = appealed.state.rounds[0].appeals[0].id;
    await post('score', { role: 'maintainer', contributionId: 'pr-142', person: 'sam', scores: { impact: 30, complexity: 20, testing: 4, documentation: 10 }, reason: 'Guide covers migrations and deployment recovery.' });
    await post('resolve', { role: 'maintainer', appealId, reason: 'Raised impact and complexity after reviewing the guide.' });
    const finalized = await post('finalize', { role: 'maintainer' });
    assert.equal(finalized.state.rounds[0].phase, 'Finalized');
    const evidence = await (await fetch(`${base}/api/rounds/round-1/evidence`)).json();
    assert.equal(keccak256(toUtf8Bytes(evidence.canonical)), evidence.hash);
    await post('score', { role: 'maintainer', contributionId: 'pr-142' }, 400);
    const claim = await post('claim', { role: 'sam' });
    assert.ok(Number(claim.state.rounds[0].paid) > 0);
    await post('claim', { role: 'sam' }, 400);
    const badOrigin = await fetch(`${base}/api/rounds/round-1/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify({ role: 'maya' }) });
    assert.equal(badOrigin.status, 403);
  } finally { await app.close(); }
});
