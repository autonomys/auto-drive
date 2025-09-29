
// Helper contracts to validate setTreasury zero-value call behavior
contract RevertingTreasury {
    fallback() external payable { revert(); }
    receive() external payable { revert(); }
}

contract AcceptingTreasury {
    fallback() external payable {}
    receive() external payable {}
}
