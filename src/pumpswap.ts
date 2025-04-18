import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";
import { IDL, PumpSwap } from "../IDL";
import { connection, walletKeypair } from "./config";
import { getBuyTokenAmount, getPumpSwapPool } from "./pool";
import { getSPLBalance, sendTxToJito, getProvider } from "./utils";
import { logger } from "./logger";

// Define static public keys
const PUMP_AMM_PROGRAM_ID: PublicKey = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const TOKEN_PROGRAM_ID: PublicKey = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const WSOL_TOKEN_ACCOUNT: PublicKey = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
const global = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
const eventAuthority = new PublicKey(
  "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR"
);
const feeRecipient = new PublicKey(
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV"
);
const feeRecipientAta = new PublicKey(
  "94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb"
);
const BUY_DISCRIMINATOR: Uint8Array = new Uint8Array([
  102, 6, 61, 18, 1, 218, 235, 234,
]);
const SELL_DISCRIMINATOR: Uint8Array = new Uint8Array([
  51, 230, 133, 164, 1, 127, 131, 173,
]);

export const DEFAULT_DECIMALS = 6;

export class PumpSwapSDK {
  public program: Program<PumpSwap>;
  public connection: Connection;
  constructor() {
    this.program = new Program<PumpSwap>(IDL as PumpSwap, getProvider());
    this.connection = this.program.provider.connection;
  }
  public async buy(mint: PublicKey, user: PublicKey, solToBuy: number) {
    try {
      const slippage = 0.1;

      // 获取或创建代币账户
      const ata = getAssociatedTokenAddressSync(mint, user);
      console.log("代币账户地址:", ata.toBase58());

      const wsolAta = getAssociatedTokenAddressSync(WSOL_TOKEN_ACCOUNT, user);

      // 检查代币账户是否存在
      const accountInfo = await connection.getAccountInfo(ata);

      // 构建指令列表
      const ix_list: TransactionInstruction[] = [
        // 设置计算预算
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 130000,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 90000,
        }),
      ];

      // 如果代币账户不存在，添加创建账户指令
      if (!accountInfo) {
        console.log("创建代币账户");
        ix_list.push(
          createAssociatedTokenAccountInstruction(
            walletKeypair.publicKey, // payer
            ata, // ata
            user, // owner
            mint // mint
          )
        );
      }

      // 创建并注资 WSOL 账户
      ix_list.push(
        // 创建 WSOL 账户
        createAssociatedTokenAccountIdempotentInstruction(
          walletKeypair.publicKey, // payer
          wsolAta, // ata
          user, // owner
          NATIVE_MINT // WSOL mint
        ),
        // 注资 WSOL 账户
        SystemProgram.transfer({
          fromPubkey: walletKeypair.publicKey,
          toPubkey: wsolAta,
          lamports: solToBuy * LAMPORTS_PER_SOL * 3, // TODO:
        }),
        // 同步 WSOL 余额
        createSyncNativeInstruction(wsolAta)
      );

      // 代币账户处理
      const tokenAta = getAssociatedTokenAddressSync(mint, user);
      ix_list.push(
        createAssociatedTokenAccountIdempotentInstruction(
          walletKeypair.publicKey,
          tokenAta,
          user,
          mint
        )
      );

      // 获取交易池和买入数量
      const bought_token_amount = await getBuyTokenAmount(
        BigInt(solToBuy * LAMPORTS_PER_SOL),
        mint
      );

      const pool = await getPumpSwapPool(mint);

      // 添加买入指令
      const pumpswap_buy_tx = await this.createBuyInstruction(
        pool,
        user,
        mint,
        bought_token_amount,
        BigInt(Math.floor(solToBuy * (1 + slippage) * LAMPORTS_PER_SOL))
      );
      ix_list.push(pumpswap_buy_tx);

      // 添加关闭 WSOL 账户的指令（回收 SOL）
      ix_list.push(
        createCloseAccountInstruction(
          wsolAta, // 要关闭的账户
          user, // SOL 接收者
          user, // 账户所有者
          [] // 额外的签名者
        )
      );

      const latestBlockhash = await connection.getLatestBlockhash();

