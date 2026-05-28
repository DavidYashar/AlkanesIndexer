import fs from 'node:fs';
import path from 'node:path';

function readEnvValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }

  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const envText = fs.readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === name) {
      return value;
    }
  }

  return undefined;
}

const apiKey = readEnvValue('SUBFROST_API_KEY');

if (!apiKey) {
  throw new Error('SUBFROST_API_KEY is missing from the environment or .env file.');
}

class AlkanesClient {
  constructor(apiKey, network = 'mainnet') {
    this.baseUrl = `https://${network}.subfrost.io/v4/api`;
    this.apiKey = apiKey;
  }

  async post(endpoint, body = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-subfrost-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      throw new Error(`Invalid JSON from ${endpoint}: ${rawText}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${endpoint}: ${rawText}`);
    }

    if (data.statusCode !== 200) {
      throw new Error(`${endpoint} failed: ${data.error || rawText}`);
    }

    return data.data;
  }

  async getAllAlkanes(limit = 50, offset = 0) {
    return this.post('/get-alkanes', { limit, offset });
  }

  async getAlkaneDetails(block, tx) {
    return this.post('/get-alkane-details', {
      alkaneId: { block: String(block), tx: String(tx) },
    });
  }

  async searchAlkanes(query) {
    return this.post('/global-alkanes-search', { query });
  }
}

function extractAlkaneId(entry) {
  const alkaneId = entry?.alkaneId || entry?.alkane_id || entry?.id;
  if (typeof alkaneId === 'string' && alkaneId.includes(':')) {
    const [block, tx] = alkaneId.split(':');
    return { block, tx };
  }

  if (alkaneId && alkaneId.block != null && alkaneId.tx != null) {
    return { block: alkaneId.block, tx: alkaneId.tx };
  }

  if (entry?.block != null && entry?.tx != null) {
    return { block: entry.block, tx: entry.tx };
  }

  return null;
}

async function callJsonRpc(network, method, params = []) {
  const response = await fetch(`https://${network}.subfrost.io/v4/jsonrpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-subfrost-api-key': apiKey,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${network}:${method}`,
      method,
      params,
    }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    throw new Error(`Invalid JSON from ${network} ${method}: ${rawText}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${network} ${method}: ${rawText}`);
  }

  if (data.error) {
    throw new Error(`${network} ${method} failed: ${JSON.stringify(data.error)}`);
  }

  return data.result;
}

function printResult(label, value) {
  const output = typeof value === 'string'
    ? value
    : JSON.stringify(value, (_, current) => typeof current === 'bigint' ? current.toString() : current, 2);
  console.log(`\n${label}`);
  console.log(output);
}

async function runRestSmoke(network) {
  const client = new AlkanesClient(apiKey, network);
  const list = await client.getAllAlkanes(3, 0);
  printResult(`[${network}] REST get-alkanes`, list);

  const firstEntry = Array.isArray(list?.items) ? list.items[0] : Array.isArray(list) ? list[0] : null;
  const alkaneId = firstEntry ? extractAlkaneId(firstEntry) : null;
  if (alkaneId) {
    const details = await client.getAlkaneDetails(alkaneId.block, alkaneId.tx);
    printResult(`[${network}] REST get-alkane-details ${alkaneId.block}:${alkaneId.tx}`, details);
  } else {
    console.log(`\n[${network}] REST get-alkane-details skipped (no alkane id in first result)`);
  }

  const search = await client.searchAlkanes('frBTC');
  printResult(`[${network}] REST global-alkanes-search frBTC`, search);
}

async function runJsonRpcSmoke(network) {
  const addressByNetwork = {
    mainnet: 'bc1p5lushqjk7kxpqa87ppwn0dealucyqa6t40ppdkhpqm3grcpqvw9s3wdsx7',
    signet: 'tb1qa4zwnrml2xkqjp9f7lcn96mdgsl4l2ew69x9vd',
  };

  const blockHeight = await callJsonRpc(network, 'btc_getblockcount');
  printResult(`[${network}] JSON-RPC btc_getblockcount`, blockHeight);

  const metashrewHeight = await callJsonRpc(network, 'metashrew_height');
  printResult(`[${network}] JSON-RPC metashrew_height`, metashrewHeight);

  const protorunes = await callJsonRpc(network, 'metashrew_view', [
    'protorunesbyaddress',
    {
      address: addressByNetwork[network],
      protocolTag: '1',
    },
    'latest',
  ]);
  printResult(`[${network}] JSON-RPC metashrew_view protorunesbyaddress`, protorunes);
}

async function runNetwork(network) {
  console.log(`\n=== ${network.toUpperCase()} ===`);

  try {
    await runRestSmoke(network);
  } catch (error) {
    console.error(`\n[${network}] REST smoke failed`);
    console.error(error instanceof Error ? error.message : error);
  }

  try {
    await runJsonRpcSmoke(network);
  } catch (error) {
    console.error(`\n[${network}] JSON-RPC smoke failed`);
    console.error(error instanceof Error ? error.message : error);
  }
}

await runNetwork('mainnet');
await runNetwork('signet');