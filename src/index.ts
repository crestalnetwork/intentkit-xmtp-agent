import "dotenv/config";
import {
    createSigner,
    createCdpConfig,
    getEncryptionKeyFromHex,
    getDbPath,
    logAgentDetails,
    validateEnvironment,
} from "./helpers/client.js";
import {
    IntentKitClient,
    formatSkillCalls,
    processIntentKitMessageForXmtp,
    type IntentKitMessage
} from "./helpers/intentkit.js";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";

import {
    WalletSendCallsCodec,
    ContentTypeWalletSendCalls
} from "@xmtp/content-type-wallet-send-calls";



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

        // Register codecs for rich text responses and wallet transactions
        console.log("📝 Creating XMTP client with codecs...");
        console.log(`├─ XMTP Environment: ${XMTP_ENV}`);
        console.log(`├─ Database encryption key length: ${dbEncryptionKey.length} bytes`);
        console.log(`└─ Codecs: WalletSendCallsCodec`);

        let client: any;

        try {
            const signerIdentifier = await Promise.resolve(signer.getIdentifier());
            const identifier = signerIdentifier.identifier || 'default';
            const dbPath = getDbPath(`${XMTP_ENV}-${identifier}`);
            console.log(`├─ Database path: ${dbPath}`);

            client = await Client.create(signer, {
                dbEncryptionKey,
                env: XMTP_ENV as XmtpEnv,
                dbPath,
                codecs: [new WalletSendCallsCodec()],
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

            // Try without codecs
            console.log("🔄 Retrying without codecs...");
            try {
                const signerIdentifier = await Promise.resolve(signer.getIdentifier());
                const identifier = signerIdentifier.identifier || 'default';
                const dbPath = getDbPath(`${XMTP_ENV}-${identifier}-no-codec`);
                client = await Client.create(signer, {
                    dbEncryptionKey,
                    env: XMTP_ENV as XmtpEnv,
                    dbPath,
                });
                console.log("✅ XMTP client created successfully (without codecs)");
            } catch (fallbackError: unknown) {
                const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                console.error("❌ XMTP Client creation failed even without codec:");
                console.error(`└─ Error: ${fallbackErrorMessage}`);

                // Try with a fresh database
                console.log("🔄 Retrying with fresh database...");
                try {
                    const freshDbPath = getDbPath(`${XMTP_ENV}-fresh-${Date.now()}`);
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
                            const prodFallbackPath = getDbPath(`production-fallback-${Date.now()}`);
                            client = await Client.create(signer, {
                                dbEncryptionKey,
                                env: "production" as XmtpEnv,
                                dbPath: prodFallbackPath,
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

        // Get inbox state to extract the wallet address
        const inboxState = await client.preferences.inboxStateFromInboxIds([senderInboxId]);
        if (!inboxState || inboxState.length === 0) {
            console.log("❌ Could not get inbox state for sender");
            return;
        }

        // Find the wallet address (identifierKind = 0)
        const senderInfo = inboxState[0];
        const walletIdentifier = senderInfo.identifiers.find(
            (identifier: any) => identifier.identifierKind === 0
        );

        if (!walletIdentifier) {
            console.log("❌ Could not find wallet address for sender");
            return;
        }

        const userWalletAddress = walletIdentifier.identifier;
        console.log(`💳 Using wallet address as user_id: ${userWalletAddress}`);

        // Get the conversation to reply to
        const conversation = await client.conversations.getConversationById(
            message.conversationId
        );

        if (!conversation) {
            console.log("❌ Could not find conversation for message");
            return;
        }

        // Forward message to IntentKit using wallet address as user_id
        console.log("🔄 Forwarding to IntentKit...");

        let responseCount = 0;
        for await (const response of intentKit.sendMessage(userWalletAddress, messageContent)) {
            responseCount++;
            console.log(`📤 Processing IntentKit response ${responseCount}:`, response.author_type);

            await handleIntentKitResponse(client, conversation, response);
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
    client: Client,
    conversation: any,
    response: IntentKitMessage
) {
    try {
        // Process the message for XMTP, checking for wallet send calls attachments
        const processed = processIntentKitMessageForXmtp(response);

        if (processed.contentType === "xmtp/content-type-wallet-send-calls") {
            // Send as wallet send calls content type with explicit content type
            await conversation.send(processed.content, ContentTypeWalletSendCalls);
            console.log("💳 Sent wallet transaction request");
        } else {
            // Send as regular text (no special handling for markdown)
            await conversation.send(processed.content);
            console.log(`📝 Sent ${response.author_type} response as text`);
        }

        // Log additional context based on author type
        switch (response.author_type) {
            case "system":
                console.log("⚠️  System message processed");
                break;
            case "skill":
                console.log("🔧 Skill execution details processed");
                break;
            case "agent":
                console.log("🤖 Agent response processed");
                break;
            default:
                console.log(`❓ Response with author_type: ${response.author_type} processed`);
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