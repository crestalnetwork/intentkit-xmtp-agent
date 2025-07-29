/**
 * IntentKit API Response Types
 */
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
            if (directParse.author_type && directParse.message) {
                return {
                    data: directParse as IntentKitMessage,
                    done: false
                };
            }

            // Handle potential array responses
            if (Array.isArray(directParse) && directParse.length > 0) {
                const firstItem = directParse[0];
                if (firstItem.author_type && firstItem.message) {
                    return {
                        data: firstItem as IntentKitMessage,
                        done: false
                    };
                }
            }

            console.warn('Unknown response format:', jsonStr.substring(0, 200));
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
 */
export const formatSkillCalls = (skillCalls: IntentKitMessage["skill_calls"]): string => {
    if (!skillCalls || skillCalls.length === 0) {
        return "🔧 **Skills activated** (no details available)";
    }

    const formattedCalls = skillCalls.map(call => {
        let result = `🔧 **${call.name}**`;

        if (call.parameters && Object.keys(call.parameters).length > 0) {
            result += `\n   Parameters: ${JSON.stringify(call.parameters, null, 2)}`;
        }

        if (call.response) {
            result += `\n   Result: ${call.response}`;
        }

        return result;
    });

    return formattedCalls.join("\n\n");
}; 