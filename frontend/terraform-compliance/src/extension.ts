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
      console.log(result);
      if (response.ok && result.suggestion) {
        vscode.window.showOpenDialog
        vscode.window.showInformationMessage(result.suggestion);
      } else {
        vscode.window.showErrorMessage('Error fetching compliance results: ' + result.error);
      }
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
