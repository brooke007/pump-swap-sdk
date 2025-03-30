import { PublicKey } from "@solana/web3.js";
import { PumpSwapSDK } from "../src/pumpswap";
import { wallet } from "../src/config";
import { getSPLBalance } from "../src/utils";
import { connection } from "../src/config";

async function testPumpSwap() {
  try {
    const pumpSwap = new PumpSwapSDK();
    const testMint = new PublicKey(
      "DqHJFnU2KqC6B2qskERJjkPqhFS4FY2xaxgEfjUVp7ng"
    );

    // console.log("开始测试买入...");
    // const solAmount = 0.001;

    // // 添加调试信息
    
    // const beforeBuyBalance = await getSPLBalance(
    //   connection,
    //   testMint,
    //   wallet.publicKey
    // );
    // console.log("买入前余额:", beforeBuyBalance);

    // await pumpSwap.buy(testMint, wallet.publicKey, solAmount);
    // await new Promise((resolve) => setTimeout(resolve, 2000));

    // const afterBuyBalance = await getSPLBalance(
    //   connection,
    //   testMint,
    //   wallet.publicKey
    // );
    // console.log("买入后余额:", afterBuyBalance);

    // 测试卖出
    console.log("\n开始测试卖出...");
    const sellAmount = 1; // 卖出1个代币
    const beforeSellBalance = await getSPLBalance(
      connection,
      testMint,
      wallet.publicKey
    );
    console.log("卖出前余额:", beforeSellBalance);

    await pumpSwap.sell_exactAmount(testMint, wallet.publicKey, sellAmount);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const afterSellBalance = await getSPLBalance(
      connection,
      testMint,
      wallet.publicKey
    );
    console.log("卖出后余额:", afterSellBalance);
  } catch (error) {
    console.error("测试过程中出错:", error);
    throw error;
  }
}

testPumpSwap().catch(console.error);
