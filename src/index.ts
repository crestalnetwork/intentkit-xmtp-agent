import "dotenv/config";
import {
    createSigner,
    getEncryptionKeyFromHex,
    logAgentDetails,
    validateEnvironment,
} from "@helpers/client";
import {
    IntentKitClient,
    formatSkillCalls,
    type IntentKitMessage
} from "@helpers/intentkit";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { MarkdownCodec } from "@xmtp/content-type-markdown";

// Validate required environment variables
const {
    WALLET_KEY,
    ENCRYPTION_KEY,
    XMTP_ENV,
    INTENTKIT_API_URL,
    INTENTKIT_API_KEY
} = validateEnvironment([
    "WALLET_KEY",
    "ENCRYPTION_KEY",
    "XMTP_ENV",
    "INTENTKIT_API_URL",
    "INTENTKIT_API_KEY"
]);

async function main() {
    console.log("🚀 Starting IntentKit XMTP Agent...\n");

    try {
        // Initialize XMTP client
        const signer = createSigner(WALLET_KEY as `0x${string}`);
        const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

        // Register markdown codec for rich text responses
        const client = await Client.create(signer, {
            dbEncryptionKey,
            env: XMTP_ENV as XmtpEnv,
            codecs: [new MarkdownCodec()],
        });

        await logAgentDetails(client);

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