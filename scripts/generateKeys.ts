import { writeFileSync, readFileSync, existsSync } from "fs";
import { generateEncryptionKeyHex } from "../src/helpers/client";

async function generateKeys() {
    console.log("🔑 Generating XMTP keys...\n");

    try {
        // Generate encryption key for local database
        const encryptionKey = generateEncryptionKeyHex();
        console.log(`✅ Generated encryption key: ${encryptionKey}`);

        // Prepare the environment variables
        const envContent = `# IntentKit XMTP Agent Configuration
# Generated on ${new Date().toISOString()}

# XMTP Configuration
ENCRYPTION_KEY=${encryptionKey}
XMTP_ENV=dev

# Coinbase Developer Platform (CDP) Configuration
# Get these from your Coinbase Developer Platform account
CDP_API_KEY_ID=your-api-key-id-here
CDP_API_KEY_SECRET=your-api-key-secret-here
CDP_WALLET_SECRET=your-wallet-secret-here
CDP_WALLET_ADDRESS=your-wallet-address-here

# IntentKit API Configuration
INTENTKIT_API_URL=https://your-intentkit-api.com
INTENTKIT_API_KEY=your-api-key-here
`;

        // Check if .env file exists
        const envPath = ".env";
        if (existsSync(envPath)) {
            console.log("⚠️  .env file already exists. Creating .env.new instead.");
            writeFileSync(".env.new", envContent);
            console.log("📝 Keys saved to .env.new");
            console.log("📋 Please review and manually merge with your existing .env file.");
        } else {
            writeFileSync(envPath, envContent);
            console.log("📝 Keys saved to .env");
        }

        console.log("\n🎉 Key generation completed!");
        console.log("\n📋 Next steps:");
        console.log("1. Sign up for Coinbase Developer Platform at https://docs.cdp.coinbase.com/");
        console.log("2. Create a new project and get your API credentials");
        console.log("3. Create a wallet and get the wallet address and secret");
        console.log("4. Update CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET, and CDP_WALLET_ADDRESS");
        console.log("5. Update INTENTKIT_API_URL with your actual IntentKit API endpoint");
        console.log("6. Update INTENTKIT_API_KEY with your actual API key");
        console.log("7. Run 'yarn dev' to start the agent");
        console.log("\n⚠️  Keep your credentials secure and never commit them to version control!");

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("❌ Error generating keys:", errorMessage);
        process.exit(1);
    }
}

generateKeys(); 