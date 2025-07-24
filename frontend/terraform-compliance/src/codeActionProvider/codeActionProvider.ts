import * as vscode from 'vscode';
import { SuggestionProvider } from '../suggestionProvider/suggestionProvider';

export class ComplianceCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private suggestionProvider: SuggestionProvider) {}
    
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const suggestions = this.suggestionProvider.getSuggestionsForUri(document.uri.toString());
        
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'Terraform Compliance' && typeof diagnostic.code === 'number') {
                const suggestion = suggestions[diagnostic.code];
                if (suggestion) {
                    // Accept action
                    const acceptAction = new vscode.CodeAction(
                        'Accept compliance suggestion',
                        vscode.CodeActionKind.QuickFix
                    );
                    acceptAction.command = {
                        command: 'terraformCompliance.acceptSuggestion',
                        title: 'Accept suggestion',
                        arguments: [suggestion]
                    };
                    acceptAction.isPreferred = true;
                    actions.push(acceptAction);
                    
                    // Decline action
                    const declineAction = new vscode.CodeAction(
                        'Decline suggestion',
                        vscode.CodeActionKind.QuickFix
                    );
                    declineAction.command = {
                        command: 'terraformCompliance.declineSuggestion',
                        title: 'Decline suggestion',
                        arguments: [suggestion]
                    };
                    actions.push(declineAction);
                }
            }
        }
        
        return actions;
    }
}