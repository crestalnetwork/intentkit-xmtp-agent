import { getRandomValues } from "node:crypto";
import { IdentifierKind, type Signer, type Client, type XmtpEnv } from "@xmtp/node-sdk";
import { fromString, toString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

interface User {
    key: `0x${string}`;
    account: ReturnType<typeof privateKeyToAccount>;
    wallet: ReturnType<typeof createWalletClient>;
}

export const createUser = (key: `0x${string}`): User => {
    const accountKey = key;
    const account = privateKeyToAccount(accountKey);
    return {
        key: accountKey,
        account,
        wallet: createWalletClient({
            account,
            chain: sepolia,
            transport: http(),
        }),
    };
};

export const createSigner = (key: `0x${string}`): Signer => {
    const user = createUser(key);
    return {
        type: "EOA",
        getIdentifier: () => ({
            identifierKind: IdentifierKind.Ethereum,
            identifier: user.account.address.toLowerCase(),
        }),
        signMessage: async (message: string) => {
            const signature = await user.wallet.signMessage({
                message,
                account: user.account,
            });
            return toBytes(signature);
        },
    };
};

/**
 * Generate a random encryption key
 * @returns The encryption key as hex string
 */
export const generateEncryptionKeyHex = () => {
    const uint8Array = getRandomValues(new Uint8Array(32));
    return toString(uint8Array, "hex");
};

/**
 * Get the encryption key from a hex string
 * @param hex - The hex string
 * @returns The encryption key
 */
export const getEncryptionKeyFromHex = (hex: string) => {
    return fromString(hex, "hex");
};

/**
 * Validate required environment variables
 * @param requiredVars - Array of required environment variable names
 * @returns Object with validated environment variables
 */
export const validateEnvironment = (requiredVars: string[]) => {
    const missing: string[] = [];
    const result: Record<string, string> = {};

    for (const varName of requiredVars) {
        const value = process.env[varName];
        if (!value || value.trim() === "") {
            missing.push(varName);
        } else {
            result[varName] = value.trim();
        }
    }

    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
        console.error("Please create a .env file with the required variables.");
        console.error("Run 'yarn gen:keys' to generate WALLET_KEY and ENCRYPTION_KEY.");
        process.exit(1);
    }

    return result;
};

/**
 * Log agent details for debugging
 * @param client - XMTP client instance
 */
export const logAgentDetails = async (client: Client) => {
    console.log("🤖 Agent Details:");
    console.log(`├─ Inbox ID: ${client.inboxId}`);
    console.log(`├─ Installation ID: ${client.installationId}`);
    console.log(`└─ Address: Available via signer`);
    console.log("");
}; 