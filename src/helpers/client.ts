import { getRandomValues } from "node:crypto";
import { IdentifierKind, type Signer, type Client, type XmtpEnv } from "@xmtp/node-sdk";
import { CdpClient } from "@coinbase/cdp-sdk";
import { fromString, toString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { toAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

interface User {
    account: ReturnType<typeof toAccount>;
    wallet: ReturnType<typeof createWalletClient>;
}

export interface CdpConfig {
    apiKeyId: string;
    apiKeySecret: string;
    walletSecret: string;
    walletAddress: string;
}

export const createUser = async (config: CdpConfig): Promise<User> => {
    try {
        const cdp = new CdpClient({
            apiKeyId: config.apiKeyId,
            apiKeySecret: config.apiKeySecret,
            walletSecret: config.walletSecret,
        });

        const cdpAccount = await cdp.evm.getAccount({ address: config.walletAddress as `0x${string}` });
        const account = toAccount(cdpAccount);

        const walletClient = createWalletClient({
            account,
            chain: sepolia,
            transport: http(),
        });

        return {
            account,
            wallet: walletClient,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`CDP account retrieval failed: ${errorMessage}. Check your CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET, and ensure the wallet address ${config.walletAddress} exists in your CDP account.`);
    }
};

export const createSigner = async (config: CdpConfig): Promise<Signer> => {
    const user = await createUser(config);
    const signerAddress = user.account.address.toLowerCase();

    const signer: Signer = {
        type: "EOA" as const,
        getIdentifier: () => ({
            identifierKind: IdentifierKind.Ethereum,
            identifier: signerAddress,
        }),
        signMessage: async (message: string) => {
            try {
                const signature = await user.wallet.signMessage({
                    message,
                    account: user.account,
                });
                return toBytes(signature);
            } catch (signError: unknown) {
                const signErrorMessage = signError instanceof Error ? signError.message : String(signError);
                throw new Error(`CDP message signing failed: ${signErrorMessage}`);
            }
        },
    };

    return signer;
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
 * Create CDP configuration from environment variables
 * @param env - Environment variables object (from validateEnvironment)
 * @returns CDP configuration object
 */
export const createCdpConfig = (env: Record<string, string>): CdpConfig => {
    return {
        apiKeyId: env.CDP_API_KEY_ID,
        apiKeySecret: env.CDP_API_KEY_SECRET,
        walletSecret: env.CDP_WALLET_SECRET,
        walletAddress: env.CDP_WALLET_ADDRESS,
    };
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
        console.error(`Missing required environment variables: ${missing.join(", ")}`);
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
    console.log("Agent Details:");
    console.log(`Inbox ID: ${client.inboxId}`);
    console.log(`Installation ID: ${client.installationId}`);
}; 