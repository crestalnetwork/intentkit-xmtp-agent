/**
 * IntentKit API Response Types
 */
export interface IntentKitMessageAttachment {
    type: "link" | "image" | "file" | "xmtp";
    url?: string | null;
    json?: Record<string, any> | null;
}

export interface IntentKitMessage {
    id?: string;
    agent_id?: string;
    chat_id?: string;
    user_id?: string;
    author_id?: string;
    author_type: "agent" | "system" | "skill" | "API";
    message: string;
    skill_calls?: Array<{
        id?: string;
        name: string;
        parameters?: Record<string, any>;
        success?: boolean;
        response?: string;
        error_message?: string;
        credit_event_id?: string;
        credit_cost?: string;
    }>;
    attachments?: IntentKitMessageAttachment[];
    search_mode?: boolean;
    super_mode?: boolean;
    created_at?: string;
}

export interface IntentKitChat {
    id: string;
    agent_id: string;
    user_id: string;
    summary: string;
    rounds: number;
    created_at: string;
    updated_at: string;
}

export interface IntentKitAgent {
    id: string;
    name: string;
    description?: string;
    evm_wallet_address: string;
    created_at: string;
    updated_at: string;
}

export interface IntentKitStreamResponse {
    data?: IntentKitMessage;
    error?: string;
    done?: boolean;
}

/**
 * XMTP Wallet Send Calls Content Types
 * Based on @xmtp/content-type-wallet-send-calls
 */
export interface WalletSendCall {
    to: string;
    data?: string;
    value?: string;
}

export interface WalletSendCallsContent {
    calls: WalletSendCall[];
    chainId?: number;
    description?: string;
}

/**
 * IntentKit API Client
 */
export class IntentKitClient {
    private baseUrl: string;
    private apiKey?: string;
    private chatCache = new Map<string, string>(); // inboxId -> chatId

    constructor(baseUrl: string, apiKey?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
        this.apiKey = apiKey;
    }

