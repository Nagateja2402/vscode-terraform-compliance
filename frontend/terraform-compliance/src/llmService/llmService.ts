export interface Suggestion {
    original_code_snippet: string;
    suggested_code_snippet: string;
    line_number: number;
    reasoning: string;
}

export interface SuggestionWithLocation extends Suggestion {
    _location?: {
        startLine: number;
        endLine: number;
        range: any; // vscode.Range
        found: boolean;
    };
}

export class LLMService {
    private readonly maxRetries = 3;
    private readonly retryDelay = 2000; // 2 seconds delay between retries

    async analyzeTerraformCode(code: string): Promise<Suggestion[]> {
        return this.analyzeWithRetry(code, 0);
    }

    private async analyzeWithRetry(code: string, attempt: number): Promise<Suggestion[]> {
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

            const result: any = await response.json();
            const suggestionJson = JSON.parse(result.body);
            
            if (!suggestionJson || !suggestionJson.suggestion) {
                console.log('No suggestions available from server');
                return [];
            }
            
            let suggestions: Suggestion[] = [];
            try {
                suggestions = JSON.parse(suggestionJson.suggestion);
                return suggestions;
            } catch (error) {
                console.error('LLM API call failed:', error);
                throw error;
            }
        } catch (error) {
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

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private isTimeoutError(error: any): boolean {
        // Check for common timeout error patterns
        return error && (
            error.code === 'TIMEOUT' ||
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('timeout') ||
            error.message?.includes('TIMEOUT')
        );
    }
}