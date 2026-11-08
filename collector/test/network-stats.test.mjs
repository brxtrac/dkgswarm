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

function market(price = 0.46) {
  return {
    data: {
      statistics: {
        price,
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
    85: payload().currentEpoch, 96: payload().passedEpochs, 105: payload().spent1y,
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
   assert.equal(calls.length, 14);
  assert.equal(snap.priceUsd, 0.46);
  assert.notEqual(snap.priceUsd, payload().price[0]["Sum of trac_price ($)"]);
  assert.equal(calls.some((url) => /card\/101\/json/.test(url)), false);
  assert.equal(snap.market.priceUsd, 0.46);
  assert.equal(snap.priceAsOf, "2026-09-30T00:00:00.000Z");
  assert.equal(snap.market.asOf, snap.priceAsOf);
  assert.equal(snap.priceStale, false);
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
   assert.equal(calls.length, 14);
  assert.equal(cached.priceUsd, 0.46);
  assert.equal(cached.priceAsOf, snap.priceAsOf);
  assert.equal(cached.priceStale, false);
});

test("serves last good snapshot when refresh fails", async () => {
  let current = 0;
  let fail = false;
  const bodies = cards();
  const stats = createNetworkStats({
    now: () => current,
    readChain: async () => ({ maxPct: 8, stakedNodes: 17, node: "Oliwav", chain: "Gnosis" }),
    fetchImpl: async (url) => {
      if (url.includes("coinmarketcap.com")) return { ok: true, json: async () => market() };
      if (fail) return { ok: false, status: 503, json: async () => [] };
      return { ok: true, json: async () => bodies[Number(url.match(/card\/(\d+)\/json/)[1])] };
    },
  });
  const first = await stats.get();
  assert.equal(first.stale, false);
  current = 16 * 60 * 1000;
  fail = true;
  const second = await stats.get();
  assert.equal(second.stale, true);
  assert.equal(second.priceUsd, 0.46);
  assert.equal(second.asOf, first.asOf);
  assert.equal(second.priceAsOf, new Date(current).toISOString());
  assert.equal(second.priceStale, false);
});

function quoteFixture() {
  let current = Date.parse("2026-09-30T00:00:00.000Z");
  let quote = market();
  let quoteFailure = null;
  let quoteGate = null;
  let chainCalls = 0;
  const calls = [];
  const warnings = [];
  const bodies = cards();
  const stats = createNetworkStats({
    now: () => current,
    log: { warn: (message) => warnings.push(message) },
    readChain: async () => {
      chainCalls += 1;
      return { maxPct: 8, stakedNodes: 17, node: "Oliwav", chain: "Gnosis" };
    },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("coinmarketcap.com")) {
        if (quoteGate) await quoteGate;
        if (quoteFailure) throw quoteFailure;
        return { ok: true, json: async () => quote };
      }
      return { ok: true, json: async () => bodies[Number(url.match(/card\/(\d+)\/json/)[1])] };
    },
  });
  return {
    stats,
    calls,
    warnings,
    get current() { return current; },
    get chainCalls() { return chainCalls; },
    get quoteCalls() { return calls.filter((url) => url.includes("coinmarketcap.com")).length; },
    advance: (ms) => { current += ms; },
    setQuote: (value) => { quote = value; },
    failQuote: (error) => { quoteFailure = error; },
    holdQuote: (gate) => { quoteGate = gate; },
  };
}

