# Signet Ubuntu Indexer Migration

Purpose: move the ALKANES signet indexing stack off the Windows laptop and onto the older Ubuntu laptop while keeping `bitcoind -signet -txindex` native on Ubuntu.

## Target Layout

- Ubuntu laptop:
  - native `bitcoind -signet -txindex`
  - Docker Engine services for `metashrew`, `memshrew`, `ord`, and `alkanes-jsonrpc`
  - optional Docker profile for `postgres`, `redis`, `alkanes-contract-indexer`, and `alkanes-data-api`
- Windows laptop:
  - VS Code and app/backend only, or no runtime services at all

## Why This Layout

- Docker Engine on Ubuntu is lighter than Docker Desktop on Windows.
- Keeping `bitcoind` native avoids nested storage overhead and simplifies wallet/node inspection.
- The Dockerized indexer services still match the repo's existing build and runtime assumptions.

## Ubuntu Prerequisites

Install Docker Engine plus the Compose plugin on Ubuntu.

Native `bitcoind` must allow the local Docker bridge to reach both RPC and signet P2P.

Minimum effective `bitcoin.conf` shape:

```ini
signet=1
server=1
txindex=1
rpcuser=alkanesrpc
rpcpassword=choose-a-strong-password
rpcbind=0.0.0.0
rpcallowip=172.17.0.0/16
listen=1
bind=0.0.0.0
fallbackfee=0.00001
```

Notes:

- `rpcallowip=172.17.0.0/16` is the common Docker bridge subnet on Ubuntu. If your Docker bridge uses a different subnet, adjust it.
- `host.docker.internal` is provided to the containers through `host-gateway` in the compose file.
- In `signet-ubuntu-local.env`, `HOST_SIGNET_RPC_HOSTPORT` must point at the native Ubuntu host bitcoind RPC endpoint, typically `host.docker.internal:38332`. Do not use `127.0.0.1:38332` there unless bitcoind is running inside the same container.
- If you do not want RPC reachable off-host, keep host firewall rules tight and only allow the Docker bridge.

## Files Added For Ubuntu Runtime

- `docker-compose.signet-ubuntu-local.yaml`
- `signet-ubuntu-local.env.example`

Copy the env template on Ubuntu:

```bash
cp signet-ubuntu-local.env.example signet-ubuntu-local.env
```

Then set the real RPC password in `signet-ubuntu-local.env`.

## Start The Core Indexer Stack On Ubuntu

From the repo root on Ubuntu:

```bash
docker compose --env-file signet-ubuntu-local.env -f docker-compose.signet-ubuntu-local.yaml up -d --build metashrew memshrew ord jsonrpc
```

This brings up the signet indexing stack without moving `bitcoind` into Docker.

## Optional Full Data/API Stack

If you also want the contract indexer and data API on Ubuntu:

```bash
docker compose --env-file signet-ubuntu-local.env -f docker-compose.signet-ubuntu-local.yaml --profile data-api up -d postgres redis alkanes-contract-indexer alkanes-data-api
```

## Verification

Check service status:

```bash
docker compose --env-file signet-ubuntu-local.env -f docker-compose.signet-ubuntu-local.yaml ps
```

Check the JSON-RPC proxy:

```bash
curl -s http://127.0.0.1:18888 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"btc_getblockcount","params":[]}'
```

Check the RPC endpoint wiring inside the Metashrew container:

```bash
docker compose --env-file signet-ubuntu-local.env -f docker-compose.signet-ubuntu-local.yaml exec metashrew sh -lc 'printf "%s\n" "$DAEMON_RPC_ADDR"'
```

Expected value:

```text
http://host.docker.internal:38332
```

If you see `127.0.0.1:38332` there while bitcoind is native on Ubuntu, Metashrew is pointed at the wrong endpoint.

Check Metashrew:

```bash
curl -s http://127.0.0.1:8080 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"metashrew_height","params":[]}'
```

Healthy behavior after the endpoint is fixed: `metashrew_height` should steadily climb toward the host `btc_getblockcount` value. If `btc_getblockcount` is correct but `metashrew_height` stays very low for a long time, inspect the Metashrew logs before retrying claim settlement.

## Repoint Engine Miner If Backend Stays On Windows

If the Engine miner backend remains on the Windows laptop, point it at the Ubuntu laptop IP:

- `SUBFROST_JSONRPC_URL=http://OLD_UBUNTU_IP:18888`
- `ENGINE_MINER_ALKANES_RPC_URL=http://OLD_UBUNTU_IP:8080`

Keep the settlement builder on public Signet Esplora unless you later decide to self-host electrs.

## If Ubuntu Is Too Slow To Build Images

Do not build there first.

Build the images on the stronger machine once, then move them:

```bash
docker save rockshrew:alkanes memshrew:alkanes ord:alkanes alkanes-jsonrpc:latest | gzip > signet-indexer-images.tar.gz
```

On Ubuntu:

```bash
gunzip -c signet-indexer-images.tar.gz | docker load
```

Then start the compose stack without paying the Rust build cost on the old laptop.