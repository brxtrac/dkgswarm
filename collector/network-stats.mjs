const DASHBOARD_UUID = "b933de89-fc08-4dc5-824f-d53e8c8f94c3";
const OTHUB = "https://othub.io";
const STAKING = "https://staking.origintrail.io";
const CMC = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?slug=origintrail";
const TTL_MS = 15 * 60 * 1000;
const YEAR_SEC = 365.25 * 86400;
const WAD = 10n ** 18n;
const MAX_LOCK = 6n;
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const SHARD = 1n;

const CHAINS = [
  {
    chain: "Base",
    rpc: "https://base-rpc.publicnode.com",
    hub: "0x99Aa571fD5e681c2D27ee08A7b7989DB02541d13",
    floor: 60,
  },
  {
    chain: "Gnosis",
    rpc: "https://rpc.gnosischain.com",
    hub: "0x882D0BF07F956b1b94BBfe9E77F47c6fc7D4EC8f",
    floor: 62,
  },
];

const CARDS = {
  stake: [318, 90],
  assets: [317, 88],
  earnings: [329, 87],
  lastEpoch: [330, 84],
  currentEpoch: [331, 85],
  passedEpochs: [332, 96],
  price: [333, 101],
  spent1y: [335, 105],
  spent24h: [477, 145],
  epoch: [315, 51],
  supply: [321, 95],
  epochEnds: [470, 79],
  nodes: [63, 50],
  graphs: [742, 233],
};