test("refreshes quotes at exactly 60 seconds without refreshing the 15-minute network snapshot", async () => {
  const fixture = quoteFixture();
  const first = await fixture.stats.get();
  fixture.setQuote(market(0.52));
  fixture.advance(59_999);
  const cached = await fixture.stats.get();
  assert.equal(cached.priceUsd, 0.46);
  assert.equal(cached.priceAsOf, first.priceAsOf);
  assert.equal(fixture.calls.length, 14);

  fixture.advance(1);
  const refreshed = await fixture.stats.get();
  assert.equal(refreshed.priceUsd, 0.52);
  assert.equal(refreshed.market.priceUsd, 0.52);
  assert.equal(refreshed.priceAsOf, new Date(fixture.current).toISOString());
  assert.equal(refreshed.market.asOf, refreshed.priceAsOf);
  assert.equal(refreshed.asOf, first.asOf);
  assert.equal(refreshed.priceStale, false);
  assert.equal(refreshed.stale, false);
  assert.equal(fixture.calls.length, 15);
  assert.equal(fixture.chainCalls, 1);

  fixture.advance(14 * 60 * 1000 - 1);
  const beforeNetworkExpiry = await fixture.stats.get();
  assert.equal(beforeNetworkExpiry.asOf, first.asOf);
  assert.equal(fixture.calls.length, 16);
  assert.equal(fixture.chainCalls, 1);

  fixture.advance(1);
  const networkRefreshed = await fixture.stats.get();
  assert.equal(networkRefreshed.asOf, new Date(fixture.current).toISOString());
  assert.equal(networkRefreshed.priceAsOf, beforeNetworkExpiry.priceAsOf);
  assert.equal(fixture.calls.length, 29);
  assert.equal(fixture.quoteCalls, 3);
  assert.equal(fixture.chainCalls, 2);
});

test("shares one in-flight quote refresh among concurrent callers", async () => {
  const fixture = quoteFixture();
  const first = await fixture.stats.get();
  fixture.advance(60_000);
  fixture.setQuote(market(0.57));
  let release;
  fixture.holdQuote(new Promise((resolve) => { release = resolve; }));
  const pending = Array.from({ length: 8 }, () => fixture.stats.get());
  await Promise.resolve();
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.calls.length, 15);
  release();
  const results = await Promise.all(pending);
  for (const result of results) {
    assert.equal(result.priceUsd, 0.57);
    assert.equal(result.market.priceUsd, 0.57);
    assert.equal(result.priceAsOf, new Date(fixture.current).toISOString());
    assert.equal(result.asOf, first.asOf);
    assert.equal(result.priceStale, false);
    assert.equal(result.stale, false);
  }
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.chainCalls, 1);
  await fixture.stats.get();
  assert.equal(fixture.quoteCalls, 2);
});

test("preserves the last quote and timestamp on failure and recovers without refreshing network data", async () => {
  const fixture = quoteFixture();
  const first = await fixture.stats.get();
  fixture.advance(60_000);
  fixture.failQuote(new Error("quote unavailable"));
  const failed = await fixture.stats.get();
  assert.equal(failed.priceUsd, first.priceUsd);
  assert.equal(failed.priceAsOf, first.priceAsOf);
  assert.deepEqual(failed.market, first.market);
  assert.equal(failed.asOf, first.asOf);
  assert.equal(failed.priceStale, true);
  assert.equal(failed.stale, true);
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.warnings.length, 1);
  assert.match(fixture.warnings[0], /market refresh failed.*quote unavailable/);

  fixture.advance(1);
  const failedAgain = await fixture.stats.get();
  assert.equal(failedAgain.priceUsd, first.priceUsd);
  assert.equal(failedAgain.priceAsOf, first.priceAsOf);
  assert.equal(failedAgain.priceStale, true);
  assert.equal(failedAgain.stale, true);
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.warnings.length, 1);

  fixture.failQuote(null);
  fixture.setQuote(market(0.61));
  fixture.advance(59_998);
  const suppressed = await fixture.stats.get();
  assert.equal(suppressed.priceUsd, first.priceUsd);
  assert.equal(suppressed.priceAsOf, first.priceAsOf);
  assert.equal(suppressed.priceStale, true);
  assert.equal(suppressed.stale, true);
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.warnings.length, 1);

  fixture.advance(1);
  const recovered = await fixture.stats.get();
  assert.equal(recovered.priceUsd, 0.61);
  assert.equal(recovered.market.priceUsd, 0.61);
  assert.equal(recovered.priceAsOf, new Date(fixture.current).toISOString());
  assert.equal(recovered.market.asOf, recovered.priceAsOf);
  assert.equal(recovered.priceStale, false);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.asOf, first.asOf);
  assert.equal(fixture.quoteCalls, 3);
  assert.equal(fixture.chainCalls, 1);
  assert.equal(fixture.calls.length, 16);

  fixture.advance(59_999);
  const cached = await fixture.stats.get();
  assert.equal(cached.priceAsOf, recovered.priceAsOf);
  assert.equal(cached.priceUsd, recovered.priceUsd);
  assert.equal(cached.priceStale, false);
  assert.equal(fixture.quoteCalls, 3);
});

