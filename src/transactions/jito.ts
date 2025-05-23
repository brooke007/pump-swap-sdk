import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import axios from "axios";
import bs58 from "bs58";
import { connection } from "../config";
const jito_Validators = [
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
];
const endpoints = [
  // TODO: Choose a jito endpoint which is closest to your location, and uncomment others
  // "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  // "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  // "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  // "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

/**
 * Generates a random validator from the list of jito_Validators.
 * @returns {PublicKey} A new PublicKey representing the random validator.
 */
export async function getRandomValidator() {
  const res =
    jito_Validators[Math.floor(Math.random() * jito_Validators.length)];
  return new PublicKey(res);
}
/**
 * Executes and confirms a Jito transaction.
 * @param {Transaction} transaction - The transaction to be executed and confirmed.
 * @param {Account} payer - The payer account for the transaction.
 * @param {Blockhash} lastestBlockhash - The latest blockhash.
 * @param {number} jitofee - The fee for the Jito transaction.
 * @returns {Promise<{ confirmed: boolean, signature: string | null }>} - A promise that resolves to an object containing the confirmation status and the transaction signature.
 */
export async function jito_executeAndConfirm(
  transaction: any,
  payer: Keypair,
  lastestBlockhash: any,
  jitofee: any
) {
  console.log("Executing transaction (jito)...");
  const jito_validator_wallet = await getRandomValidator();
  console.log("Selected Jito Validator: ", jito_validator_wallet.toBase58());
  try {
    console.log(`Jito Fee: ${Number(jitofee)} lamports`);
    const jitoFee_message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: lastestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: jito_validator_wallet,
          lamports: parseInt(jitofee), // Convert to integer lamports
        }),
      ],
    }).compileToV0Message();



    const jitoFee_transaction = new VersionedTransaction(jitoFee_message);
    jitoFee_transaction.sign([payer]);

    // 模拟交易执行
    try {
      // 再模拟主交易
      const mainTxSimulation = await connection.simulateTransaction(transaction);
      if (mainTxSimulation.value.err) {
        console.log("主交易模拟失败:", mainTxSimulation.value.err);
        console.log("详细错误信息:", JSON.stringify(mainTxSimulation.value, null, 2));
        if (typeof mainTxSimulation.value.err === 'object' && Array.isArray(mainTxSimulation.value.err)) {
          console.log("失败的指令索引:", mainTxSimulation.value.err[0]);
          if (mainTxSimulation.value.err[1] && 'Custom' in mainTxSimulation.value.err[1]) {
            console.log("自定义错误代码:", mainTxSimulation.value.err[1].Custom);
          }
        } else {
          console.log("错误信息:", mainTxSimulation.value.err);
        }
        // 打印交易中的指令信息以便调试
        console.log("交易指令:", transaction.instructions.map((ix: any, index: number) => ({
          指令索引: index,
          程序ID: ix.programId.toBase58(),
          数据: ix.data
        })));
        return { confirmed: false, signature: null };
      }
      console.log("主交易模拟成功");

    } catch (err) {
      console.log("交易模拟过程出错:", err);
      return { confirmed: false, signature: null };
    }

    const jitoTxSignature = bs58.encode(jitoFee_transaction.signatures[0]);
    const serializedJitoFeeTransaction = bs58.encode(
      jitoFee_transaction.serialize()
    );
    const serializedTransaction = bs58.encode(transaction.serialize());
    const final_transaction = [
      serializedJitoFeeTransaction,
      serializedTransaction,
    ];
    const requests = endpoints.map((url) =>
      axios.post(url, {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [final_transaction],
      })
    );
    console.log("Sending tx to Jito validators...");
    const res = await Promise.all(requests.map((p) => p.catch((e) => e)));
    const success_res = res.filter((r) => !(r instanceof Error));
    if (success_res.length > 0) {
      console.log("Jito validator accepted the tx");
      return await jito_confirm(jitoTxSignature, lastestBlockhash);
    } else {
      console.log("No Jito validators accepted the tx");
      return { confirmed: false, signature: jitoTxSignature };
    }
  } catch (e) {
    if (e instanceof axios.AxiosError) {
      console.log("Failed to execute the jito transaction");
    } else {
      console.log("Error during jito transaction execution: ", e);
    }
    return { confirmed: false, signature: null };
  }
}

/**
 * Confirms a transaction on the Solana blockchain.
 * @param {string} signature - The signature of the transaction.
 * @param {object} latestBlockhash - The latest blockhash information.
 * @returns {object} - An object containing the confirmation status and the transaction signature.
 */
export async function jito_confirm(signature: any, latestBlockhash: any) {
  console.log("Confirming the jito transaction...");
  
  if (!connection) {
    throw new Error("connection is not defined");
  }
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    },
    "confirmed"
  );
  return { confirmed: !confirmation.value.err, signature };
}
