// SPDX-License-Identifier: MIT
// DEPRECATED: M1 state registry. Replaced by RemiWallet.sol in M2a. Kept for audit history.
pragma solidity ^0.8.20;

contract PaymentRegistry {
    address public owner;

    enum Status { Pending, Confirmed, Failed, Expired }

    struct PaymentRequest {
        bytes32 requestId;
        address recipient;
        uint256 amountUsdc;
        Status status;
        uint256 createdAt;
        uint256 confirmedAt;
        string tusGirosReference;
        string hederaTxId;
    }

    mapping(bytes32 => PaymentRequest) public requests;

    event PaymentRequestCreated(
        bytes32 indexed requestId,
        address indexed recipient,
        uint256 amountUsdc,
        uint256 expiresAt
    );
    event PaymentConfirmed(
        bytes32 indexed requestId,
        address indexed recipient,
        uint256 amountUsdc,
        string tusGirosReference,
        string hederaTxId
    );
    event PaymentFailed(bytes32 indexed requestId, string reason);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createPaymentRequest(
        bytes32 requestId,
        address recipient,
        uint256 amountUsdc,
        uint256 expiresAt
    ) external onlyOwner {
        require(requests[requestId].createdAt == 0, "Already exists");
        require(recipient != address(0), "Invalid recipient");
        require(amountUsdc > 0, "Invalid amount");
        requests[requestId] = PaymentRequest({
            requestId: requestId,
            recipient: recipient,
            amountUsdc: amountUsdc,
            status: Status.Pending,
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
        PaymentRequest storage req = requests[requestId];
        require(req.createdAt != 0, "Not found");
        require(req.status == Status.Pending, "Invalid status");
        req.status = Status.Confirmed;
        req.confirmedAt = block.timestamp;
        req.tusGirosReference = tusGirosReference;
        req.hederaTxId = hederaTxId;
        emit PaymentConfirmed(
            requestId, req.recipient, req.amountUsdc,
            tusGirosReference, hederaTxId
        );
    }

    function failPayment(
        bytes32 requestId,
        string calldata reason
    ) external onlyOwner {
        PaymentRequest storage req = requests[requestId];
        require(req.createdAt != 0, "Not found");
        require(req.status == Status.Pending, "Invalid status");
        req.status = Status.Failed;
        emit PaymentFailed(requestId, reason);
    }

    function getRequest(bytes32 requestId)
        external view returns (PaymentRequest memory)
    {
        return requests[requestId];
    }
}