test("suppresses quote retries during a full snapshot refresh until the backoff expires", async () => {
  const fixture = quoteFixture();
  const first = await fixture.stats.get();
  fixture.advance(15 * 60 * 1000 - 1);
  fixture.failQuote(new Error("quote unavailable"));
  const failed = await fixture.stats.get();
  assert.equal(failed.priceStale, true);
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.chainCalls, 1);

  fixture.advance(1);
  const refreshed = await fixture.stats.get();
  assert.equal(refreshed.asOf, new Date(fixture.current).toISOString());
  assert.notEqual(refreshed.asOf, first.asOf);
  assert.equal(refreshed.priceUsd, first.priceUsd);
  assert.equal(refreshed.priceAsOf, first.priceAsOf);
  assert.deepEqual(refreshed.market, first.market);
  assert.equal(refreshed.priceStale, true);
  assert.equal(refreshed.stale, true);
  assert.equal(fixture.quoteCalls, 2);
  assert.equal(fixture.chainCalls, 2);
  assert.equal(fixture.calls.length, 28);
  assert.equal(fixture.warnings.length, 1);

  fixture.failQuote(null);
  fixture.setQuote(market(0.65));
  fixture.advance(59_998);
  const suppressed = await fixture.stats.get();
  assert.equal(suppressed.priceUsd, first.priceUsd);
  assert.equal(suppressed.priceAsOf, first.priceAsOf);
  assert.equal(suppressed.priceStale, true);
  assert.equal(suppressed.stale, true);
  assert.equal(fixture.quoteCalls, 2);

  fixture.advance(1);
  const recovered = await fixture.stats.get();
  assert.equal(recovered.priceUsd, 0.65);
  assert.equal(recovered.priceAsOf, new Date(fixture.current).toISOString());
  assert.equal(recovered.priceStale, false);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.asOf, refreshed.asOf);
  assert.equal(fixture.quoteCalls, 3);
  assert.equal(fixture.chainCalls, 2);
  assert.equal(fixture.calls.length, 29);
});

test("rejects invalid initial CMC prices rather than using the old othub price", async (t) => {
  for (const price of [undefined, null, "", 0, -0.46, "invalid", NaN, Infinity, -Infinity]) {
    await t.test(String(price), async () => {
      const fixture = quoteFixture();
      const quote = market();
      if (price === undefined) delete quote.data.statistics.price;
      else quote.data.statistics.price = price;
      fixture.setQuote(quote);
      await assert.rejects(() => fixture.stats.get(), /price missing/);
      assert.equal(fixture.quoteCalls, 1);
      assert.equal(fixture.calls.length, 14);
      assert.equal(fixture.calls.some((url) => /card\/101\/json/.test(url)), false);
      fixture.setQuote(market());
      const recovered = await fixture.stats.get();
      assert.equal(recovered.priceUsd, 0.46);
      assert.equal(recovered.priceStale, false);
      assert.equal(recovered.stale, false);
    });
  }
});

test("preserves the last valid quote when CMC returns an invalid refreshed price", async () => {
  const fixture = quoteFixture();
  const first = await fixture.stats.get();
  for (const price of [null, "", 0, -1, "invalid", Infinity]) {
    fixture.advance(60_000);
    fixture.setQuote(market(price));
    const stale = await fixture.stats.get();
    assert.equal(stale.priceUsd, first.priceUsd);
    assert.equal(stale.priceAsOf, first.priceAsOf);
    assert.deepEqual(stale.market, first.market);
    assert.equal(stale.asOf, first.asOf);
    assert.equal(stale.priceStale, true);
    assert.equal(stale.stale, true);
  }
  assert.equal(fixture.quoteCalls, 7);
  assert.equal(fixture.chainCalls, 1);
  fixture.setQuote(market(0.63));
  fixture.advance(60_000);
  const recovered = await fixture.stats.get();
  assert.equal(recovered.priceUsd, 0.63);
  assert.equal(recovered.priceAsOf, new Date(fixture.current).toISOString());
  assert.equal(recovered.priceStale, false);
  assert.equal(recovered.stale, false);
});
