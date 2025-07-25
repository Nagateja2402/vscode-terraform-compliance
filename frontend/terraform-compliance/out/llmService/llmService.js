"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMService = void 0;
class LLMService {
    maxRetries = 3;
    retryDelay = 2000; // 2 seconds delay between retries
    async analyzeTerraformCode(code) {
        return this.analyzeWithRetry(code, 0);
    }
    async analyzeWithRetry(code, attempt) {
        try {
            const response = await fetch('https://tyur5kvly6.execute-api.us-east-1.amazonaws.com/dev/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'cdMxpyKS8F5GyDXMoD6Ix33B2BpIQYcX1tEccegb' },
                body: JSON.stringify({ code: code })
            });
            console.log(response.status, response.statusText);
            // Check for 504 timeout error and retry if attempts remain
            if (response.status === 504 && attempt < this.maxRetries) {
                console.log(`Received 504 timeout error. Retrying in ${this.retryDelay}ms... (Attempt ${attempt + 1}/${this.maxRetries + 1})`);
                await this.delay(this.retryDelay);
                return this.analyzeWithRetry(code, attempt + 1);
            }
            if (!response.ok) {
                console.error('HTTP error:', response.status, response.statusText);
                return [];
            }
            const result = await response.json();
            const suggestionJson = JSON.parse(result.body);
            if (!suggestionJson || !suggestionJson.suggestion) {
                console.log('No suggestions available from server');
                return [];
            }
            let suggestions = [];
            try {
                suggestions = JSON.parse(suggestionJson.suggestion);
                return suggestions;
            }
            catch (error) {
                console.error('LLM API call failed:', error);
                throw error;
            }
        }
        catch (error) {
            // Check if it's a network timeout error and retry if attempts remain
            if (this.isTimeoutError(error) && attempt < this.maxRetries) {
                console.log(`Network timeout error. Retrying in ${this.retryDelay}ms... (Attempt ${attempt + 1}/${this.maxRetries + 1})`);
                await this.delay(this.retryDelay);
                return this.analyzeWithRetry(code, attempt + 1);
            }
            console.error('Error in LLMService:', error);
            throw error;
        }
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    isTimeoutError(error) {
        // Check for common timeout error patterns
        return error && (error.code === 'TIMEOUT' ||
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('timeout') ||
            error.message?.includes('TIMEOUT'));
    }
}
exports.LLMService = LLMService;
//# sourceMappingURL=llmService.js.map