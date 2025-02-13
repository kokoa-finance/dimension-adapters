import { SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import * as sdk from "@defillama/sdk";
import { getBlock } from "../../helpers/getBlock";
import { getPrices } from "../../utils/prices";
import BigNumber from "bignumber.js";
import { Chain } from "@defillama/sdk/build/general";

interface ILog {
  data: string;
  transactionHash: string;
}
interface IAmount {
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
}

const topic0 = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const FACTORY_ADDRESS = '0xd541Bc203Cc2B85810d9b8E6a534eed1615528E2';

type TABI = {
  [k: string]: object;
}
const ABIs: TABI = {
  allPairsLength: {
    "type": "function",
    "stateMutability": "view",
    "outputs": [
      {
        "type": "uint256",
        "name": "",
        "internalType": "uint256"
      }
    ],
    "name": "allPairsLength",
    "inputs": []
  },
  allPairs: {
    "type": "function",
    "stateMutability": "view",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "inputs": [
      {
        "type": "uint256",
        "name": "",
        "internalType": "uint256"
      }
    ],
    "name": "allPairs",
  }
};

const PAIR_TOKEN_ABI = (token: string): object => {
  return {
    "constant": true,
    "inputs": [],
    "name": token,
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
};


const fetch = async (timestamp: number) => {
  const fromTimestamp = timestamp - 60 * 60 * 24
  const toTimestamp = timestamp
  try {
    const poolLength = (await sdk.api.abi.call({
      target: FACTORY_ADDRESS,
      chain: CHAIN.POLYGON,
      abi: ABIs.allPairsLength,
    })).output;

    const poolsRes = await sdk.api.abi.multiCall({
      abi: ABIs.allPairs,
      calls: Array.from(Array(Number(poolLength)).keys()).map((i) => ({
        target: FACTORY_ADDRESS,
        params: i,
      })),
      chain: CHAIN.POLYGON
    });

    const lpTokens = poolsRes.output
      .map(({ output }: any) => output);

    const [underlyingToken0, underlyingToken1] = await Promise.all(
      ['token0', 'token1'].map((method) =>
        sdk.api.abi.multiCall({
          abi: PAIR_TOKEN_ABI(method),
          calls: lpTokens.map((address: string) => ({
            target: address,
          })),
          chain: CHAIN.POLYGON
        })
      )
    );

    const tokens0 = underlyingToken0.output.map((res: any) => res.output);
    const tokens1 = underlyingToken1.output.map((res: any) => res.output);
    const fromBlock = await getBlock(fromTimestamp, CHAIN.POLYGON as Chain, {});
    const toBlock = await getBlock(toTimestamp, CHAIN.POLYGON as Chain, {});

    const logs: ILog[][] = (await Promise.all(lpTokens.map((address: string) => sdk.api.util.getLogs({
      target: address,
      topic: '',
      toBlock: toBlock,
      fromBlock: fromBlock,
      keys: [],
      chain: CHAIN.POLYGON as Chain,
      topics: [topic0]
    }))))
      .map((p: any) => p)
      .map((a: any) => a.output);
    const rawCoins = [...tokens0, ...tokens1].map((e: string) => `${CHAIN.POLYGON}:${e}`);
    const coins = [...new Set(rawCoins)]
    const prices = await getPrices(coins, timestamp);
    const untrackVolumes: number[] = lpTokens.map((_: string, index: number) => {
      const log: IAmount[] = logs[index]
        .map((e: ILog) => { return { ...e, data: e.data.replace('0x', '') } })
        .map((p: ILog) => {
          BigNumber.config({ POW_PRECISION: 100 });
          const amount0In = new BigNumber('0x' + p.data.slice(0, 64)).toString();
          const amount1In = new BigNumber('0x' + p.data.slice(64, 128)).toString();
          const amount0Out = new BigNumber('0x' + p.data.slice(128, 192)).toString();
          const amount1Out = new BigNumber('0x' + p.data.slice(192, 256)).toString();
          return {
            amount0In,
            amount1In,
            amount0Out,
            amount1Out,
          } as IAmount
        }) as IAmount[];
      const token0Price = (prices[`${CHAIN.POLYGON}:${tokens0[index]}`]?.price || 0);
      const token1Price = (prices[`${CHAIN.POLYGON}:${tokens1[index]}`]?.price || 0);
      const token0Decimals = (prices[`${CHAIN.POLYGON}:${tokens0[index]}`]?.decimals || 0)
      const token1Decimals = (prices[`${CHAIN.POLYGON}:${tokens1[index]}`]?.decimals || 0)
      const totalAmount0 = log
        .reduce((a: number, b: IAmount) => Number(b.amount0In) + Number(b.amount0Out) + a, 0) / 10 ** token0Decimals * token0Price;
      const totalAmount1 = log
        .reduce((a: number, b: IAmount) => Number(b.amount1In) + Number(b.amount1Out) + a, 0) / 10 ** token1Decimals * token1Price;

      const untrackAmountUSD = token0Price !== 0 ? totalAmount0 : token1Price !== 0 ? totalAmount1 : 0; // counted only we have price data
      return untrackAmountUSD;
    });

    const dailyVolume = untrackVolumes.reduce((a: number, b: number) => a + b, 0);
    return {
      dailyVolume: `${dailyVolume}`,
      timestamp,
    };
  } catch(error) {
    console.error(error);
    throw error;
  }
}

const adapter: SimpleAdapter = {
  adapter: {
    [CHAIN.POLYGON]: {
      fetch,
      start: async () => 1686268800,
    },
  }
};

export default adapter;