    /**
     * Get or create chat ID for a user
     */
    async getChatId(userId: string): Promise<string> {
        // Check cache first
        if (this.chatCache.has(userId)) {
            return this.chatCache.get(userId)!;
        }

        try {
            // Pass user_id as query parameter according to OpenAPI spec
            const url = new URL(`${this.baseUrl}/v1/chats`);
            url.searchParams.set('user_id', userId);

            console.log(`🔗 Creating chat for user: ${userId}`);
            console.log(`📡 POST ${url.toString()}`);

            const response = await fetch(url.toString(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
                },
                // Empty body for POST request
            });

            console.log(`📊 Chat creation response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Chat creation failed: ${errorText}`);
                throw new Error(`Failed to create chat: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data: IntentKitChat = await response.json();
            console.log(`✅ Created chat ID: ${data.id}`);

            if (!data.id) {
                throw new Error(`Chat creation failed: Unable to get chat ID`);
            }

            // Cache the chat ID
            this.chatCache.set(userId, data.id);
            return data.id;

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error creating chat for user ${userId}:`, errorMessage);
            throw error;
        }
    }

    /**
     * Send message to IntentKit Agent API in stream mode
     */
    async* sendMessage(
        userId: string,
        message: string,
        chatId?: string
    ): AsyncGenerator<IntentKitMessage, void, unknown> {
        try {
            // Get or create chat ID
            const actualChatId = chatId || await this.getChatId(userId);

            const messageUrl = `${this.baseUrl}/v1/chats/${actualChatId}/messages`;
            console.log(`📤 Sending message to: ${messageUrl}`);
            console.log(`👤 User ID: ${userId}, Chat ID: ${actualChatId}`);

            const response = await fetch(messageUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
                },
                body: JSON.stringify({
                    message,
                    user_id: userId,
                    stream: true,
                }),
            });

            console.log(`📊 Message response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Message send failed: ${errorText}`);
                throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error("No response body received");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let responseYielded = false;

            console.log(`🔄 Starting to read stream response...`);

            try {
                // Add timeout for stream reading
                const timeoutMs = 30000; // 30 seconds
                const startTime = Date.now();

                while (true) {
                    // Check for timeout
                    if (Date.now() - startTime > timeoutMs) {
                        console.warn(`⏰ Stream reading timeout after ${timeoutMs}ms`);
                        break;
                    }
                    const { done, value } = await reader.read();

                    if (done) {
                        // Process any remaining buffer content
                        if (buffer.trim()) {
                            try {
                                const parsed = this.tryParseStreamChunk(buffer.trim());
                                if (parsed) {
                                    if (parsed.error) {
                                        console.error("Stream error:", parsed.error);
                                    } else if (parsed.data) {
                                        console.log(`🎯 Final buffer yielding response from ${parsed.data.author_type}`);
                                        responseYielded = true;
                                        yield parsed.data;
                                    }
                                }
                            } catch (parseError) {
                                console.warn("Failed to parse final buffer:", buffer);
                            }
                        }
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });

                    // Try to extract complete JSON objects from the buffer
                    const results = this.extractJsonFromBuffer(buffer);
                    buffer = results.remainingBuffer;

                    for (const jsonStr of results.jsonObjects) {
                        try {
                            const parsed = this.tryParseStreamChunk(jsonStr);
                            if (parsed) {
                                if (parsed.error) {
                                    console.error("Stream error:", parsed.error);
                                    continue;
                                }

                                if (parsed.data) {
                                    console.log(`🎯 Yielding response from ${parsed.data.author_type}: ${parsed.data.message.substring(0, 100)}...`);
                                    responseYielded = true;
                                    yield parsed.data;
                                }

                                if (parsed.done) {
                                    console.log("🏁 Stream marked as done");
                                    return;
                                }
                            }
                        } catch (parseError) {
                            console.warn("Failed to parse stream chunk:", jsonStr.substring(0, 100));
                            continue;
                        }
                    }
                }
            } finally {
                reader.releaseLock();
                console.log(`📊 Stream finished. Responses yielded: ${responseYielded}`);

                if (!responseYielded) {
                    console.warn(`⚠️  No responses were yielded from the stream. Final buffer content: ${buffer.substring(0, 500)}`);
                }
            }

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error sending message to IntentKit:`, errorMessage);

            // Yield a system error message
            yield {
                message: `Failed to process your request: ${errorMessage}`,
                author_type: "system"
            };
        }
    }

    /**
     * Helper method to extract complete JSON objects from a streaming buffer
     */
    private extractJsonFromBuffer(buffer: string): { jsonObjects: string[]; remainingBuffer: string } {
        const jsonObjects: string[] = [];
        let remainingBuffer = buffer;

        // Try to find complete JSON objects
        // This handles both SSE format and raw JSON chunks
        const lines = buffer.split('\n');
        const completeLines: string[] = [];

        // Keep the last line as it might be incomplete
        if (lines.length > 1) {
            completeLines.push(...lines.slice(0, -1));
            remainingBuffer = lines[lines.length - 1];
        }

        for (const line of completeLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Handle SSE format (data: {...})
            if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                if (jsonStr !== '[DONE]' && jsonStr !== 'null') {
                    jsonObjects.push(jsonStr);
                }
            }
            // Handle raw JSON chunks
            else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                jsonObjects.push(trimmed);
            }
            // Handle other potential formats
            else if (trimmed.includes('{') && trimmed.includes('}')) {
                // Try to extract JSON from the line
                const jsonMatch = trimmed.match(/\{.*\}/);
                if (jsonMatch) {
                    jsonObjects.push(jsonMatch[0]);
                }
            }
        }

        // Also try to parse the remaining buffer if it looks like complete JSON
        if (remainingBuffer.trim().startsWith('{') && remainingBuffer.trim().endsWith('}')) {
            try {
                JSON.parse(remainingBuffer.trim());
                jsonObjects.push(remainingBuffer.trim());
                remainingBuffer = '';
            } catch {
                // Keep it in buffer if it's not valid JSON yet
            }
        }

        return { jsonObjects, remainingBuffer };
    }

    /**
     * Helper method to try parsing a stream chunk with multiple possible formats
     */
    private tryParseStreamChunk(jsonStr: string): IntentKitStreamResponse | null {
        if (!jsonStr || jsonStr === '[DONE]' || jsonStr === 'null') {
            return null;
        }

        try {
            // Direct JSON parsing for IntentKitMessage
            const directParse = JSON.parse(jsonStr) as any;

            // If it's already in the expected stream response format
            if (directParse.data || directParse.error || directParse.done !== undefined) {
                return directParse as IntentKitStreamResponse;
            }

            // If it's a direct IntentKitMessage, wrap it in stream response format
            // Allow empty message if there are skill_calls or attachments (especially for skill author_type)
            if (directParse.author_type &&
                (directParse.message ||
                    directParse.skill_calls?.length > 0 ||
                    directParse.attachments?.length > 0)) {
                return {
                    data: directParse as IntentKitMessage,
                    done: false
                };
            }

            // Handle potential array responses
            if (Array.isArray(directParse) && directParse.length > 0) {
                const firstItem = directParse[0];
                // Allow empty message if there are skill_calls or attachments
                if (firstItem.author_type &&
                    (firstItem.message ||
                        firstItem.skill_calls?.length > 0 ||
                        firstItem.attachments?.length > 0)) {
                    return {
                        data: firstItem as IntentKitMessage,
                        done: false
                    };
                }
            }

            console.warn('Unknown response format:', jsonStr);
            return null;

        } catch (error) {
            console.warn('Failed to parse JSON chunk:', error instanceof Error ? error.message : String(error));
            return null;
        }
    }

    /**
     * Test API connectivity (useful for debugging)
     */
    async validateConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            console.log(`🔍 Testing connection to: ${this.baseUrl}`);

            // Try to access the OpenAPI spec endpoint to validate base URL
            const response = await fetch(`${this.baseUrl}/v1/openapi.json`, {
                method: "GET",
                headers: {
                    ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
                },
            });

            if (response.ok) {
                console.log(`✅ API connection successful: ${response.status}`);
                return { success: true };
            } else {
                const error = `API validation failed: ${response.status} ${response.statusText}`;
                console.error(`❌ ${error}`);
                return { success: false, error };
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Connection test failed: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Clear cached chat ID for a user (useful for testing or reset)
     */
    clearChatCache(userId?: string) {
        if (userId) {
            this.chatCache.delete(userId);
        } else {
            this.chatCache.clear();
        }
    }

    /**
     * Get current cache status (for debugging)
     */
    getCacheStatus() {
        return {
            size: this.chatCache.size,
            entries: Array.from(this.chatCache.entries())
        };
    }

    /**
     * Get the EVM wallet address for the authenticated agent.
     * Uses the GET /agent endpoint which returns information about the current agent.
     */
    async getAgentWalletAddress(): Promise<string | null> {
        try {
            const url = `${this.baseUrl}/v1/agent`;
            console.log(`🔗 Fetching agent wallet address`);
            console.log(`📡 GET ${url}`);

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
                },
            });

            console.log(`📊 Agent response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Failed to get agent wallet address: ${errorText}`);
                return null;
            }

            const data: IntentKitAgent = await response.json();
            console.log(`✅ Agent wallet address: ${data.evm_wallet_address}`);
            return data.evm_wallet_address;

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error getting agent wallet address:`, errorMessage);
            return null;
        }
    }
}