const HUB_ABI = [{ type: "function", name: "getAllContracts", stateMutability: "view", inputs: [], outputs: [{ type: "tuple[]", components: [{ name: "name", type: "string" }, { name: "addr", type: "address" }] }] }];
const LAST_ID_ABI = [{ type: "function", name: "lastIdentityId", stateMutability: "view", inputs: [], outputs: [{ type: "uint72" }] }];
const EPOCH_ABI = [{ type: "function", name: "getCurrentEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
const LENGTH_ABI = [{ type: "function", name: "epochLength", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
const NAME_ABI = [{ type: "function", name: "getName", stateMutability: "view", inputs: [{ type: "uint72" }], outputs: [{ type: "string" }] }];
const FEE_ABI = [{ type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ type: "uint72" }], outputs: [{ type: "uint16" }] }];
const SCORE_ABI = [{ type: "function", name: "calculateNodeScore", stateMutability: "view", inputs: [{ type: "uint72" }], outputs: [{ type: "uint256" }] }];
const STAKE_ABI = [{ type: "function", name: "getNodeEffectiveStake", stateMutability: "view", inputs: [{ type: "uint72" }], outputs: [{ type: "uint256" }] }];
const POOL_ABI = [{ type: "function", name: "getEpochPool", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint96" }] }];
const RANGE_ABI = [{ type: "function", name: "getEpochRangePool", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint96" }] }];
const COUNT_ABI = [{ type: "function", name: "nodesCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint72" }] }];
const INDEX_ABI = [{ type: "function", name: "indexToIdentityId", stateMutability: "view", inputs: [{ type: "uint72" }], outputs: [{ type: "uint72" }] }];
const MULTI_ABI = [{ type: "function", name: "aggregate3", stateMutability: "view", inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }], outputs: [{ type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }] }];

export function createNetworkStats({
  fetchImpl = fetch,
  now = () => Date.now(),
  log = console,
  readChain = readChainYield,
} = {}) {
  let cache = null;
  let expiresAt = 0;
  let inflight = null;

  async function card(dashcardId, cardId) {
    const url = `${OTHUB}/api/public/dashboard/${DASHBOARD_UUID}/dashcard/${dashcardId}/card/${cardId}/json`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ parameters: [] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`othub ${dashcardId}/${cardId} ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body) || !body.length) throw new Error(`othub ${dashcardId}/${cardId} empty`);
    return body;
  }

  async function market() {
    const response = await fetchImpl(CMC, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`cmc ${response.status}`);
    const body = await response.json();
    const stats = body?.data?.statistics;
    if (!stats) throw new Error("cmc statistics missing");
    return {
      rank: num(stats.rank),
      marketCapUsd: num(stats.marketCap),
      change1hPct: num(stats.priceChangePercentage1h),
      change24hPct: num(stats.priceChangePercentage24h),
      change7dPct: num(stats.priceChangePercentage7d),
      change30dPct: num(stats.priceChangePercentage30d),
      change1yPct: num(stats.priceChangePercentage1y),
    };
  }

  function num(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function field(row, pattern) {
    const key = Object.keys(row).find((name) => pattern.test(name));
    return key ? row[key] : undefined;
  }

  function scalar(rows, pattern) {
    return num(field(rows[0], pattern));
  }

  function snapshot(parts, quote, apr) {
    const stake = parts.stake[0];
    const earnings = parts.earnings[0];
    const lastEpoch = parts.lastEpoch[0];
    const currentEpoch = parts.currentEpoch[0];
    const passed = parts.passedEpochs[0];
    const supply = parts.supply[0];
    const nodes = parts.nodes.filter((row) => num(row.stake) > 0);
    const graphs = parts.graphs.filter((row) => row.context_graph_active === "active");
    return {
      asOf: new Date(now()).toISOString(),
      sources: {
        othub: `${OTHUB}/dashboard/${DASHBOARD_UUID}`,
        staking: STAKING,
        coinmarketcap: "https://coinmarketcap.com/currencies/origintrail/",
      },
      note: "Figures are public othub.io aggregates plus CoinMarketCap TRAC quotes. maxDelegatorAprPct is the highest Annualized Node Yield high end on staking.origintrail.io: the node's score share of the 12-epoch scheduled reward pool, after operator fee, over effective stake, times the 365-day lock multiplier of 6. It is the top of that node's displayed range, not a realized payout. aprNode and aprChain name that node. stakedNodes counts sharding-table nodes on Base and Gnosis.",
      priceUsd: scalar(parts.price, /trac_price/),
      market: quote,
      totalStakeTrac: num(field(stake, /stakeTRAC/)),
      totalStakeUsd: num(field(stake, /stakeUSD/)),
      verifiedAssets: scalar(parts.assets, /^sum$/i),
      earnings: {
        allTimeTrac: num(earnings.sum),
        allTimeUsd: num(field(earnings, /sum_2/)),
        lastEpochTrac: num(field(lastEpoch, /TRAC/)),
        lastEpochUsd: num(field(lastEpoch, /USD/)),
        currentEpochTrac: num(field(currentEpoch, /TRAC/)),
        currentEpochUsd: num(field(currentEpoch, /USD/)),
        passedEpochsTrac: num(field(passed, /TRAC/)),
        passedEpochsUsd: num(field(passed, /USD/)),
      },
      spend: {
        last24hTrac: num(parts.spent24h[0].TRAC),
        last24hUsd: num(parts.spent24h[0].USD),
        last365dTrac: num(parts.spent1y[0].sum),
        last365dUsd: num(field(parts.spent1y[0], /sum_2/)),
      },
      epoch: scalar(parts.epoch, /^max$/i),
      epochEndsIn: String(field(parts.epochEnds[0], /Till Next Epoch/i) ?? ""),
      supply: {
        circulating: num(field(supply, /circ_supply/i)),
        total: num(field(supply, /total_supply/i)),
      },
      nodes: { publishingStake: nodes.length },
      stakedNodes: apr.stakedNodes,
      maxDelegatorAprPct: apr.maxPct,
      aprNode: apr.node,
      aprChain: apr.chain,
      contextGraphs: {
        active: graphs.length,
        knowledgeAssets: graphs.reduce((sum, row) => sum + (num(row.ka_total) || 0), 0),
        tracSpent: graphs.reduce((sum, row) => sum + (num(row.trac_spent) || 0), 0),
      },
    };
  }

  function requireSnapshot(value) {
    if (!Number.isFinite(value.priceUsd) || value.priceUsd <= 0) throw new Error("price missing");
    if (!Number.isFinite(value.totalStakeTrac) || value.totalStakeTrac <= 0) throw new Error("stake missing");
    if (!Number.isFinite(value.earnings.allTimeTrac)) throw new Error("earnings missing");
    if (!Number.isFinite(value.maxDelegatorAprPct) || value.maxDelegatorAprPct <= 0) throw new Error("apr missing");
    if (typeof value.aprNode !== "string" || value.aprNode === "" || typeof value.aprChain !== "string" || value.aprChain === "") throw new Error("apr node missing");
    if (!Number.isFinite(value.market?.rank) || !Number.isFinite(value.market?.marketCapUsd)) throw new Error("market missing");
    return value;
  }

  async function refresh() {
    const [entries, quote, apr] = await Promise.all([
      Promise.all(Object.entries(CARDS).map(async ([name, ids]) => [name, await card(ids[0], ids[1])])),
      market(),
      readChain(),
    ]);
    const next = requireSnapshot(snapshot(Object.fromEntries(entries), quote, apr));
    cache = next;
    expiresAt = now() + TTL_MS;
    return next;
  }

  async function get() {
    if (cache && now() < expiresAt) return { ...cache, stale: false };
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    try {
      return { ...(await inflight), stale: false };
    } catch (error) {
      if (cache) {
        log.warn?.(`network stats refresh failed, serving cache: ${error.message}`);
        return { ...cache, stale: true };
      }
      throw error;
    }
  }

  return { get };
}

export function nodeRewardWei({ poolWei, nodeScore, totalScore, operatorFeeBps }) {
  if (poolWei <= 0n || nodeScore <= 0n || totalScore <= 0n) return 0n;
  const fee = BigInt(Math.max(0, Math.min(Number(operatorFeeBps), 10000)));
  return poolWei * nodeScore / totalScore * (10000n - fee) / 10000n;
}

export function annualizedYieldPct({ rewardWei, effectiveStakeWei, epochLengthSec, rewardEpochCount = 12 }) {
  if (effectiveStakeWei <= 0n || epochLengthSec <= 0n || rewardEpochCount <= 0) return null;
  const epochsPerYear = YEAR_SEC / Number(epochLengthSec);
  if (!Number.isFinite(epochsPerYear) || epochsPerYear <= 0) return null;
  const ratio = rewardWei * WAD / effectiveStakeWei;
  const unlocked = Number(ratio) / 1e18 * (epochsPerYear / rewardEpochCount) * 100;
  const locked = Number(ratio * MAX_LOCK) / 1e18 * (epochsPerYear / rewardEpochCount) * 100;
  return Number.isFinite(locked) ? { unlocked, locked } : null;
}

async function readChainYield() {
  const { createPublicClient, http, encodeFunctionData, decodeFunctionResult } = await import(
    "/usr/lib/node_modules/@origintrail-official/dkg/node_modules/viem/_esm/index.js"
  );
  const rows = [];
  for (const chain of CHAINS) {
    const client = createPublicClient({ transport: http(chain.rpc, { timeout: 20000 }) });
    const contracts = Object.fromEntries((await client.readContract({
      address: chain.hub, abi: HUB_ABI, functionName: "getAllContracts",
    })).map((row) => [row.name, row.addr]));
    const [last, epoch, length] = await Promise.all([
      client.readContract({ address: contracts.IdentityStorage, abi: LAST_ID_ABI, functionName: "lastIdentityId" }),
      client.readContract({ address: contracts.Chronos, abi: EPOCH_ABI, functionName: "getCurrentEpoch" }),
      client.readContract({ address: contracts.Chronos, abi: LENGTH_ABI, functionName: "epochLength" }),
    ]);
    const ids = [];
    for (let id = chain.floor; id <= Number(last); id += 1) ids.push(id);
    const names = await aggregate(client, encodeFunctionData, decodeFunctionResult, ids.map((id) => ({
      address: contracts.ProfileStorage, abi: NAME_ABI, functionName: "getName", args: [BigInt(id)],
    })));
    const named = ids.flatMap((id, index) => (
      typeof names[index] === "string" && names[index] !== "" ? [{ id, name: names[index] }] : []
    ));
    const [fees, scores, stakes, currentPool, rangePool, table] = await Promise.all([
      aggregate(client, encodeFunctionData, decodeFunctionResult, named.map(({ id }) => ({
        address: contracts.ProfileStorage, abi: FEE_ABI, functionName: "getOperatorFee", args: [BigInt(id)],
      }))),
      aggregate(client, encodeFunctionData, decodeFunctionResult, named.map(({ id }) => ({
        address: contracts.RandomSampling, abi: SCORE_ABI, functionName: "calculateNodeScore", args: [BigInt(id)],
      }))),
      aggregate(client, encodeFunctionData, decodeFunctionResult, named.map(({ id }) => ({
        address: contracts.ConvictionStakingStorage, abi: STAKE_ABI, functionName: "getNodeEffectiveStake", args: [BigInt(id)],
      }))),
      client.readContract({ address: contracts.EpochStorageV8, abi: POOL_ABI, functionName: "getEpochPool", args: [SHARD, epoch] }),
      client.readContract({
        address: contracts.EpochStorageV8, abi: RANGE_ABI, functionName: "getEpochRangePool",
        args: [SHARD, epoch, epoch + 11n],
      }).catch(() => null),
      shardingIds(client, contracts.ShardingTableStorage),
    ]);
    const pool = typeof rangePool === "bigint" ? rangePool : currentPool * 12n;
    const active = table ?? new Set(named.map(({ id }) => id));
    let totalScore = 0n;
    named.forEach(({ id }, index) => {
      if (!active.has(id)) return;
      const score = typeof scores[index] === "bigint" ? scores[index] : 0n;
      totalScore += score;
    });
    named.forEach(({ id, name }, index) => {
      if (!active.has(id)) return;
      const score = typeof scores[index] === "bigint" ? scores[index] : 0n;
      const stake = typeof stakes[index] === "bigint" ? stakes[index] : 0n;
      const fee = typeof fees[index] === "bigint" || typeof fees[index] === "number" ? fees[index] : 0;
      const reward = nodeRewardWei({ poolWei: pool, nodeScore: score, totalScore, operatorFeeBps: fee });
      const yieldPct = annualizedYieldPct({ rewardWei: reward, effectiveStakeWei: stake, epochLengthSec: length });
      if (yieldPct) rows.push({ maxPct: yieldPct.locked, node: name, chain: chain.chain });
    });
    rows.push({ stakedNodes: active.size });
  }
  const yields = rows.filter((row) => Number.isFinite(row.maxPct));
  if (!yields.length) throw new Error("apr missing");
  const best = yields.reduce((top, row) => (row.maxPct > top.maxPct ? row : top));
  const stakedNodes = rows.reduce((sum, row) => sum + (row.stakedNodes || 0), 0);
  if (stakedNodes <= 0) throw new Error("staked nodes missing");
  if (typeof best.node !== "string" || best.node === "" || typeof best.chain !== "string" || best.chain === "") throw new Error("apr node missing");
  return { maxPct: best.maxPct, stakedNodes, node: best.node, chain: best.chain };
}

async function shardingIds(client, address) {
  if (!address) return null;
  try {
    const count = Number(await client.readContract({ address, abi: COUNT_ABI, functionName: "nodesCount" }));
    if (!Number.isFinite(count) || count <= 0) return new Set();
    const ids = [];
    for (let index = 0; index < count; index += 1) ids.push(index);
    const mapped = await client.multicall({
      contracts: ids.map((index) => ({ address, abi: INDEX_ABI, functionName: "indexToIdentityId", args: [BigInt(index)] })),
      allowFailure: true,
    });
    const found = mapped.filter((row) => row.status === "success").map((row) => Number(row.result));
    return found.length ? new Set(found) : null;
  } catch {
    return null;
  }
}

async function aggregate(client, encodeFunctionData, decodeFunctionResult, calls) {
  const results = [];
  for (let index = 0; index < calls.length; index += 40) {
    const slice = calls.slice(index, index + 40);
    const packed = slice.map((call) => ({
      target: call.address,
      allowFailure: true,
      callData: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
    }));
    const rows = await client.readContract({ address: MULTICALL, abi: MULTI_ABI, functionName: "aggregate3", args: [packed] });
    results.push(...rows.map((row, rowIndex) => {
      if (!row.success || row.returnData === "0x") return null;
      try {
        return decodeFunctionResult({ abi: slice[rowIndex].abi, functionName: slice[rowIndex].functionName, data: row.returnData });
      } catch {
        return null;
      }
    }));
  }
  return results;
}