      // 创建并签名交易
      const messageV0 = new TransactionMessage({
        payerKey: walletKeypair.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: ix_list,
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([walletKeypair]);

      // 模拟交易
      // const simulation = await connection.simulateTransaction(transaction);
      // console.log("交易模拟结果:", {
      //   logs: simulation.value.logs,
      //   unitsConsumed: simulation.value.unitsConsumed,
      //   returnData: simulation.value.returnData,
      // });
      // if (simulation.value.err) {
      //   console.error("交易模拟失败:", simulation.value.err);
      //   throw new Error(
      //     `Transaction simulation failed: ${JSON.stringify(
      //       simulation.value.err
      //     )}`
      //   );
      // }

      // 发送交易
      await sendTxToJito(connection, transaction, walletKeypair, [
        walletKeypair,
      ]);

      // 等待确认并检查余额
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newBalance = await getSPLBalance(connection, mint, user);
      console.log("新余额:", newBalance);

      return true;
    } catch (error) {
      console.error("买入过程中出错:", error);
      throw error;
    }
  }

  public async sell_exactAmount(
    mint: PublicKey,
    user: PublicKey,
    tokenAmount: number
  ) {
    const sell_token_amount = tokenAmount;
    logger.info({
      status: `finding pumpswap pool for ${mint}`,
    });
    const pool = await getPumpSwapPool(mint);

    const wsolAta = getAssociatedTokenAddressSync(WSOL_TOKEN_ACCOUNT, user);

    // 构建指令列表
    const ix_list: TransactionInstruction[] = [
      // 设置计算预算
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 130000,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 90000,
      }),
    ];

     ix_list.push(
       // 创建 WSOL 账户
       createAssociatedTokenAccountIdempotentInstruction(
         walletKeypair.publicKey, // payer
         wsolAta, // ata
         user, // owner
         NATIVE_MINT // WSOL mint
       ),

       // 同步 WSOL 余额
       createSyncNativeInstruction(wsolAta)
     );

    const pumpswap_sell_tx = await this.createSellInstruction(
      await getPumpSwapPool(mint),
      user,
      mint,
      BigInt(Math.floor(sell_token_amount * 10 ** 6)), // TODO:
      BigInt(0)
    );

    ix_list.push(pumpswap_sell_tx);

    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: walletKeypair.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: ix_list,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([walletKeypair]);
    //sendNozomiTx(ix_list, walletKeypair_1, latestBlockhash, "PumpSwap", "sell");
    sendTxToJito(connection, transaction, walletKeypair, [walletKeypair]);
  }
  public async sell_percentage(
    mint: PublicKey,
    user: PublicKey,
    percentage_to_sell: number
  ) {
    const holding_token_amount = await getSPLBalance(connection, mint, user);
    const sell_token_amount = percentage_to_sell * holding_token_amount;
    logger.info({
      status: `finding pumpswap pool for ${mint}`,
    });
    const pool = await getPumpSwapPool(mint);
    const pumpswap_buy_tx = await this.createSellInstruction(
      pool,
      user,
      mint,
      BigInt(Math.floor(sell_token_amount * 10 ** 6)),
      BigInt(0)
    );
    const ata = getAssociatedTokenAddressSync(mint, user);
    const ix_list: any[] = [
      ...[
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 130000,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 90000,
        }),
      ],

      createAssociatedTokenAccountIdempotentInstruction(
        walletKeypair.publicKey,
        ata,
        walletKeypair.publicKey,
        mint
      ),
      pumpswap_buy_tx,
    ];

    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: walletKeypair.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: ix_list,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([walletKeypair]);
    //sendNozomiTx(ix_list, walletKeypair_1, latestBlockhash, "PumpSwap", "sell");
    sendTxToJito(connection, transaction, walletKeypair, [walletKeypair]);
  }
  async createBuyInstruction(
    poolId: PublicKey,
    user: PublicKey,
    mint: PublicKey,
    baseAmountOut: bigint, // Use bigint for u64
    maxQuoteAmountIn: bigint // Use bigint for u64
  ): Promise<TransactionInstruction> {
    // Compute associated token account addresses
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);

    const userQuoteTokenAccount = await getAssociatedTokenAddress(
      WSOL_TOKEN_ACCOUNT,
      user
    );

    const poolBaseTokenAccount = await getAssociatedTokenAddress(
      mint,
      poolId,
      true
    );

    const poolQuoteTokenAccount = await getAssociatedTokenAddress(
      WSOL_TOKEN_ACCOUNT,
      poolId,
      true
    );

    // Define the accounts for the instruction
    const accounts = [
      { pubkey: poolId, isSigner: false, isWritable: false }, // pool_id (readonly)
      { pubkey: user, isSigner: true, isWritable: true }, // user (signer)
      { pubkey: global, isSigner: false, isWritable: false }, // global (readonly)
      { pubkey: mint, isSigner: false, isWritable: false }, // mint (readonly)
      { pubkey: WSOL_TOKEN_ACCOUNT, isSigner: false, isWritable: false }, // WSOL_TOKEN_ACCOUNT (readonly)
      { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true }, // user_base_token_account
      { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true }, // user_quote_token_account
      { pubkey: poolBaseTokenAccount, isSigner: false, isWritable: true }, // pool_base_token_account
      { pubkey: poolQuoteTokenAccount, isSigner: false, isWritable: true }, // pool_quote_token_account
      { pubkey: feeRecipient, isSigner: false, isWritable: false }, // fee_recipient (readonly)
      { pubkey: feeRecipientAta, isSigner: false, isWritable: true }, // fee_recipient_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly, duplicated as in Rust)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System Program (readonly)
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      }, // ASSOCIATED_TOKEN_PROGRAM_ID (readonly)
      { pubkey: eventAuthority, isSigner: false, isWritable: false }, // event_authority (readonly)
      { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false }, // PUMP_AMM_PROGRAM_ID (readonly)
    ];

    // Pack the instruction data: discriminator (8 bytes) + base_amount_in (8 bytes) + min_quote_amount_out (8 bytes)
    const data = Buffer.alloc(8 + 8 + 8); // 24 bytes total
    data.set(BUY_DISCRIMINATOR, 0);
    data.writeBigUInt64LE(BigInt(baseAmountOut), 8); // Write base_amount_out as little-endian u64
    data.writeBigUInt64LE(BigInt(maxQuoteAmountIn), 16); // Write max_quote_amount_in as little-endian u64

    // Create the transaction instruction
    return new TransactionInstruction({
      keys: accounts,
      programId: PUMP_AMM_PROGRAM_ID,
      data: data,
    });
  }

  async createSellInstruction(
    poolId: PublicKey,
    user: PublicKey,
    mint: PublicKey,
    baseAmountIn: bigint, // Use bigint for u64
    minQuoteAmountOut: bigint // Use bigint for u64
  ): Promise<TransactionInstruction> {
    // Compute associated token account addresses
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);
    const userQuoteTokenAccount = await getAssociatedTokenAddress(
      WSOL_TOKEN_ACCOUNT,
      user
    );
    const poolBaseTokenAccount = await getAssociatedTokenAddress(
      mint,
      poolId,
      true
    );
    const poolQuoteTokenAccount = await getAssociatedTokenAddress(
      WSOL_TOKEN_ACCOUNT,
      poolId,
      true
    );

    // Define the accounts for the instruction
    const accounts = [
      { pubkey: poolId, isSigner: false, isWritable: false }, // pool_id (readonly)
      { pubkey: user, isSigner: true, isWritable: true }, // user (signer)
      { pubkey: global, isSigner: false, isWritable: false }, // global (readonly)
      { pubkey: mint, isSigner: false, isWritable: false }, // mint (readonly)
      { pubkey: WSOL_TOKEN_ACCOUNT, isSigner: false, isWritable: false }, // WSOL_TOKEN_ACCOUNT (readonly)
      { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true }, // user_base_token_account
      { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true }, // user_quote_token_account
      { pubkey: poolBaseTokenAccount, isSigner: false, isWritable: true }, // pool_base_token_account
      { pubkey: poolQuoteTokenAccount, isSigner: false, isWritable: true }, // pool_quote_token_account
      { pubkey: feeRecipient, isSigner: false, isWritable: false }, // fee_recipient (readonly)
      { pubkey: feeRecipientAta, isSigner: false, isWritable: true }, // fee_recipient_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly, duplicated as in Rust)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System Program (readonly)
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      }, // ASSOCIATED_TOKEN_PROGRAM_ID (readonly)
      { pubkey: eventAuthority, isSigner: false, isWritable: false }, // event_authority (readonly)
      { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false }, // PUMP_AMM_PROGRAM_ID (readonly)
    ];

    // Pack the instruction data: discriminator (8 bytes) + base_amount_in (8 bytes) + min_quote_amount_out (8 bytes)
    const data = Buffer.alloc(8 + 8 + 8); // 24 bytes total
    data.set(SELL_DISCRIMINATOR, 0);
    data.writeBigUInt64LE(BigInt(baseAmountIn), 8); // Write base_amount_in as little-endian u64
    data.writeBigUInt64LE(BigInt(minQuoteAmountOut), 16); // Write min_quote_amount_out as little-endian u64

    // Create the transaction instruction
    return new TransactionInstruction({
      keys: accounts,
      programId: PUMP_AMM_PROGRAM_ID,
      data: data,
    });
  }
}
