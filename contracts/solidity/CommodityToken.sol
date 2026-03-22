// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NEXCOM Commodity Token
 * @notice ERC-1155 multi-token contract for commodity tokenization.
 * Each token ID represents a unique commodity lot backed by a warehouse receipt.
 * Supports fractional ownership and transfer restrictions for compliance.
 */
contract CommodityToken is ERC1155, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    struct CommodityLot {
        string symbol;           // e.g., "MAIZE", "GOLD"
        uint256 quantity;        // Total quantity in base units
        string unit;             // e.g., "MT" (metric tons), "OZ" (troy ounces)
        string warehouseReceipt; // Reference to physical warehouse receipt
        string qualityGrade;     // Quality certification grade
        uint256 expiryDate;      // Expiry timestamp (0 = no expiry)
        bool active;             // Whether the lot is active
        address issuer;          // Who created this lot
    }

    // Token ID => Commodity lot metadata
    mapping(uint256 => CommodityLot) public commodityLots;

    // Token ID => URI for off-chain metadata
    mapping(uint256 => string) private _tokenURIs;

    // KYC-verified addresses allowed to trade
    mapping(address => bool) public kycVerified;

    // Blacklisted addresses (sanctions, compliance)
    mapping(address => bool) public blacklisted;

    // Next token ID counter
    uint256 private _nextTokenId;

    // Events
    event CommodityMinted(
        uint256 indexed tokenId,
        string symbol,
        uint256 quantity,
        string warehouseReceipt,
        address indexed issuer
    );
    event CommodityRedeemed(uint256 indexed tokenId, address indexed redeemer, uint256 amount);
    event KYCStatusUpdated(address indexed account, bool verified);
    event BlacklistUpdated(address indexed account, bool blacklisted);

    constructor(string memory baseURI) ERC1155(baseURI) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(COMPLIANCE_ROLE, msg.sender);
        _nextTokenId = 1;
    }

    /**
     * @notice Mint new commodity tokens backed by a warehouse receipt
     * @param to Recipient address
     * @param symbol Commodity symbol
     * @param quantity Total quantity
     * @param unit Measurement unit
     * @param warehouseReceipt Warehouse receipt reference
     * @param qualityGrade Quality grade certification
     * @param expiryDate Token expiry timestamp (0 = no expiry)
     * @param tokenURI URI for token metadata
     */
    function mintCommodity(
        address to,
        string memory symbol,
        uint256 quantity,
        string memory unit,
        string memory warehouseReceipt,
        string memory qualityGrade,
        uint256 expiryDate,
        string memory tokenURI
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256) {
        require(kycVerified[to], "Recipient not KYC verified");
        require(!blacklisted[to], "Recipient is blacklisted");
        require(quantity > 0, "Quantity must be positive");

        uint256 tokenId = _nextTokenId++;

        commodityLots[tokenId] = CommodityLot({
            symbol: symbol,
            quantity: quantity,
            unit: unit,
            warehouseReceipt: warehouseReceipt,
            qualityGrade: qualityGrade,
            expiryDate: expiryDate,
            active: true,
            issuer: msg.sender
        });

        _tokenURIs[tokenId] = tokenURI;
        _mint(to, tokenId, quantity, "");

        emit CommodityMinted(tokenId, symbol, quantity, warehouseReceipt, msg.sender);
        return tokenId;
    }

    /**
     * @notice Redeem commodity tokens (claim physical delivery)
     * @param tokenId Token ID to redeem
     * @param amount Amount to redeem
     */
    function redeem(uint256 tokenId, uint256 amount) external whenNotPaused nonReentrant {
        require(commodityLots[tokenId].active, "Lot not active");
        require(balanceOf(msg.sender, tokenId) >= amount, "Insufficient balance");

        _burn(msg.sender, tokenId, amount);
        emit CommodityRedeemed(tokenId, msg.sender, amount);
    }

    /**
     * @notice Update KYC verification status for an address
     */
    function setKYCStatus(address account, bool verified) external onlyRole(COMPLIANCE_ROLE) {
        kycVerified[account] = verified;
        emit KYCStatusUpdated(account, verified);
    }

    /**
     * @notice Update blacklist status for an address
     */
    function setBlacklisted(address account, bool status) external onlyRole(COMPLIANCE_ROLE) {
        blacklisted[account] = status;
        emit BlacklistUpdated(account, status);
    }

    /**
     * @notice Batch update KYC status for multiple addresses
     */
    function batchSetKYCStatus(
        address[] calldata accounts,
        bool[] calldata statuses
    ) external onlyRole(COMPLIANCE_ROLE) {
        require(accounts.length == statuses.length, "Arrays length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            kycVerified[accounts[i]] = statuses[i];
            emit KYCStatusUpdated(accounts[i], statuses[i]);
        }
    }

    /**
     * @notice Get commodity lot details
     */
    function getLot(uint256 tokenId) external view returns (CommodityLot memory) {
        return commodityLots[tokenId];
    }

    /**
     * @notice Get token URI for metadata
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory tokenURI = _tokenURIs[tokenId];
        if (bytes(tokenURI).length > 0) {
            return tokenURI;
        }
        return super.uri(tokenId);
    }

    // Override transfer hooks for compliance checks
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override whenNotPaused {
        // Skip checks for minting (from == address(0)) and burning (to == address(0))
        if (from != address(0)) {
            require(!blacklisted[from], "Sender is blacklisted");
        }
        if (to != address(0)) {
            require(kycVerified[to], "Recipient not KYC verified");
            require(!blacklisted[to], "Recipient is blacklisted");
        }

        // Check lot expiry
        for (uint256 i = 0; i < ids.length; i++) {
            CommodityLot storage lot = commodityLots[ids[i]];
            if (lot.expiryDate > 0) {
                require(block.timestamp < lot.expiryDate, "Commodity lot expired");
            }
        }

        super._update(from, to, ids, values);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
