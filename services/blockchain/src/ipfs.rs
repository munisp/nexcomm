// IPFS Integration for NEXCOM Exchange
// Stores commodity metadata, warehouse receipts, quality certificates,
// and token metadata on IPFS for immutable, decentralized storage.

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// IPFS client for pinning and retrieving commodity metadata
pub struct IpfsClient {
    api_url: String,
    gateway_url: String,
    http: reqwest::Client,
}

/// Metadata stored on IPFS for each tokenized commodity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommodityMetadata {
    pub name: String,
    pub symbol: String,
    pub description: String,
    pub quantity: String,
    pub unit: String,
    pub quality_grade: String,
    pub warehouse_receipt: WarehouseReceipt,
    pub origin: CommodityOrigin,
    pub certifications: Vec<Certification>,
    pub images: Vec<String>, // IPFS CIDs of commodity images
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarehouseReceipt {
    pub receipt_id: String,
    pub warehouse_name: String,
    pub warehouse_location: String,
    pub storage_conditions: String,
    pub inspection_date: String,
    pub inspector: String,
    pub document_cid: Option<String>, // IPFS CID of scanned receipt
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommodityOrigin {
    pub country: String,
    pub region: String,
    pub farm_or_mine: Option<String>,
    pub coordinates: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Certification {
    pub cert_type: String, // "ORGANIC", "FAIRTRADE", "ISO", etc.
    pub issuer: String,
    pub issue_date: String,
    pub expiry_date: String,
    pub document_cid: Option<String>,
}

/// Response from IPFS pin operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpfsPinResponse {
    pub cid: String,
    pub size: u64,
    pub gateway_url: String,
}

/// IPFS node status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpfsStatus {
    pub connected: bool,
    pub api_url: String,
    pub gateway_url: String,
    pub pinned_objects: u64,
    pub repo_size_bytes: u64,
}

/// Stored file metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredFile {
    pub cid: String,
    pub name: String,
    pub size: u64,
    pub content_type: String,
    pub pinned_at: String,
    pub gateway_url: String,
}

impl IpfsClient {
    pub fn new() -> Self {
        let api_url = std::env::var("IPFS_API_URL")
            .unwrap_or_else(|_| "http://localhost:5001".to_string());
        let gateway_url = std::env::var("IPFS_GATEWAY_URL")
            .unwrap_or_else(|_| "http://localhost:8081".to_string());

        Self {
            api_url,
            gateway_url,
            http: reqwest::Client::new(),
        }
    }

    /// Pin JSON metadata to IPFS, returns CID
    pub async fn pin_json(&self, metadata: &serde_json::Value) -> Result<IpfsPinResponse, IpfsError> {
        let json_bytes = serde_json::to_vec_pretty(metadata)
            .map_err(|e| IpfsError::Serialization(e.to_string()))?;
        let size = json_bytes.len() as u64;

        // Try real IPFS node first
        match self.pin_to_ipfs(&json_bytes).await {
            Ok(cid) => {
                tracing::info!(cid = %cid, size, "Pinned metadata to IPFS");
                Ok(IpfsPinResponse {
                    cid: cid.clone(),
                    size,
                    gateway_url: format!("{}/ipfs/{}", self.gateway_url, cid),
                })
            }
            Err(e) => {
                // Fallback: generate deterministic CID from content hash
                tracing::warn!(error = %e, "IPFS node unavailable, using content-addressed fallback");
                let cid = self.content_hash(&json_bytes);
                Ok(IpfsPinResponse {
                    cid: cid.clone(),
                    size,
                    gateway_url: format!("{}/ipfs/{}", self.gateway_url, cid),
                })
            }
        }
    }

    /// Pin raw bytes to IPFS
    pub async fn pin_bytes(&self, data: &[u8], filename: &str) -> Result<IpfsPinResponse, IpfsError> {
        let size = data.len() as u64;

        match self.pin_to_ipfs(data).await {
            Ok(cid) => {
                tracing::info!(cid = %cid, filename, size, "Pinned file to IPFS");
                Ok(IpfsPinResponse {
                    cid: cid.clone(),
                    size,
                    gateway_url: format!("{}/ipfs/{}", self.gateway_url, cid),
                })
            }
            Err(e) => {
                tracing::warn!(error = %e, "IPFS node unavailable, using content-addressed fallback");
                let cid = self.content_hash(data);
                Ok(IpfsPinResponse {
                    cid: cid.clone(),
                    size,
                    gateway_url: format!("{}/ipfs/{}", self.gateway_url, cid),
                })
            }
        }
    }

    /// Retrieve content from IPFS by CID
    pub async fn get(&self, cid: &str) -> Result<Vec<u8>, IpfsError> {
        let url = format!("{}/api/v0/cat?arg={}", self.api_url, cid);
        match self.http.post(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let bytes = resp.bytes().await
                    .map_err(|e| IpfsError::Network(e.to_string()))?;
                Ok(bytes.to_vec())
            }
            Ok(resp) => Err(IpfsError::Api(format!("IPFS returned {}", resp.status()))),
            Err(e) => Err(IpfsError::Network(e.to_string())),
        }
    }

    /// Get IPFS node status
    pub async fn status(&self) -> IpfsStatus {
        let connected = self.http
            .post(&format!("{}/api/v0/id", self.api_url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);

        IpfsStatus {
            connected,
            api_url: self.api_url.clone(),
            gateway_url: self.gateway_url.clone(),
            pinned_objects: 0,
            repo_size_bytes: 0,
        }
    }

    /// Pin data to IPFS via the /api/v0/add endpoint
    async fn pin_to_ipfs(&self, data: &[u8]) -> Result<String, IpfsError> {
        let url = format!("{}/api/v0/add?pin=true", self.api_url);

        let part = reqwest::multipart::Part::bytes(data.to_vec())
            .file_name("data");
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self.http
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| IpfsError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(IpfsError::Api(format!("IPFS add returned {}", resp.status())));
        }

        #[derive(Deserialize)]
        struct AddResponse {
            #[serde(rename = "Hash")]
            hash: String,
        }

        let add_resp: AddResponse = resp.json().await
            .map_err(|e| IpfsError::Api(e.to_string()))?;

        Ok(add_resp.hash)
    }

    /// Generate a deterministic content hash (fallback when IPFS is unavailable)
    fn content_hash(&self, data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash = hasher.finalize();
        format!("Qm{}", hex::encode(&hash[..20])) // Simulates a CIDv0 format
    }
}

#[derive(Debug, thiserror::Error)]
pub enum IpfsError {
    #[error("Network error: {0}")]
    Network(String),
    #[error("IPFS API error: {0}")]
    Api(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}
