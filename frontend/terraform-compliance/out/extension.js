"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const suggestionProvider_1 = require("./suggestionProvider/suggestionProvider");
const llmService_1 = require("./llmService/llmService");
function activate(context) {
    // Initialize the suggestion provider
    const llmService = new llmService_1.LLMService();
    const suggestionProvider = new suggestionProvider_1.SuggestionProvider(llmService, context);
    // Start watching for changes
    suggestionProvider.startAutoAnalysis();
    // Handle suggestion acceptance from hover messages
    const acceptCommand = vscode.commands.registerCommand('terraformCompliance.acceptSuggestion', async (suggestionArg) => {
        try {
            let suggestion;
            if (typeof suggestionArg === 'string') {
                suggestion = JSON.parse(decodeURIComponent(suggestionArg));
            }
            else {
                suggestion = suggestionArg;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return;
            }
            const suggestions = suggestionProvider.getSuggestionsForUri(editor.document.uri.toString());
            const suggestionWithLocation = suggestions.find(s => s.original_code_snippet === suggestion.original_code_snippet &&
                s.suggested_code_snippet === suggestion.suggested_code_snippet &&
                s.reasoning === suggestion.reasoning &&
                s.line_number === suggestion.line_number);
            if (suggestionWithLocation) {
                await suggestionProvider.applySuggestion(suggestionWithLocation);
            }
            else {
                vscode.window.showErrorMessage('Could not find the suggestion to apply');
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error applying suggestion: ${error}`);
            console.error('Accept suggestion error:', error);
        }
    });
    // Handle suggestion dismissal from hover messages
    const declineCommand = vscode.commands.registerCommand('terraformCompliance.declineSuggestion', async (suggestionArg) => {
        try {
            let suggestion;
            if (typeof suggestionArg === 'string') {
                suggestion = JSON.parse(decodeURIComponent(suggestionArg));
            }
            else {
                suggestion = suggestionArg;
            }
            await suggestionProvider.declineSuggestion(suggestion);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error declining suggestion: ${error}`);
            console.error('Decline suggestion error:', error);
        }
    });
    // Toggle auto-analysis from status bar
    const toggleCommand = vscode.commands.registerCommand('terraformCompliance.toggleAutoAnalysis', () => {
        suggestionProvider.toggleAutoAnalysis();
    });
    // Check for terraform compliance manually
    const checkComplianceCommand = vscode.commands.registerCommand('terraformCompliance.checkCompliance', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }
        try {
            if (editor.document.languageId !== 'terraform') {
                vscode.window.showErrorMessage('Current file is not a Terraform file (.tf or .tfvars)');
                return;
            }
            // Show progress indicator while analyzing
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Checking Terraform Compliance",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Analyzing code..." });
                await suggestionProvider.manualAnalyzeDocument(editor.document);
                progress.report({ message: "Analysis complete!" });
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error checking compliance: ${error}`);
            console.error('Check compliance error:', error);
        }
    });
    context.subscriptions.push(acceptCommand, declineCommand, toggleCommand, suggestionProvider, checkComplianceCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map