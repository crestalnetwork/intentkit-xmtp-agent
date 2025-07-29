import "dotenv/config";
import {
    createSigner,
    createCdpConfig,
    getEncryptionKeyFromHex,
    logAgentDetails,
    validateEnvironment,
} from "./helpers/client.js";
import {
    IntentKitClient,
    formatSkillCalls,
    type IntentKitMessage
} from "./helpers/intentkit.js";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { MarkdownCodec } from "@xmtp/content-type-markdown";

// Validate required environment variables
const {
    ENCRYPTION_KEY,
    XMTP_ENV,
    INTENTKIT_API_URL,
    INTENTKIT_API_KEY,
    CDP_API_KEY_ID,
    CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET
} = validateEnvironment([
    "ENCRYPTION_KEY",
    "XMTP_ENV",
    "INTENTKIT_API_URL",
    "INTENTKIT_API_KEY",
    "CDP_API_KEY_ID",
    "CDP_API_KEY_SECRET",
    "CDP_WALLET_SECRET"
]);

async function main() {
    console.log("🚀 Starting IntentKit XMTP Agent...\n");

    try {
        // Initialize IntentKit client
        const intentKit = new IntentKitClient(INTENTKIT_API_URL, INTENTKIT_API_KEY);
        console.log("✅ IntentKit client initialized");
        console.log(`📡 API URL: ${INTENTKIT_API_URL}\n`);

        // Validate IntentKit API connection
        console.log("🔍 Validating IntentKit API connection...");
        const connectionTest = await intentKit.validateConnection();
        if (!connectionTest.success) {
            throw new Error(`IntentKit API validation failed: ${connectionTest.error}`);
        }
        console.log("✅ IntentKit API connection validated\n");

        // Get the EVM wallet address for the authenticated agent
        const agentWalletAddress = await intentKit.getAgentWalletAddress();
        if (!agentWalletAddress) {
            throw new Error("Failed to get agent wallet address");
        }

        // Initialize XMTP client
        console.log("🔧 Initializing XMTP client...");
        const cdpConfig = createCdpConfig({
            CDP_API_KEY_ID,
            CDP_API_KEY_SECRET,
            CDP_WALLET_SECRET,
            CDP_WALLET_ADDRESS: agentWalletAddress
        });
        const signer = await createSigner(cdpConfig);
        console.log("✅ Signer created successfully");

        const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
        console.log("✅ Database encryption key prepared");

        // Register markdown codec for rich text responses
        console.log("📝 Creating XMTP client with markdown codec...");
        console.log(`├─ XMTP Environment: ${XMTP_ENV}`);
        console.log(`├─ Database encryption key length: ${dbEncryptionKey.length} bytes`);
        console.log(`└─ Codecs: MarkdownCodec`);

        let client: Client;

        try {
            client = await Client.create(signer, {
                dbEncryptionKey,
                env: XMTP_ENV as XmtpEnv,
                codecs: [new MarkdownCodec()],
            });
            console.log("✅ XMTP client created successfully");
        } catch (clientError: unknown) {
            const clientErrorMessage = clientError instanceof Error ? clientError.message : String(clientError);
            const signerIdentifier = signer.getIdentifier();
            const signerAddress = typeof signerIdentifier === 'object' && 'identifier' in signerIdentifier
                ? signerIdentifier.identifier
                : 'unknown';

            console.error("❌ XMTP Client Creation Failed:");
            console.error(`├─ Error: ${clientErrorMessage}`);
            console.error(`├─ XMTP_ENV: ${XMTP_ENV}`);
            console.error(`├─ Signer address: ${signerAddress}`);
            console.error(`└─ DB encryption key valid: ${dbEncryptionKey.length === 32}`);

            // Try without MarkdownCodec
            console.log("🔄 Retrying without MarkdownCodec...");
            try {
                client = await Client.create(signer, {
                    dbEncryptionKey,
                    env: XMTP_ENV as XmtpEnv,
                });
                console.log("✅ XMTP client created successfully (without codec)");
            } catch (fallbackError: unknown) {
                const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                console.error("❌ XMTP Client creation failed even without codec:");
                console.error(`└─ Error: ${fallbackErrorMessage}`);

                // Try with a fresh database
                console.log("🔄 Retrying with fresh database...");
                try {
                    const freshDbPath = `./xmtp-fresh-${Date.now()}.db3`;
                    client = await Client.create(signer, {
                        dbEncryptionKey,
                        env: XMTP_ENV as XmtpEnv,
                        dbPath: freshDbPath,
                    });
                    console.log("✅ XMTP client created successfully (with fresh database)");
                    console.log(`⚠️  Using fresh database: ${freshDbPath}`);
                } catch (freshDbError: unknown) {
                    const freshDbErrorMessage = freshDbError instanceof Error ? freshDbError.message : String(freshDbError);
                    console.error("❌ XMTP Client creation failed with fresh database:");
                    console.error(`└─ Error: ${freshDbErrorMessage}`);

                    // Final fallback: Try using production environment if we were using dev
                    if (XMTP_ENV === "dev") {
                        console.log("🔄 Final fallback: Trying production environment...");
                        try {
                            client = await Client.create(signer, {
                                dbEncryptionKey,
                                env: "production" as XmtpEnv,
                                dbPath: `./xmtp-production-fallback-${Date.now()}.db3`,
                            });
                            console.log("✅ XMTP client created successfully (production fallback)");
                            console.log(`⚠️  Using production environment as fallback`);
                        } catch (prodFallbackError: unknown) {
                            const prodErrorMessage = prodFallbackError instanceof Error ? prodFallbackError.message : String(prodFallbackError);
                            console.error("❌ Production environment fallback also failed:");
                            console.error(`└─ Error: ${prodErrorMessage}`);
                            throw new Error(`All XMTP Client creation attempts failed. This suggests a network connectivity issue. Please check:\n1. Internet connection\n2. Firewall/proxy settings\n3. Try different network (mobile hotspot)\n\nErrors: Production: ${prodErrorMessage}, Fresh DB: ${freshDbErrorMessage}, Codec-less: ${fallbackErrorMessage}, Original: ${clientErrorMessage}`);
                        }
                    } else {
                        throw new Error(`XMTP Client creation failed completely. This suggests a network connectivity issue. Please check:\n1. Internet connection\n2. Firewall/proxy settings\n3. Try different network (mobile hotspot)\n\nErrors: Fresh DB: ${freshDbErrorMessage}, Codec-less: ${fallbackErrorMessage}, Original: ${clientErrorMessage}`);
                    }
                }
            }
        }

        console.log("📊 Logging agent details...");
        await logAgentDetails(client);
        console.log("✅ Agent details logged successfully");

        // Sync conversations before streaming
        console.log("🔄 Syncing conversations...");
        await client.conversations.sync();
        console.log("✅ Conversations synced\n");

        // Start message streaming with retry mechanism
        const MAX_RETRIES = 6;
        const RETRY_DELAY_MS = 10000;
        let retryCount = 0;

        while (retryCount < MAX_RETRIES) {
            try {
                console.log(`🎧 Starting message stream... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                const stream = await client.conversations.streamAllMessages();

                console.log("👂 Waiting for messages...\n");
                for await (const message of stream) {
                    // Skip messages from the agent itself or non-text messages
                    if (
                        message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
                        message?.contentType?.typeId !== "text"
                    ) {
                        continue;
                    }

                    await processMessage(client, intentKit, message);
                }

                // If we reach here without error, reset retry count
                retryCount = 0;

            } catch (error: unknown) {
                retryCount++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ Stream error: ${errorMessage}`);

                if (retryCount < MAX_RETRIES) {
                    console.log(`⏳ Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...\n`);
                    await sleep(RETRY_DELAY_MS);
                } else {
                    console.log("💀 Maximum retry attempts reached. Exiting.");
                    break;
                }
            }
        }

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("💥 Fatal error:", errorMessage);
        process.exit(1);
    }
}

