// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/**
 * @title NEXCOM Settlement Escrow
 * @notice Escrow contract for T+0 atomic settlement of commodity trades.
 * Holds tokens and funds during the settlement window and executes
 * atomic delivery-versus-payment (DvP) when both sides are confirmed.
 */
contract SettlementEscrow is AccessControl, Pausable, ReentrancyGuard, ERC1155Holder {
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");

    enum EscrowStatus {
        Created,
        BuyerFunded,
        SellerDeposited,
        Settled,
        Cancelled,
        Disputed
    }

    struct Escrow {
        string tradeId;
        address buyer;
        address seller;
        address tokenContract;
        uint256 tokenId;
        uint256 tokenAmount;
        uint256 paymentAmount;      // In wei
        EscrowStatus status;
        uint256 createdAt;
        uint256 expiresAt;          // Auto-cancel after this time
        uint256 settledAt;
    }

    // Escrow ID => Escrow details
    mapping(bytes32 => Escrow) public escrows;

    // Track buyer deposits
    mapping(bytes32 => uint256) public buyerDeposits;

    // Settlement timeout (default 1 hour for T+0)
    uint256 public settlementTimeout = 1 hours;

    // Events
    event EscrowCreated(bytes32 indexed escrowId, string tradeId, address buyer, address seller);
    event BuyerFunded(bytes32 indexed escrowId, uint256 amount);
    event SellerDeposited(bytes32 indexed escrowId, uint256 tokenId, uint256 amount);
    event EscrowSettled(bytes32 indexed escrowId, string tradeId);
    event EscrowCancelled(bytes32 indexed escrowId, string reason);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTLEMENT_ROLE, msg.sender);
    }

    /**
     * @notice Create a new escrow for a trade
     */
    function createEscrow(
        string calldata tradeId,
        address buyer,
        address seller,
        address tokenContract,
        uint256 tokenId,
        uint256 tokenAmount,
        uint256 paymentAmount
    ) external onlyRole(SETTLEMENT_ROLE) whenNotPaused returns (bytes32) {
        bytes32 escrowId = keccak256(abi.encodePacked(tradeId, block.timestamp));

        require(escrows[escrowId].createdAt == 0, "Escrow already exists");

        escrows[escrowId] = Escrow({
            tradeId: tradeId,
            buyer: buyer,
            seller: seller,
            tokenContract: tokenContract,
            tokenId: tokenId,
            tokenAmount: tokenAmount,
            paymentAmount: paymentAmount,
            status: EscrowStatus.Created,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + settlementTimeout,
            settledAt: 0
        });

        emit EscrowCreated(escrowId, tradeId, buyer, seller);
        return escrowId;
    }

    /**
     * @notice Buyer deposits payment into escrow
     */
    function fundEscrow(bytes32 escrowId) external payable nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.createdAt > 0, "Escrow not found");
        require(msg.sender == escrow.buyer, "Not the buyer");
        require(escrow.status == EscrowStatus.Created || escrow.status == EscrowStatus.SellerDeposited, "Invalid status");
        require(msg.value == escrow.paymentAmount, "Incorrect payment amount");
        require(block.timestamp < escrow.expiresAt, "Escrow expired");

        buyerDeposits[escrowId] = msg.value;

        if (escrow.status == EscrowStatus.SellerDeposited) {
            // Both sides ready, execute settlement
            _settle(escrowId);
        } else {
            escrow.status = EscrowStatus.BuyerFunded;
            emit BuyerFunded(escrowId, msg.value);
        }
    }

    /**
     * @notice Seller deposits commodity tokens into escrow
     */
    function depositTokens(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.createdAt > 0, "Escrow not found");
        require(msg.sender == escrow.seller, "Not the seller");
        require(escrow.status == EscrowStatus.Created || escrow.status == EscrowStatus.BuyerFunded, "Invalid status");
        require(block.timestamp < escrow.expiresAt, "Escrow expired");

        // Transfer tokens to escrow
        IERC1155(escrow.tokenContract).safeTransferFrom(
            msg.sender,
            address(this),
            escrow.tokenId,
            escrow.tokenAmount,
            ""
        );

        if (escrow.status == EscrowStatus.BuyerFunded) {
            // Both sides ready, execute settlement
            _settle(escrowId);
        } else {
            escrow.status = EscrowStatus.SellerDeposited;
            emit SellerDeposited(escrowId, escrow.tokenId, escrow.tokenAmount);
        }
    }

    /**
     * @notice Cancel an expired or disputed escrow
     */
    function cancelEscrow(bytes32 escrowId, string calldata reason) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.createdAt > 0, "Escrow not found");
        require(
            hasRole(SETTLEMENT_ROLE, msg.sender) || block.timestamp >= escrow.expiresAt,
            "Not authorized or not expired"
        );
        require(escrow.status != EscrowStatus.Settled, "Already settled");

        escrow.status = EscrowStatus.Cancelled;

        // Refund buyer
        if (buyerDeposits[escrowId] > 0) {
            uint256 refund = buyerDeposits[escrowId];
            buyerDeposits[escrowId] = 0;
            payable(escrow.buyer).transfer(refund);
        }

        // Return tokens to seller
        uint256 tokenBalance = IERC1155(escrow.tokenContract).balanceOf(
            address(this), escrow.tokenId
        );
        if (tokenBalance > 0) {
            IERC1155(escrow.tokenContract).safeTransferFrom(
                address(this),
                escrow.seller,
                escrow.tokenId,
                tokenBalance,
                ""
            );
        }

        emit EscrowCancelled(escrowId, reason);
    }

    /**
     * @notice Execute atomic DvP settlement
     */
    function _settle(bytes32 escrowId) internal {
        Escrow storage escrow = escrows[escrowId];

        // Transfer tokens to buyer
        IERC1155(escrow.tokenContract).safeTransferFrom(
            address(this),
            escrow.buyer,
            escrow.tokenId,
            escrow.tokenAmount,
            ""
        );

        // Transfer payment to seller
        uint256 payment = buyerDeposits[escrowId];
        buyerDeposits[escrowId] = 0;
        payable(escrow.seller).transfer(payment);

        escrow.status = EscrowStatus.Settled;
        escrow.settledAt = block.timestamp;

        emit EscrowSettled(escrowId, escrow.tradeId);
    }

    function setSettlementTimeout(uint256 timeout) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settlementTimeout = timeout;
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
        override(AccessControl, ERC1155Holder)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
