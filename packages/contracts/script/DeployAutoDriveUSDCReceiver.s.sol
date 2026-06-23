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
 *   USDC_TOKEN_ADDRESS - ERC20 (USDC) address on the target chain
 * Optional:
 *   OWNER              - initial owner; defaults to the deployer address.
 *                        Use a multisig for production.
 *
 * Known USDC addresses:
 *   Ethereum mainnet: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 *   Sepolia:          deploy/point at your test USDC token
 *
 * Usage:
 *   forge script script/DeployAutoDriveUSDCReceiver.s.sol \
 *     --rpc-url "$ETH_RPC_URL" --broadcast --verify
 */
contract DeployAutoDriveUSDCReceiver is Script {
    function run() external returns (AutoDriveUSDCReceiver receiver) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address tokenAddress = vm.envAddress("USDC_TOKEN_ADDRESS");
        address initialOwner = vm.envOr("OWNER", vm.addr(deployerKey));

        require(tokenAddress != address(0), "USDC_TOKEN_ADDRESS is zero");

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
}
