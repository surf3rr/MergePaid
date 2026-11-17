// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Educational native-token funding pool. Amounts shown in the UI are local ETH.
contract FundingRound {
    address public immutable reviewer;
    uint256 public matchRemaining;
    uint256 public funded;
    uint256 public paid;
    enum Phase { Funding, Review, Finalized }
    Phase public phase;
    mapping(address => uint256) public claimable;
    mapping(address => uint256) public deposits;
    bool private entered;
    event Sponsored(address indexed sponsor, uint256 amount, uint256 matched);
    event Finalized(uint256 total, bytes32 indexed evidenceHash);
    event Claimed(address indexed contributor, uint256 amount);
    modifier onlyReviewer() { require(msg.sender == reviewer, "Reviewer only"); _; }
    constructor(address reviewer_) payable {
        require(reviewer_ != address(0), "Invalid reviewer");
        reviewer = reviewer_;
        matchRemaining = msg.value;
    }
    function sponsor() external payable {
        require(phase == Phase.Funding, "Funding closed");
        require(msg.value > 0, "Zero deposit");
        uint256 matched = msg.value < matchRemaining ? msg.value : matchRemaining;
        matchRemaining -= matched;
        funded += msg.value + matched;
        deposits[msg.sender] += msg.value;
        emit Sponsored(msg.sender, msg.value, matched);
    }
    function startReview() external onlyReviewer {
        require(phase == Phase.Funding, "Wrong phase");
        require(funded > 0, "Empty round");
        phase = Phase.Review;
    }
    function finalize(address[] calldata recipients, uint256[] calldata amounts, bytes32 evidenceHash) external onlyReviewer {
        require(phase == Phase.Review, "Not in review");
        require(recipients.length > 0 && recipients.length == amounts.length, "Invalid allocation");
        uint256 total;
        for (uint256 i; i < recipients.length; i++) {
            require(recipients[i] != address(0) && amounts[i] > 0, "Invalid recipient");
            require(claimable[recipients[i]] == 0, "Duplicate recipient");
            claimable[recipients[i]] = amounts[i];
            total += amounts[i];
        }
        require(total == funded, "Allocation must equal pool");
        phase = Phase.Finalized;
        emit Finalized(total, evidenceHash);
    }
    function claim() external {
        require(phase == Phase.Finalized, "Not finalized");
        require(!entered, "Reentrant call");
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing to claim");
        entered = true;
        claimable[msg.sender] = 0;
        paid += amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        entered = false;
        emit Claimed(msg.sender, amount);
    }
    function withdrawUnusedMatch() external onlyReviewer {
        require(phase != Phase.Funding, "Funding open");
        uint256 amount = matchRemaining;
        matchRemaining = 0;
        (bool ok,) = payable(reviewer).call{value: amount}("");
        require(ok, "Transfer failed");
    }
}
