// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title RemiWallet — Non-custodial smart contract wallet for Remi
/// @notice Session key auth + HTS precompile USDC transfers + spending limits
/// @dev Owner = Hedera native threshold key 2-of-3 (NOT Solidity multi-sig).
///      USDC uses HTS precompile at 0x167 — never raw ERC-20 transfer().
contract RemiWallet is Ownable {

    address constant HTS_PRECOMPILE = address(0x167);

    struct SessionKeyConfig {
        bool active;
        uint256 dailyLimitUsdc;     // 6-decimal units
        uint256 dailySpent;
        uint256 lastResetDay;       // block.timestamp / 86400
        uint256 expiresAt;
        uint256 registeredAt;
    }

    enum PaymentStatus { Pending, Confirmed, Failed, Expired }

    struct PaymentRequest {
        bytes32 requestId;
        address recipient;
        uint256 amountUsdc;
        PaymentStatus status;
        uint256 createdAt;
        uint256 confirmedAt;
        string tusGirosReference;
        string hederaTxId;
    }

    mapping(address => SessionKeyConfig) public sessionKeys;
    address[] public sessionKeyList;
    mapping(bytes32 => PaymentRequest) public paymentRequests;
    address public usdcTokenAddress;

    event SessionKeyRegistered(address indexed key, uint256 dailyLimit, uint256 expiresAt);
    event SessionKeyRevoked(address indexed key);
    event SessionKeyLimitUpdated(address indexed key, uint256 newLimit);
    event UsdcTransferred(address indexed sessionKey, address indexed to, uint256 amount, string memo);
    event PaymentRequestCreated(bytes32 indexed requestId, address indexed recipient, uint256 amountUsdc, uint256 expiresAt);
    event PaymentConfirmed(bytes32 indexed requestId, address indexed recipient, uint256 amountUsdc, string hederaTxId);
    event PaymentFailed(bytes32 indexed requestId, string reason);

    modifier onlyActiveSessionKey() {
        SessionKeyConfig storage sk = sessionKeys[msg.sender];
        require(sk.active, "RemiWallet: not an active session key");
        require(block.timestamp < sk.expiresAt, "RemiWallet: session key expired");
        _;
    }

    constructor(address _usdcTokenAddress) Ownable(msg.sender) {
        require(_usdcTokenAddress != address(0), "RemiWallet: zero USDC address");
        usdcTokenAddress = _usdcTokenAddress;
    }

    // ── Session Key Management (Owner = Threshold 2-of-3) ──────────────

    function registerSessionKey(
        address key,
        uint256 dailyLimitUsdc,
        uint256 expiresAt
    ) external onlyOwner {
        require(key != address(0), "RemiWallet: zero address");
        require(!sessionKeys[key].active, "RemiWallet: key already active");
        require(expiresAt > block.timestamp, "RemiWallet: already expired");
        require(dailyLimitUsdc > 0, "RemiWallet: zero limit");

        sessionKeys[key] = SessionKeyConfig({
            active: true,
            dailyLimitUsdc: dailyLimitUsdc,
            dailySpent: 0,
            lastResetDay: block.timestamp / 86400,
            expiresAt: expiresAt,
            registeredAt: block.timestamp
        });
        sessionKeyList.push(key);

        emit SessionKeyRegistered(key, dailyLimitUsdc, expiresAt);
    }

    function revokeSessionKey(address key) external onlyOwner {
        require(sessionKeys[key].active, "RemiWallet: key not active");
        sessionKeys[key].active = false;

        emit SessionKeyRevoked(key);
    }

    function updateSessionKeyLimit(address key, uint256 newLimit) external onlyOwner {
        require(sessionKeys[key].active, "RemiWallet: key not active");
        require(newLimit > 0, "RemiWallet: zero limit");
        sessionKeys[key].dailyLimitUsdc = newLimit;

        emit SessionKeyLimitUpdated(key, newLimit);
    }

    // ── USDC Transfer (Session Key — Data Plane) ───────────────────────

    function transferUsdc(
        address to,
        uint256 amount,
        string calldata memo
    ) external onlyActiveSessionKey {
        require(to != address(0), "RemiWallet: zero recipient");
        require(amount > 0, "RemiWallet: zero amount");

        SessionKeyConfig storage sk = sessionKeys[msg.sender];
        uint256 currentDay = block.timestamp / 86400;
        if (currentDay > sk.lastResetDay) {
            sk.dailySpent = 0;
            sk.lastResetDay = currentDay;
        }
        require(
            sk.dailySpent + amount <= sk.dailyLimitUsdc,
            "RemiWallet: daily limit exceeded"
        );
        sk.dailySpent += amount;

        // HTS precompile: transferToken(address token, address from, address to, int64 amount)
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSignature(
                "transferToken(address,address,address,int64)",
                usdcTokenAddress,
                address(this),
                to,
                int64(int256(amount))
            )
        );
        require(success, "RemiWallet: HTS call failed");

        int64 responseCode = abi.decode(result, (int64));
        require(responseCode == 22, "RemiWallet: HTS transfer failed");

        emit UsdcTransferred(msg.sender, to, amount, memo);
    }

    // ── Payment Requests ─────

    function createPaymentRequest(
        bytes32 requestId,
        address recipient,
        uint256 amountUsdc,
        uint256 expiresAt
    ) external onlyOwner {
        require(paymentRequests[requestId].createdAt == 0, "RemiWallet: duplicate ID");
        require(recipient != address(0), "RemiWallet: zero address");
        require(amountUsdc > 0, "RemiWallet: zero amount");

        paymentRequests[requestId] = PaymentRequest({
            requestId: requestId,
            recipient: recipient,
            amountUsdc: amountUsdc,
            status: PaymentStatus.Pending,
            createdAt: block.timestamp,
            confirmedAt: 0,
            tusGirosReference: "",
            hederaTxId: ""
        });

        emit PaymentRequestCreated(requestId, recipient, amountUsdc, expiresAt);
    }

    function confirmPayment(
        bytes32 requestId,
        string calldata tusGirosReference,
        string calldata hederaTxId
    ) external onlyOwner {
        PaymentRequest storage req = paymentRequests[requestId];
        require(req.createdAt != 0, "RemiWallet: not found");
        require(req.status == PaymentStatus.Pending, "RemiWallet: not pending");

        req.status = PaymentStatus.Confirmed;
        req.confirmedAt = block.timestamp;
        req.tusGirosReference = tusGirosReference;
        req.hederaTxId = hederaTxId;

        emit PaymentConfirmed(requestId, req.recipient, req.amountUsdc, hederaTxId);
    }

    function failPayment(
        bytes32 requestId,
        string calldata reason
    ) external onlyOwner {
        PaymentRequest storage req = paymentRequests[requestId];
        require(req.createdAt != 0, "RemiWallet: not found");
        require(req.status == PaymentStatus.Pending, "RemiWallet: not pending");

        req.status = PaymentStatus.Failed;

        emit PaymentFailed(requestId, reason);
    }

    // ── View Functions ─────────────────────────────────────────────────

    function getRequest(bytes32 requestId) external view returns (PaymentRequest memory) {
        return paymentRequests[requestId];
    }

    function getSessionKeyConfig(address key) external view returns (SessionKeyConfig memory) {
        return sessionKeys[key];
    }

    function isSessionKeyValid(address key) external view returns (bool) {
        return sessionKeys[key].active && block.timestamp < sessionKeys[key].expiresAt;
    }

    function getSessionKeyCount() external view returns (uint256) {
        return sessionKeyList.length;
    }

    function getRemainingDailyLimit(address key) external view returns (uint256) {
        SessionKeyConfig storage sk = sessionKeys[key];
        if (!sk.active || block.timestamp >= sk.expiresAt) return 0;

        uint256 spent = (block.timestamp / 86400 > sk.lastResetDay) ? 0 : sk.dailySpent;
        return sk.dailyLimitUsdc > spent ? sk.dailyLimitUsdc - spent : 0;
    }
}
