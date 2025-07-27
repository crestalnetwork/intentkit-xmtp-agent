import { writeFileSync, readFileSync, existsSync } from "fs";
import { generateEncryptionKeyHex, createSigner } from "../src/helpers/client";
import { generatePrivateKey } from "viem/accounts";

async function generateKeys() {
    console.log("🔑 Generating XMTP keys...\n");

    try {
        // Generate a new private key
        const walletKey = generatePrivateKey();
        console.log(`✅ Generated wallet private key: ${walletKey}`);

        // Generate encryption key for local database
        const encryptionKey = generateEncryptionKeyHex();
        console.log(`✅ Generated encryption key: ${encryptionKey}`);

        // Get the public address for reference
        const signer = createSigner(walletKey);
        const identifier = await signer.getIdentifier();
        const publicAddress = identifier.identifier;
        console.log(`✅ Corresponding public address: ${publicAddress}\n`);

        // Prepare the environment variables
        const envContent = `# IntentKit XMTP Agent Configuration
# Generated on ${new Date().toISOString()}

# XMTP Configuration
WALLET_KEY=${walletKey}
ENCRYPTION_KEY=${encryptionKey}
XMTP_ENV=dev

# IntentKit API Configuration
INTENTKIT_API_URL=https://your-intentkit-api.com
INTENTKIT_API_KEY=your-api-key-here

# Public address for reference: ${publicAddress}
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
        console.log("1. Update INTENTKIT_API_URL with your actual IntentKit API endpoint");
        console.log("2. Update INTENTKIT_API_KEY with your actual API key");
        console.log("3. Run 'yarn dev' to start the agent");
        console.log("\n⚠️  Keep your private keys secure and never commit them to version control!");

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("❌ Error generating keys:", errorMessage);
        process.exit(1);
    }
}

generateKeys(); 