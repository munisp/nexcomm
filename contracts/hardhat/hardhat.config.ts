import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const POLYGON_AMOY_RPC = process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const ETHERSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    polygon_amoy: {
      url: POLYGON_AMOY_RPC,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 80002,
      gasPrice: "auto",
    },
    ethereum_sepolia: {
      url: process.env.ETHEREUM_SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: ETHERSCAN_API_KEY,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
