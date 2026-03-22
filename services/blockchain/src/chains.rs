// Multi-chain abstraction layer
// Provides unified interface for Ethereum L1, Polygon L2, and Hyperledger Fabric.

use serde::{Deserialize, Serialize};

/// Supported blockchain networks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Chain {
    EthereumMainnet,
    Polygon,
    HyperledgerFabric,
}

/// Chain configuration
#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub chain: Chain,
    pub rpc_url: String,
    pub chain_id: u64,
    pub contract_address: String,
    pub confirmations_required: u32,
}

impl ChainConfig {
    pub fn ethereum() -> Self {
        Self {
            chain: Chain::EthereumMainnet,
            rpc_url: std::env::var("ETHEREUM_RPC_URL")
                .unwrap_or_else(|_| "http://localhost:8545".to_string()),
            chain_id: 1,
            contract_address: std::env::var("ETH_CONTRACT_ADDRESS")
                .unwrap_or_default(),
            confirmations_required: 12,
        }
    }

    pub fn polygon() -> Self {
        Self {
            chain: Chain::Polygon,
            rpc_url: std::env::var("POLYGON_RPC_URL")
                .unwrap_or_else(|_| "http://localhost:8546".to_string()),
            chain_id: 137,
            contract_address: std::env::var("POLYGON_CONTRACT_ADDRESS")
                .unwrap_or_default(),
            confirmations_required: 32,
        }
    }

    pub fn hyperledger() -> Self {
        Self {
            chain: Chain::HyperledgerFabric,
            rpc_url: std::env::var("HYPERLEDGER_PEER_URL")
                .unwrap_or_else(|_| "grpc://localhost:7051".to_string()),
            chain_id: 0,
            contract_address: "nexcom-chaincode".to_string(),
            confirmations_required: 1,
        }
    }
}

/// Transaction receipt from any chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionReceipt {
    pub tx_hash: String,
    pub block_number: u64,
    pub confirmations: u32,
    pub status: TransactionStatus,
    pub gas_used: Option<u64>,
    pub chain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransactionStatus {
    Pending,
    Confirmed,
    Failed,
    Reverted,
}