/**
 * Format skill calls for display
 * Shows "Calling skill [name] with [parameters]" format
 * For successful calls, hides the response
 * For failed calls, shows the error message
 */
export const formatSkillCalls = (skillCalls: IntentKitMessage["skill_calls"]): string => {
    if (!skillCalls || skillCalls.length === 0) {
        return "🔧 **Skills activated** (no details available)";
    }

    const formattedCalls = skillCalls.map(call => {
        // Format parameters as a readable string
        let parametersText = "";
        if (call.parameters && Object.keys(call.parameters).length > 0) {
            // Create a more readable parameter display
            const paramEntries = Object.entries(call.parameters).map(([key, value]) => {
                // Handle different value types
                if (typeof value === 'string') {
                    return `${key}: "${value}"`;
                } else if (typeof value === 'object' && value !== null) {
                    return `${key}: ${JSON.stringify(value)}`;
                } else {
                    return `${key}: ${value}`;
                }
            });
            parametersText = ` with ${paramEntries.join(', ')}`;
        }

        // Base message: "Calling skill [name] with [parameters]"
        let result = `🔧 Calling skill **${call.name}**${parametersText}`;

        // If the call failed, show the error message
        if (call.success === false && call.error_message) {
            result += `\n   ❌ Error: ${call.error_message}`;
        }
        // For successful calls, we don't show the response (hide it as requested)

        return result;
    });

    return formattedCalls.join("\n\n");
};

/**
 * Check if a message has XMTP attachments
 */
