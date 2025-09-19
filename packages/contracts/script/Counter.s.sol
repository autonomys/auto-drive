// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {AutoDriveTreasury} from "../src/Counter.sol";

contract CounterScript is Script {
    function setUp() public {
        AutoDriveTreasury counter = new AutoDriveTreasury();
    }

    function run() public {
        vm.broadcast();
    }
}
