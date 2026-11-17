import ganache from 'ganache';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { BrowserProvider, ContractFactory } from 'ethers';

export function compileRound() {
  const source = readFileSync(new URL('../contracts/FundingRound.sol', import.meta.url), 'utf8');
  const input = { language: 'Solidity', sources: { 'FundingRound.sol': { content: source } }, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter(x => x.severity === 'error');
  if (errors?.length) throw new Error(errors.map(x => x.formattedMessage).join('\n'));
  return output.contracts['FundingRound.sol'].FundingRound;
}
export async function createChain() {
  const rpc = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000 }, chain: { chainId: 1337, hardfork: 'shanghai' } });
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 50;
  const signers = await Promise.all(Array.from({ length: 8 }, (_, i) => provider.getSigner(i)));
  const artifact = compileRound();
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signers[0]);
  return { provider, signers, factory, rpc };
}
