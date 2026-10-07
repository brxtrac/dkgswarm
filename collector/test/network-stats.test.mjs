import test from "node:test";
import assert from "node:assert/strict";
import { annualizedYieldPct, createNetworkStats, nodeRewardWei } from "../network-stats.mjs";

function row(fields) {
  return fields;
}

function payload() {
  return {
    stake: [row({ "Sum of stakeTRAC": 1000, "Sum of stakeUSD": 380 })],
    assets: [row({ sum: 42 })],
    earnings: [row({ sum: 900, "sum_2 ($)": 300, pubs: 42 })],
    lastEpoch: [row({ "Sum of reward_budget_TRAC": 10, "Sum of reward_budget_USD": 4 })],
    currentEpoch: [row({ "Sum of reward_budget_TRAC": 11, "Sum of reward_budget_USD": 5 })],
    passedEpochs: [row({ "Sum of reward_budget_TRAC": 800, "Sum of reward_budget_USD": 250 })],
    price: [row({ "Sum of trac_price ($)": 0.38 })],
    spent1y: [row({ sum: 70, "sum_2 ($)": 20 })],
    spent24h: [row({ TRAC: 2, USD: 1 })],
    epoch: [row({ max: 21 })],
    supply: [row({ "Sum of circ_supply": 500, "Sum of total_supply": 500, "Sum of market_cap ($)": 190 })],
    epochEnds: [row({ "Max of Till Next Epoch": "6 days" })],
    nodes: [
      row({ chain: "Base", stake: 100, estimatedAPR30d: 0.01 }),
      row({ chain: "Base", stake: 0, estimatedAPR30d: 0.5 }),
      row({ chain: "Gnosis", stake: 300, estimatedAPR30d: null }),
      row({ chain: "Neuro", stake: 50, estimatedAPR30d: 0 }),
    ],
    graphs: [
      row({ context_graph_active: "active", ka_total: 10, trac_spent: 3 }),
      row({ context_graph_active: "inactive", ka_total: 99, trac_spent: 99 }),
    ],
  };
}

function market() {
  return {
    data: {
      statistics: {
        rank: 145,
        marketCap: 188235900.8,
        priceChangePercentage1h: -0.32,
        priceChangePercentage24h: 0.69,
        priceChangePercentage7d: 4.06,
        priceChangePercentage30d: 15.56,
        priceChangePercentage1y: 17.8,
      },
    },
  };
}

function cards() {
  return {
    90: payload().stake, 88: payload().assets, 87: payload().earnings, 84: payload().lastEpoch,
    85: payload().currentEpoch, 96: payload().passedEpochs, 101: payload().price, 105: payload().spent1y,
    145: payload().spent24h, 51: payload().epoch, 95: payload().supply, 79: payload().epochEnds,
    50: payload().nodes, 233: payload().graphs,
  };
}

test("annualizes a node's 12-epoch reward share at the 365-day lock", () => {
  const reward = nodeRewardWei({
    poolWei: 1_000_000n * 10n ** 18n,
    nodeScore: 40n,
    totalScore: 100n,
    operatorFeeBps: 1000,
  });
  assert.equal(reward, 360_000n * 10n ** 18n);
  const yieldPct = annualizedYieldPct({
    rewardWei: reward,
    effectiveStakeWei: 100_000n * 10n ** 18n,
    epochLengthSec: 2592000n,
  });
  assert.ok(Math.abs(yieldPct.unlocked - 365.25) < 0.001);
  assert.ok(Math.abs(yieldPct.locked - 2191.5) < 0.001);
});

test("normalizes othub cards, CMC quotes, and the highest chain APR", async () => {
  const calls = [];
  const stats = createNetworkStats({
    now: () => Date.parse("2026-09-30T00:00:00.000Z"),
    readChain: async () => ({ maxPct: 35.2, stakedNodes: 17, node: "Oliwav", chain: "Gnosis" }),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("coinmarketcap.com")) return { ok: true, json: async () => market() };
      const cardId = Number(url.match(/card\/(\d+)\/json/)[1]);
      return { ok: true, json: async () => cards()[cardId] };
    },
  });
  const snap = await stats.get();
  assert.equal(calls.length, 15);
  assert.equal(snap.priceUsd, 0.38);
  assert.equal(snap.totalStakeTrac, 1000);
  assert.equal(snap.verifiedAssets, 42);
  assert.equal(snap.nodes.publishingStake, 3);
  assert.equal(snap.maxDelegatorAprPct, 35.2);
  assert.equal(snap.stakedNodes, 17);
  assert.equal(snap.aprNode, "Oliwav");
  assert.equal(snap.aprChain, "Gnosis");
  assert.equal(snap.market.rank, 145);
  assert.equal(snap.market.marketCapUsd, 188235900.8);
  assert.equal(snap.market.change30dPct, 15.56);
  assert.equal(snap.contextGraphs.active, 1);
  assert.equal(snap.contextGraphs.knowledgeAssets, 10);
  assert.equal(snap.epochEndsIn, "6 days");
  assert.equal(snap.chains, undefined);
  assert.equal(snap.stale, false);
  const cached = await stats.get();
  assert.equal(calls.length, 15);
  assert.equal(cached.priceUsd, 0.38);
});

test("serves last good snapshot when refresh fails", async () => {
  let current = 0;
  let fail = false;
  const bodies = cards();
  const stats = createNetworkStats({
    now: () => current,
    readChain: async () => ({ maxPct: 8, stakedNodes: 17, node: "Oliwav", chain: "Gnosis" }),
    fetchImpl: async (url) => {
      if (fail) return { ok: false, status: 503, json: async () => [] };
      if (url.includes("coinmarketcap.com")) return { ok: true, json: async () => market() };
      return { ok: true, json: async () => bodies[Number(url.match(/card\/(\d+)\/json/)[1])] };
    },
  });
  const first = await stats.get();
  assert.equal(first.stale, false);
  current = 16 * 60 * 1000;
  fail = true;
  const second = await stats.get();
  assert.equal(second.stale, true);
  assert.equal(second.priceUsd, 0.38);
});

test("rejects a snapshot with no price", async () => {
  const broken = payload();
  broken.price = [{ "Sum of trac_price ($)": null }];
  const bodies = cards();
  bodies[101] = broken.price;
  const stats = createNetworkStats({
    readChain: async () => ({ maxPct: 8, stakedNodes: 17, node: "Oliwav", chain: "Gnosis" }),
    fetchImpl: async (url) => {
      if (url.includes("coinmarketcap.com")) return { ok: true, json: async () => market() };
      return { ok: true, json: async () => bodies[Number(url.match(/card\/(\d+)\/json/)[1])] };
    },
  });
  await assert.rejects(() => stats.get(), /price missing/);
});
