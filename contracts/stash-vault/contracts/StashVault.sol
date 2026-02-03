// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal USDC vault with shares + withdraw request queue.
/// @dev MVP: no strategy/yield here. Backends can route yield separately.
contract StashVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    struct WithdrawRequest {
        address user;
        address recipient;
        uint256 shares;
        uint256 usdcAmount;
        bool redeemed;
        uint64 createdAt;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => WithdrawRequest) public withdrawRequests;

    event Deposit(address indexed user, uint256 usdcAmount, uint256 sharesMinted);
    event WithdrawRequested(address indexed user, uint256 shares, uint256 requestId, address indexed recipient);
    event WithdrawRedeemed(address indexed user, uint256 usdcAmount, uint256 requestId, address indexed recipient);

    error ZeroAmount();
    error InvalidRecipient();
    error InvalidRequest();
    error AlreadyRedeemed();
    error NotRequestOwner();

    constructor(address usdcAddress)
        ERC20("My Stash Jar Vault Share", "MSJVS")
        Ownable(msg.sender)
    {
        require(usdcAddress != address(0), "USDC addr=0");
        usdc = IERC20(usdcAddress);
    }

    /// @notice Vault assets (USDC held directly by this contract).
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice Total shares outstanding.
    function totalShares() public view returns (uint256) {
        return totalSupply();
    }

    /// @notice Shares held by a user.
    function sharesOf(address user) external view returns (uint256) {
        return balanceOf(user);
    }

    /// @notice Convert USDC amount -> shares at current ratio.
    /// @dev If vault is empty, 1 share per 1 USDC unit (same decimals as USDC).
    function _previewDeposit(uint256 usdcAmount) internal view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 shares = totalShares();
        if (shares == 0 || assets == 0) {
            return usdcAmount; // 1:1 initial
        }
        return (usdcAmount * shares) / assets;
    }

    /// @notice Convert shares -> USDC at current ratio.
    function _previewRedeem(uint256 sharesAmount) internal view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 shares = totalShares();
        if (shares == 0 || assets == 0) return 0;
        return (sharesAmount * assets) / shares;
    }

    /// @notice External view: preview deposit USDC -> shares at current ratio.
    function previewDeposit(uint256 usdcAmount) external view returns (uint256) {
        return _previewDeposit(usdcAmount);
    }

    /// @notice External view: preview redeem shares -> USDC at current ratio.
    function previewRedeem(uint256 sharesAmount) external view returns (uint256) {
        return _previewRedeem(sharesAmount);
    }

    /// @notice Deposit USDC and mint vault shares to beneficiary.
    function depositUSDC(uint256 usdcAmount, address beneficiary)
        external
        nonReentrant
        returns (uint256 sharesMinted)
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (beneficiary == address(0)) revert InvalidRecipient();

        sharesMinted = _previewDeposit(usdcAmount);
        if (sharesMinted == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        _mint(beneficiary, sharesMinted);

        emit Deposit(beneficiary, usdcAmount, sharesMinted);
    }

    /// @notice Request a withdrawal by specifying shares to redeem.
    /// @dev MVP: burn shares immediately and lock USDC amount at request time.
    function requestWithdraw(uint256 shares, address recipient)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        uint256 usdcAmount = _previewRedeem(shares);
        if (usdcAmount == 0) revert ZeroAmount();

        _burn(msg.sender, shares);

        requestId = nextRequestId++;
        withdrawRequests[requestId] = WithdrawRequest({
            user: msg.sender,
            recipient: recipient,
            shares: shares,
            usdcAmount: usdcAmount,
            redeemed: false,
            createdAt: uint64(block.timestamp)
        });

        emit WithdrawRequested(msg.sender, shares, requestId, recipient);
    }

    /// @notice Redeem a previously requested withdrawal (pays USDC).
    function redeem(uint256 requestId)
        external
        nonReentrant
        returns (uint256 usdcAmount)
    {
        WithdrawRequest storage r = withdrawRequests[requestId];
        if (r.user == address(0)) revert InvalidRequest();
        if (r.redeemed) revert AlreadyRedeemed();
        if (msg.sender != r.user) revert NotRequestOwner();

        r.redeemed = true;
        usdcAmount = r.usdcAmount;

        usdc.safeTransfer(r.recipient, usdcAmount);

        emit WithdrawRedeemed(r.user, usdcAmount, requestId, r.recipient);
    }
}
