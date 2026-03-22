# NEXCOM Commodity Tokenization Chaincode

Hyperledger Fabric v2.x chaincode (Go) for commodity tokenization on the NEXCOM Exchange permissioned network.

## Functions

| Function | Caller | Description |
|---|---|---|
| `MintToken` | exchange-msp only | Create a new commodity token backed by a warehouse receipt |
| `TransferToken` | Token owner or exchange-msp | Transfer ownership to a new participant |
| `FractionalizeToken` | Token owner or exchange-msp | Split token into N equal fractions |
| `RedeemToken` | exchange-msp only | Burn token on physical commodity withdrawal |
| `LockToken` | exchange-msp only | Lock token during settlement or bridge transfer |
| `UnlockToken` | exchange-msp only | Release lock after settlement completes |
| `QueryToken` | Any enrolled participant | Read a single token by ID |
| `QueryTokensByOwner` | Any enrolled participant | List all tokens for a given owner |
| `QueryAllTokens` | Any enrolled participant | Paginated scan of all tokens |
| `GetHistory` | Any enrolled participant | Full audit trail for a token |
| `QueryFraction` | Any enrolled participant | Read a single fraction by ID |
| `TransferFraction` | Fraction owner or exchange-msp | Transfer a fraction to a new owner |

## State Model

```
TOKEN~{tokenId}              → CommodityToken JSON
OWNER~{ownerId}~{tokenId}    → "" (empty, used for range index)
FRACTION~{fractionId}        → FractionToken JSON
```

## Deployment (Fabric 2.x Lifecycle)

```bash
# 1. Package the chaincode
peer lifecycle chaincode package nexcom-commodity.tar.gz \
  --path ./chaincode/nexcom-commodity \
  --lang golang \
  --label nexcom-commodity_1.0

# 2. Install on each peer
peer lifecycle chaincode install nexcom-commodity.tar.gz

# 3. Approve for your org
peer lifecycle chaincode approveformyorg \
  --channelID nexcom-channel \
  --name nexcom-commodity \
  --version 1.0 \
  --package-id <PACKAGE_ID> \
  --sequence 1

# 4. Commit (after all required orgs have approved)
peer lifecycle chaincode commit \
  --channelID nexcom-channel \
  --name nexcom-commodity \
  --version 1.0 \
  --sequence 1

# 5. Invoke MintToken
peer chaincode invoke \
  -C nexcom-channel \
  -n nexcom-commodity \
  -c '{"function":"MintToken","Args":["TKN-MAIZE-001","MAIZE","500","MT","owner123","EWR-2024-001","Lagos Warehouse","Grade A","QmXxx..."]}'
```

## Environment Variables (External Chaincode / Kubernetes)

When running as an external chaincode service:

| Variable | Description |
|---|---|
| `CHAINCODE_SERVER_ADDRESS` | gRPC listen address, e.g. `0.0.0.0:9999` |
| `CORE_CHAINCODE_ID_NAME` | Package ID assigned by the peer |
| `CORE_PEER_TLS_ENABLED` | `true` in production |
| `CORE_PEER_TLS_ROOTCERT_FILE` | Path to peer TLS root CA |

## Integration with the Rust Blockchain Service

The Rust blockchain service (`services/blockchain`) proxies chaincode invocations via the Hyperledger Fabric Gateway SDK. The `chains.rs` module holds the peer gRPC URL (`HYPERLEDGER_PEER_URL`) and channel/chaincode names. When `chain: "hyperledger"` is passed to the `/tokenize` endpoint, the service routes the request to this chaincode instead of the EVM contracts.
