import * as vscode from 'vscode';
import { SuggestionProvider } from './suggestionProvider/suggestionProvider';
import { Suggestion, LLMService } from './llmService/llmService';

export function activate(context: vscode.ExtensionContext) {
  // Initialize the suggestion provider
  const llmService = new LLMService();
  const suggestionProvider = new SuggestionProvider(llmService, context);
  
  // Start watching for changes
  suggestionProvider.startAutoAnalysis();
  
  // Handle suggestion acceptance from hover messages
  const acceptCommand = vscode.commands.registerCommand('terraformCompliance.acceptSuggestion', 
    async (suggestionArg: string | Suggestion) => {
      try {
        let suggestion: Suggestion;
        if (typeof suggestionArg === 'string') {
          suggestion = JSON.parse(decodeURIComponent(suggestionArg));
        } else {
          suggestion = suggestionArg;
        }
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor found');
          return;
        }
        
        const suggestions = suggestionProvider.getSuggestionsForUri(editor.document.uri.toString());
        const suggestionWithLocation = suggestions.find(s => 
          s.original_code_snippet === suggestion.original_code_snippet &&
          s.suggested_code_snippet === suggestion.suggested_code_snippet &&
          s.reasoning === suggestion.reasoning &&
          s.line_number === suggestion.line_number
        );
        
        if (suggestionWithLocation) {
          await suggestionProvider.applySuggestion(suggestionWithLocation);
        } else {
          vscode.window.showErrorMessage('Could not find the suggestion to apply');
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Error applying suggestion: ${error}`);
        console.error('Accept suggestion error:', error);
      }
    }
  );
  
  // Handle suggestion dismissal from hover messages
  const declineCommand = vscode.commands.registerCommand('terraformCompliance.declineSuggestion', 
    async (suggestionArg: string | Suggestion) => {
      try {
        let suggestion: Suggestion;
        if (typeof suggestionArg === 'string') {
          suggestion = JSON.parse(decodeURIComponent(suggestionArg));
        } else {
          suggestion = suggestionArg;
        }
        
        await suggestionProvider.declineSuggestion(suggestion);
      } catch (error) {
        vscode.window.showErrorMessage(`Error declining suggestion: ${error}`);
        console.error('Decline suggestion error:', error);
      }
    }
  );
  
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
      
    } catch (error) {
      vscode.window.showErrorMessage(`Error checking compliance: ${error}`);
      console.error('Check compliance error:', error);
    }
  });

  context.subscriptions.push(acceptCommand, declineCommand, toggleCommand, suggestionProvider, checkComplianceCommand);
}

export function deactivate() {}
