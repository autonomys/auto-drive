// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AutoDriveUSDCReceiver} from "../src/AutoDriveUSDCReceiver.sol";

/**
 * @notice Deploys AutoDriveUSDCReceiver to Ethereum mainnet or Sepolia.
 *
 * Required env vars:
 *   PRIVATE_KEY        - deployer key (hex, 0x-prefixed)
 * Optional:
 *   USDC_TOKEN_ADDRESS - ERC20 (USDC) address on the target chain. Defaults to
 *                        Circle's canonical USDC on mainnet/Sepolia (see
 *                        https://developers.circle.com/stablecoins/usdc-contract-addresses);
 *                        required on any other chain.
 *   OWNER              - initial owner; defaults to the deployer address.
 *                        Use a multisig for production.
 *
 * Known USDC addresses:
 *   Ethereum mainnet: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 *   Sepolia:          0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 *
 * Usage:
 *   forge script script/DeployAutoDriveUSDCReceiver.s.sol \
 *     --rpc-url "$ETH_RPC_URL" --broadcast --verify
 */
contract DeployAutoDriveUSDCReceiver is Script {
    /// @dev Circle's canonical USDC deployments.
    address internal constant USDC_MAINNET =
        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant USDC_SEPOLIA =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external returns (AutoDriveUSDCReceiver receiver) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address tokenAddress = vm.envOr(
            "USDC_TOKEN_ADDRESS",
            _defaultUsdc(block.chainid)
        );
        address initialOwner = vm.envOr("OWNER", vm.addr(deployerKey));

        require(
            tokenAddress != address(0),
            "USDC_TOKEN_ADDRESS required: no known USDC default for this chain"
        );
        require(
            tokenAddress.code.length > 0,
            "USDC_TOKEN_ADDRESS is not a contract on the target chain"
        );

        vm.startBroadcast(deployerKey);
        receiver = new AutoDriveUSDCReceiver(
            initialOwner,
            IERC20(tokenAddress)
        );
        vm.stopBroadcast();

        console.log("AutoDriveUSDCReceiver deployed at:", address(receiver));
        console.log("Initial owner:", initialOwner);
        console.log("Token:", tokenAddress);
    }

    function _defaultUsdc(uint256 chainId) internal pure returns (address) {
        if (chainId == 1) return USDC_MAINNET;
        if (chainId == 11155111) return USDC_SEPOLIA;
        return address(0);
    }
}
