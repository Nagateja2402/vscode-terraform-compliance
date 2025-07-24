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
    async analyzeTerraformCode(code: string): Promise<Suggestion[]> {
        try {
            console.log(code)
            let bedrockAPIKey = process.env.BEDROCK_API_KEY;
            const response = await fetch('https://tyur5kvly6.execute-api.us-east-1.amazonaws.com/dev/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': `${bedrockAPIKey}` },
            body: JSON.stringify({ code: code }),
            });
            console.log(response.status, response.statusText);
            if (!response.ok) {
                console.error('HTTP error:', response.status, response.statusText);
                return [];
            }

            const result: any = await response.json();
            if (!result.suggestion) {
                console.log('No suggestions available from server');
                return [];
            }
            let suggestions: Suggestion[] = [];
            try {
                suggestions = JSON.parse(result.suggestion);
                return suggestions;
            } catch (error) {
                console.error('LLM API call failed:', error);
                throw error;
            }
        }catch (error) {
            console.error('Error in LLMService:', error);
            throw error;
        }
    } 
}