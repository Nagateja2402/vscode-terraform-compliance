import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('extension.checkCompliance', async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const document = editor.document;
      const code = document.getText();
      const response = await fetch('http://localhost:3000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code }),
      });
      const result: any = await response.json();
      let suggestions: any;
      if (response.ok && result.suggestion) {
        vscode.window.showInformationMessage(result.suggestion);
        suggestions = JSON.parse(result.suggestion);
        vscode.window.showInformationMessage(suggestions);
        for (const suggestion of suggestions) {
          vscode.window.showInformationMessage(suggestion["suggested_code_snippet"]);
        }
      } else {
        vscode.window.showErrorMessage('Error fetching compliance results: ' + result.error);
      }
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
