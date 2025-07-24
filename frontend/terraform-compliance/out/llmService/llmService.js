"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMService = void 0;
class LLMService {
    async analyzeTerraformCode(code) {
        try {
            const response = await fetch('http://localhost:3000/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code }),
            });
            if (!response.ok) {
                console.error('HTTP error:', response.status, response.statusText);
                return [];
            }
            const result = await response.json();
            if (!result.suggestion) {
                console.log('No suggestions available from server');
                return [];
            }
            let suggestions = [];
            try {
                suggestions = JSON.parse(result.suggestion);
                return suggestions;
            }
            catch (error) {
                console.error('LLM API call failed:', error);
                throw error;
            }
        }
        catch (error) {
            console.error('Error in LLMService:', error);
            throw error;
        }
    }
}
exports.LLMService = LLMService;
//# sourceMappingURL=llmService.js.map