/**
 * Process incoming XMTP message and forward to IntentKit
 */
async function processMessage(
    client: Client,
    intentKit: IntentKitClient,
    message: any
) {
    try {
        const messageContent = message.content as string;
        const senderInboxId = message.senderInboxId;

        console.log(`📨 Received message from ${senderInboxId}: "${messageContent}"`);

        // Get the conversation to reply to
        const conversation = await client.conversations.getConversationById(
            message.conversationId
        );

        if (!conversation) {
            console.log("❌ Could not find conversation for message");
            return;
        }

        // Forward message to IntentKit and process streaming responses
        console.log("🔄 Forwarding to IntentKit...");

        let responseCount = 0;
        for await (const response of intentKit.sendMessage(senderInboxId, messageContent)) {
            responseCount++;
            console.log(`📤 Processing IntentKit response ${responseCount}:`, response.author_type);

            await handleIntentKitResponse(conversation, response);
        }

        if (responseCount === 0) {
            console.log("⚠️  No responses received from IntentKit");
            await conversation.send("🤖 I didn't receive a response from the AI. Please try again.");
        } else {
            console.log(`✅ Processed ${responseCount} response(s) from IntentKit\n`);
        }

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("❌ Error processing message:", errorMessage);

        try {
            const conversation = await client.conversations.getConversationById(
                message.conversationId
            );
            if (conversation) {
                await conversation.send(`🚨 Sorry, I encountered an error: ${errorMessage}`);
            }
        } catch (replyError) {
            console.error("❌ Failed to send error reply:", replyError);
        }
    }
}

/**
 * Handle different types of IntentKit responses
 */
async function handleIntentKitResponse(
    conversation: any,
    response: IntentKitMessage
) {
    try {
        switch (response.author_type) {
            case "agent":
                // Send as plain text - the MarkdownCodec will handle formatting if needed
                await conversation.send(response.message);
                console.log("📝 Sent agent response");
                break;

            case "system":
                // System messages are errors - send as plain text with error emoji
                await conversation.send(`🚨 ${response.message}`);
                console.log("⚠️  Sent system error message");
                break;

            case "skill":
                // Render skill calls information
                const skillInfo = formatSkillCalls(response.skill_calls);
                await conversation.send(skillInfo);
                console.log("🔧 Sent skill execution details");
                break;

            default:
                // Fallback for unknown author types
                await conversation.send(response.message);
                console.log(`❓ Sent response with unknown author_type: ${response.author_type}`);
                break;
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to send response: ${errorMessage}`);

        // Try to send a simple error message
        try {
            await conversation.send("🚨 Failed to process the AI response. Please try again.");
        } catch (fallbackError) {
            console.error("❌ Failed to send fallback error message:", fallbackError);
        }
    }
}

/**
 * Helper function to pause execution
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Start the agent
main().catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
}); 