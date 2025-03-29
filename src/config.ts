import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { Connection, Keypair } from "@solana/web3.js";
import dotenv from "dotenv";
import path from "path";

const envPath = path.join(__dirname, ".env");
dotenv.config({
  path: envPath, // fill in your .env path
});

export const connection = new Connection(process.env.RPC_URL || "");
export const jito_fee = process.env.JITO_FEE || "0.003";

export const private_key = process.env.PRIVATE_KEY; // your private key
export const bloXRoute_auth_header = process.env.BLOXROUTE_AUTH_HEADER;
export const bloXroute_fee = process.env.BLOXROUTE_FEE; // 0.001 SOL
export const wallet = Keypair.fromSecretKey(bs58.decode(private_key || ""));