export const hasXmtpAttachments = (message: IntentKitMessage): boolean => {
    return !!(message.attachments?.some(attachment => attachment.type === "xmtp"));
};

/**
 * Extract XMTP wallet send calls from message attachments
 * The json field already contains formatted WalletSendCalls ready to send
 */
export const extractXmtpWalletSendCalls = (message: IntentKitMessage): any | null => {
    if (!message.attachments) {
        return null;
    }

    const xmtpAttachment = message.attachments.find(attachment => attachment.type === "xmtp");
    if (!xmtpAttachment || !xmtpAttachment.json) {
        return null;
    }

    try {
        // The XMTP attachment json field is already formatted by the Agent
        // and ready to be sent directly as WalletSendCalls
        return xmtpAttachment.json;
    } catch (error) {
        console.error("Failed to parse XMTP wallet send calls:", error);
        return null;
    }
};

/**
 * Format XMTP wallet send calls for display
 */
export const formatXmtpWalletSendCalls = (walletSendCalls: WalletSendCallsContent): string => {
    let result = "💳 **Transaction Request**\n";

    if (walletSendCalls.description) {
        result += `📝 Description: ${walletSendCalls.description}\n`;
    }

    if (walletSendCalls.chainId) {
        result += `⛓️ Chain ID: ${walletSendCalls.chainId}\n`;
    }

    result += `📋 Calls (${walletSendCalls.calls.length}):\n`;

    walletSendCalls.calls.forEach((call, index) => {
        result += `\n${index + 1}. **Transaction**\n`;
        result += `   📍 To: \`${call.to}\`\n`;

        if (call.value && call.value !== "0") {
            // Convert wei to ETH for display if it's a reasonable number
            try {
                const valueInWei = BigInt(call.value);
                const valueInEth = Number(valueInWei) / 1e18;
                result += `   💰 Value: ${call.value} wei (≈ ${valueInEth.toFixed(6)} ETH)\n`;
            } catch {
                result += `   💰 Value: ${call.value} wei\n`;
            }
        }

        if (call.data && call.data !== "0x") {
            result += `   📄 Data: \`${call.data.substring(0, 42)}${call.data.length > 42 ? '...' : ''}\`\n`;
        }
    });

    return result;
};

/**
 * Process IntentKit message and return appropriate content for XMTP
 * This function checks for XMTP attachments and returns the appropriate content type
 */
export const processIntentKitMessageForXmtp = (message: IntentKitMessage): {
    content: any;
    contentType?: string;
    displayText: string;
} => {
    // Check for XMTP wallet send calls first (highest priority)
    if (hasXmtpAttachments(message)) {
        const walletSendCalls = extractXmtpWalletSendCalls(message);
        if (walletSendCalls) {
            // Create display text for the transaction
            let displayText = message.message || "";
            if (walletSendCalls.calls && Array.isArray(walletSendCalls.calls)) {
                const transactionText = `💳 Transaction Request (${walletSendCalls.calls.length} calls)` +
                    (walletSendCalls.description ? `\n📝 ${walletSendCalls.description}` : "");

                if (displayText) {
                    displayText += "\n\n" + transactionText;
                } else {
                    displayText = transactionText;
                }
            }

            return {
                content: walletSendCalls,
                contentType: "xmtp/content-type-wallet-send-calls",
                displayText
            };
        }
    }

    // Default to text message
    let displayText = message.message || "";

    // Add skill calls if present
    if (message.skill_calls && message.skill_calls.length > 0) {
        const skillCallsText = formatSkillCalls(message.skill_calls);
        if (displayText) {
            displayText += "\n\n" + skillCallsText;
        } else {
            displayText = skillCallsText;
        }
    }

    // Add other attachments info if present
    if (message.attachments && message.attachments.length > 0) {
        const nonXmtpAttachments = message.attachments.filter(att => att.type !== "xmtp");
        if (nonXmtpAttachments.length > 0) {
            const attachmentsText = `📎 Attachments (${nonXmtpAttachments.length}):` +
                nonXmtpAttachments.map((att, idx) =>
                    `\n${idx + 1}. ${att.type}: ${att.url || 'embedded content'}`
                ).join("");

            if (displayText) {
                displayText += "\n\n" + attachmentsText;
            } else {
                displayText = attachmentsText;
            }
        }
    }

    return {
        content: displayText,
        contentType: "text",
        displayText
    };
}; 