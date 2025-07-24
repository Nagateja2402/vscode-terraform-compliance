// Provides intelligent Terraform compliance suggestions with visual indicators
import * as vscode from 'vscode';
import { LLMService, Suggestion, SuggestionWithLocation } from '../llmService/llmService';
import { ComplianceCodeActionProvider } from '../codeActionProvider/codeActionProvider';

export class SuggestionProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private suggestions: Map<string, SuggestionWithLocation[]> = new Map();
    private codeActionProvider: vscode.Disposable;
    private decorationType: vscode.TextEditorDecorationType;
    private autoAnalysisEnabled: boolean = true;
    private analysisTimeout: NodeJS.Timeout | undefined;
    private documentChangeListener: vscode.Disposable | undefined;
    private activeEditorChangeListener: vscode.Disposable | undefined;
    private lastAnalyzedContent: Map<string, string> = new Map();
    private isAnalyzing: boolean = false;
    private debounceDelay: number = 2000; // Wait 2 seconds after user stops typing
    private periodicAnalysisInterval: number = 30000; // Check every 30 seconds
    private periodicTimer: NodeJS.Timeout | undefined;
    private statusBarItem: vscode.StatusBarItem | undefined;
    private debugLogging: boolean = false;
    private maxSuggestionsPerFile: number = 5; // Prevent UI overcrowding
    
    constructor(
        private llmService: LLMService,
        private context: vscode.ExtensionContext
    ) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('terraform-compliance-assistant');
        
        this.loadSettings();
        
        // Visual styling for suggestion highlights
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            border: '1px solid rgba(255, 193, 7, 0.4)',
            borderRadius: '3px',
            overviewRulerColor: 'rgba(255, 193, 7, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            isWholeLine: false,
        });
        
        // Enable quick fix actions from the Problems panel
        this.codeActionProvider = vscode.languages.registerCodeActionsProvider(
            { language: 'terraform' },
            new ComplianceCodeActionProvider(this),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        );
        
        // Watch for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('terraformCompliance')) {
                    this.loadSettings();
                }
            })
        );
    }
    
    private loadSettings() {
        const config = vscode.workspace.getConfiguration('terraformCompliance');
        this.autoAnalysisEnabled = config.get('enableAutoAnalysis', true);
        this.debounceDelay = config.get('debounceDelay', 2000);
        this.periodicAnalysisInterval = config.get('analysisInterval', 30000);
        this.debugLogging = config.get('enableDebugLogging', false);
        this.maxSuggestionsPerFile = config.get('maxSuggestionsPerFile', 5);
    }
    
    startAutoAnalysis() {
        if (!this.autoAnalysisEnabled) return;
        
        // Watch for file changes and analyze after user stops typing
        this.documentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'terraform' && event.contentChanges.length > 0) {
                this.scheduleAnalysis(event.document);
            }
        });
        
        // Analyze when switching to a different Terraform file
        this.activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'terraform') {
                this.scheduleAnalysis(editor.document, 500);
            }
        });
        
        // Periodic background analysis to catch any missed changes
        this.periodicTimer = setInterval(() => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.languageId === 'terraform') {
                this.analyzeDocument(activeEditor.document);
            }
        }, this.periodicAnalysisInterval);
        
        // Analyze the current file right away
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.languageId === 'terraform') {
            this.analyzeDocument(activeEditor.document);
        }
        
        this.updateStatusBar();
    }
    
    private scheduleAnalysis(document: vscode.TextDocument, customDelay?: number) {
        if (!this.autoAnalysisEnabled) return;
        
        if (this.analysisTimeout) {
            clearTimeout(this.analysisTimeout);
        }
        
        this.analysisTimeout = setTimeout(() => {
            this.analyzeDocument(document);
        }, customDelay || this.debounceDelay);
    }

    private async analyzeDocument(document: vscode.TextDocument) {
        if (!this.autoAnalysisEnabled || this.isAnalyzing) return;
        
        const currentContent = document.getText();
        const lastContent = this.lastAnalyzedContent.get(document.uri.toString());
        
        // Skip if nothing changed
        if (lastContent === currentContent) return;
        
        this.isAnalyzing = true;
        this.updateStatusBar();
        
        try {
            const suggestions = await this.llmService.analyzeTerraformCode(currentContent);
            this.lastAnalyzedContent.set(document.uri.toString(), currentContent);
            this.processSuggestions(document, suggestions);
        } catch (error) {
            console.error('Analysis failed:', error);
            // Don't show errors to avoid annoying users during auto-analysis
        } finally {
            this.isAnalyzing = false;
            this.updateStatusBar();
        }
    }
    
    toggleAutoAnalysis() {
        this.autoAnalysisEnabled = !this.autoAnalysisEnabled;
        
        if (this.autoAnalysisEnabled) {
            this.startAutoAnalysis();
            vscode.window.showInformationMessage('Terraform auto-analysis enabled');
        } else {
            this.stopAutoAnalysis();
            vscode.window.showInformationMessage('Terraform auto-analysis disabled');
        }
        
        // Save preference
        vscode.workspace.getConfiguration('terraformCompliance')
            .update('enableAutoAnalysis', this.autoAnalysisEnabled, true);
    }
    
    private stopAutoAnalysis() {
        if (this.analysisTimeout) {
            clearTimeout(this.analysisTimeout);
            this.analysisTimeout = undefined;
        }
        
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = undefined;
        }
        
        this.documentChangeListener?.dispose();
        this.activeEditorChangeListener?.dispose();
        this.updateStatusBar();
    }
    
    private updateStatusBar() {
        if (!this.statusBarItem) {
            this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
            this.context.subscriptions.push(this.statusBarItem);
        }
        
        if (this.isAnalyzing) {
            this.statusBarItem.text = '$(sync~spin) Analyzing Terraform...';
            this.statusBarItem.tooltip = 'Checking for compliance issues';
            this.statusBarItem.backgroundColor = undefined;
        } else if (this.autoAnalysisEnabled) {
            const suggestionCount = this.getTotalSuggestionCount();
            if (suggestionCount > 0) {
                this.statusBarItem.text = `$(warning) ${suggestionCount} compliance ${suggestionCount === 1 ? 'issue' : 'issues'}`;
                this.statusBarItem.tooltip = `Found ${suggestionCount} compliance ${suggestionCount === 1 ? 'issue' : 'issues'}. Click to toggle auto-analysis.`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                this.statusBarItem.text = '$(check) Terraform Compliant';
                this.statusBarItem.tooltip = 'No compliance issues found. Auto-analysis enabled (click to toggle)';
                this.statusBarItem.backgroundColor = undefined;
            }
        } else {
            this.statusBarItem.text = '$(debug-pause) Analysis Paused';
            this.statusBarItem.tooltip = 'Terraform compliance auto-analysis is disabled (click to toggle)';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        }
        
        this.statusBarItem.command = 'terraformCompliance.toggleAutoAnalysis';
        this.statusBarItem.show();
    }
    
    private getTotalSuggestionCount(): number {
        let total = 0;
        this.suggestions.forEach(suggestions => {
            total += suggestions.length;
        });
        return total;
    }
    
    private processSuggestions(document: vscode.TextDocument, suggestions: Suggestion[]) {
        const uri = document.uri.toString();
        
        // Find exact locations for suggestions and prioritize them
        const validSuggestions = this.processAndValidateSuggestions(document, suggestions);
        const prioritizedSuggestions = this.prioritizeSuggestions(validSuggestions);
        const nonOverlappingSuggestions = this.removeOverlappingSuggestions(prioritizedSuggestions);
        const limitedSuggestions = nonOverlappingSuggestions.slice(0, this.maxSuggestionsPerFile);
        
        if (limitedSuggestions.length < nonOverlappingSuggestions.length && this.debugLogging) {
            console.log(`Limited suggestions from ${nonOverlappingSuggestions.length} to ${limitedSuggestions.length} to prevent overcrowding`);
        }
        
        this.suggestions.set(uri, limitedSuggestions);
        
        const diagnostics: vscode.Diagnostic[] = [];
        const decorations: vscode.DecorationOptions[] = [];
        
        for (let i = 0; i < limitedSuggestions.length; i++) {
            const suggestion = limitedSuggestions[i];
            const location = suggestion._location;
            
            if (!location) continue;
            
            const range = location.range;
            const severity = vscode.DiagnosticSeverity.Warning;
            
            // Add to Problems panel
            const diagnostic = new vscode.Diagnostic(
                range,
                `Compliance Issue: ${suggestion.reasoning}`,
                severity
            );
            diagnostic.source = 'Terraform Compliance Assistant';
            diagnostic.code = `suggestion-${i}`;
            diagnostics.push(diagnostic);
            
            // Add visual highlight with hover message
            const decorationOptions: vscode.DecorationOptions = {
                range: range,
                hoverMessage: this.createHoverMessage(suggestion),
                renderOptions: {
                    after: {
                        fontWeight: 'bold',
                        margin: '0 0 0 10px'
                    }
                }
            };
            
            decorations.push(decorationOptions);
        }
        
        this.diagnosticCollection.set(document.uri, diagnostics);
        
        // Apply visual highlights to the editor
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === uri) {
            editor.setDecorations(this.decorationType, decorations);
        }
        
        this.updateStatusBar();
    }

    // Prevent suggestions from overlapping visually
    private removeOverlappingSuggestions(suggestions: SuggestionWithLocation[]): SuggestionWithLocation[] {
        if (suggestions.length <= 1) return suggestions;
        
        const nonOverlapping: SuggestionWithLocation[] = [];
        let lastEndLine = -1;
        const minSpacing = 2; // Minimum lines between suggestions
        
        // Sort by line number first
        const sortedSuggestions = suggestions.sort((a, b) => {
            const aLine = a._location?.startLine || 0;
            const bLine = b._location?.startLine || 0;
            return aLine - bLine;
        });
        
        for (const suggestion of sortedSuggestions) {
            const location = suggestion._location;
            if (!location) continue;
            
            const currentStartLine = location.startLine;
            const currentEndLine = location.endLine;
            
            // Check if there's enough space from the previous suggestion
            if (currentStartLine >= lastEndLine + minSpacing) {
                nonOverlapping.push(suggestion);
                lastEndLine = currentEndLine;
                
                if (this.debugLogging) {
                    console.log(`Added suggestion at lines ${currentStartLine + 1}-${currentEndLine + 1}`);
                }
            } else if (this.debugLogging) {
                console.log(`Skipped overlapping suggestion at lines ${currentStartLine + 1}-${currentEndLine + 1}`);
            }
        }
        
        return nonOverlapping;
    }
    
    // Find the exact location of code in the document using multiple strategies
    private findCodeLocation(document: vscode.TextDocument, suggestion: Suggestion): {
        startLine: number;
        endLine: number;
        range: vscode.Range;
        found: boolean;
    } {
        const documentText = document.getText();
        const lines = documentText.split('\n');
        const originalCode = suggestion.original_code_snippet.trim();
        
        if (!originalCode) {
            // For insertions, try to find a good insertion point based on context
            const insertionPoint = this.findInsertionPoint(document, suggestion);
            return {
                startLine: insertionPoint,
                endLine: insertionPoint,
                range: new vscode.Range(insertionPoint, 0, insertionPoint, 0),
                found: true
            };
        }

        // Strategy 1: Exact multi-line match
        const exactMatch = this.findExactMultiLineMatch(lines, originalCode);
        if (exactMatch.found) {
            return {
                startLine: exactMatch.startLine,
                endLine: exactMatch.endLine,
                range: new vscode.Range(
                    exactMatch.startLine, 0,
                    exactMatch.endLine, lines[exactMatch.endLine]?.length || 0
                ),
                found: true
            };
        }

        // Strategy 2: Find Terraform resource blocks that match
        const resourceMatch = this.findTerraformResourceMatch(lines, originalCode);
        if (resourceMatch.found) {
            return {
                startLine: resourceMatch.startLine,
                endLine: resourceMatch.endLine,
                range: new vscode.Range(
                    resourceMatch.startLine, 0,
                    resourceMatch.endLine, lines[resourceMatch.endLine]?.length || 0
                ),
                found: true
            };
        }

        // Strategy 3: Fuzzy line matching with context
        const fuzzyMatch = this.findFuzzyMatch(lines, originalCode);
        if (fuzzyMatch.found) {
            return {
                startLine: fuzzyMatch.startLine,
                endLine: fuzzyMatch.endLine,
                range: new vscode.Range(
                    fuzzyMatch.startLine, 0,
                    fuzzyMatch.endLine, lines[fuzzyMatch.endLine]?.length || 0
                ),
                found: true
            };
        }

        console.warn(`Could not find location for original code: "${originalCode}"`);
        if (this.debugLogging) {
            console.warn('Available lines in document:', lines.slice(0, 15).map((line, idx) => `${idx + 1}: ${line.trim()}`));
        }

        // Fallback: use LLM's line number but validate it
        const llmLineNumber = Math.max(0, Math.min(suggestion.line_number - 1, document.lineCount - 1));
        return {
            startLine: llmLineNumber,
            endLine: llmLineNumber,
            range: new vscode.Range(llmLineNumber, 0, llmLineNumber, lines[llmLineNumber]?.length || 0),
            found: false
        };
    }

    private findExactMultiLineMatch(lines: string[], originalCode: string): { found: boolean; startLine: number; endLine: number } {
        const originalLines = originalCode.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        for (let i = 0; i <= lines.length - originalLines.length; i++) {
            let matchCount = 0;
            let consecutiveMatches = 0;
            
            for (let j = 0; j < originalLines.length; j++) {
                const documentLine = lines[i + j]?.trim() || '';
                const originalLine = originalLines[j];
                
                if (documentLine === originalLine) {
                    matchCount++;
                    consecutiveMatches++;
                } else if (documentLine.includes(originalLine) || originalLine.includes(documentLine)) {
                    matchCount += 0.5;
                } else {
                    consecutiveMatches = 0;
                }
            }
            
            // Require a high match ratio and some consecutive matches
            if (matchCount >= originalLines.length * 0.8 && consecutiveMatches >= Math.min(2, originalLines.length)) {
                return {
                    found: true,
                    startLine: i,
                    endLine: i + originalLines.length - 1
                };
            }
        }
        
        return { found: false, startLine: -1, endLine: -1 };
    }

    private findTerraformResourceMatch(lines: string[], originalCode: string): { found: boolean; startLine: number; endLine: number } {
        // Extract resource information from original code
        const resourceInfo = this.extractTerraformResourceInfo(originalCode);
        if (!resourceInfo) {
            return { found: false, startLine: -1, endLine: -1 };
        }

        // Find the resource block in the document
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Check if this line starts a resource block that matches our target
            if (this.isResourceDeclaration(line, resourceInfo)) {
                const blockEnd = this.findResourceBlockEnd(lines, i);
                if (blockEnd !== -1) {
                    // Verify this is the right resource by checking content similarity
                    const blockContent = lines.slice(i, blockEnd + 1).join('\n').trim();
                    const similarity = this.calculateContentSimilarity(blockContent, originalCode);
                    
                    if (similarity > 0.3) { // 30% similarity threshold
                        return {
                            found: true,
                            startLine: i,
                            endLine: blockEnd
                        };
                    }
                }
            }
        }
        
        return { found: false, startLine: -1, endLine: -1 };
    }

    private findFuzzyMatch(lines: string[], originalCode: string): { found: boolean; startLine: number; endLine: number } {
        const originalLines = originalCode.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const keywords = this.extractTerraformKeywords(originalCode);
        
        let bestMatch = { score: 0, startLine: -1, endLine: -1 };
        
        for (let i = 0; i < lines.length; i++) {
            for (let j = i; j < Math.min(i + originalLines.length + 5, lines.length); j++) {
                const blockLines = lines.slice(i, j + 1);
                const blockText = blockLines.join('\n').trim();
                
                let score = 0;
                
                // Score based on keyword matches
                const blockKeywords = this.extractTerraformKeywords(blockText);
                const commonKeywords = keywords.filter(k => blockKeywords.includes(k));
                score += commonKeywords.length * 10;
                
                // Score based on line similarity
                for (const originalLine of originalLines) {
                    for (const blockLine of blockLines) {
                        const similarity = this.calculateLineSimilarity(originalLine, blockLine.trim());
                        score += similarity * 5;
                    }
                }
                
                // Prefer blocks of similar length
                const lengthDiff = Math.abs(originalLines.length - blockLines.length);
                score -= lengthDiff * 2;
                
                if (score > bestMatch.score && score > 15) { // Minimum threshold
                    bestMatch = { score, startLine: i, endLine: j };
                }
            }
        }
        
        return {
            found: bestMatch.score > 15,
            startLine: bestMatch.startLine,
            endLine: bestMatch.endLine
        };
    }

    private findInsertionPoint(document: vscode.TextDocument, suggestion: Suggestion): number {
        const lines = document.getText().split('\n');
        const suggestedCode = suggestion.suggested_code_snippet.trim();
        
        // If suggested code is a resource, find a good place to insert it
        if (suggestedCode.includes('resource ')) {
            // Find the last resource block and insert after it
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim().startsWith('resource ')) {
                    const blockEnd = this.findResourceBlockEnd(lines, i);
                    return blockEnd !== -1 ? blockEnd + 1 : i + 1;
                }
            }
        }
        
        // Default to LLM suggestion or end of file
        const llmLine = Math.max(0, Math.min(suggestion.line_number - 1, document.lineCount));
        return llmLine;
    }

    private extractTerraformResourceInfo(code: string): { type: string; name: string } | null {
        const resourceMatch = code.match(/resource\s+"([^"]+)"\s+"([^"]+)"/);
        if (resourceMatch) {
            return {
                type: resourceMatch[1],
                name: resourceMatch[2]
            };
        }
        return null;
    }

    private isResourceDeclaration(line: string, resourceInfo: { type: string; name: string }): boolean {
        const resourcePattern = new RegExp(`resource\\s+"${resourceInfo.type}"\\s+"${resourceInfo.name}"`);
        return resourcePattern.test(line);
    }

    private findResourceBlockEnd(lines: string[], startLine: number): number {
        let braceCount = 0;
        let foundOpenBrace = false;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    foundOpenBrace = true;
                } else if (char === '}') {
                    braceCount--;
                    if (foundOpenBrace && braceCount === 0) {
                        return i;
                    }
                }
            }
        }
        
        return -1;
    }

    private calculateContentSimilarity(content1: string, content2: string): number {
        const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, ' ').trim();
        const norm1 = normalize(content1);
        const norm2 = normalize(content2);
        
        const words1 = norm1.split(' ');
        const words2 = norm2.split(' ');
        
        const intersection = words1.filter(word => words2.includes(word));
        const union = [...new Set([...words1, ...words2])];
        
        return intersection.length / union.length;
    }

    private calculateLineSimilarity(line1: string, line2: string): number {
        const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, '').trim();
        const norm1 = normalize(line1);
        const norm2 = normalize(line2);
        
        if (norm1 === norm2) return 1;
        if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.8;
        
        // Levenshtein distance approximation
        const maxLen = Math.max(norm1.length, norm2.length);
        if (maxLen === 0) return 1;
        
        let matches = 0;
        for (let i = 0; i < Math.min(norm1.length, norm2.length); i++) {
            if (norm1[i] === norm2[i]) matches++;
        }
        
        return matches / maxLen;
    }
    
    // Extract useful keywords from Terraform code for matching
    private extractTerraformKeywords(code: string): string[] {
        const terraformKeywords = [
            'resource', 'data', 'variable', 'output', 'locals', 'module',
            'provider', 'terraform', 'aws_', 'azurerm_', 'google_'
        ];
        
        const keywords: string[] = [];
        const normalizedCode = code.toLowerCase();
        
        for (const keyword of terraformKeywords) {
            if (normalizedCode.includes(keyword)) {
                keywords.push(keyword);
            }
        }
        
        // Also extract resource names and types
        const resourceMatch = code.match(/resource\s+"([^"]+)"\s+"([^"]+)"/);
        if (resourceMatch) {
            keywords.push(resourceMatch[1], resourceMatch[2]);
        }
        
        return keywords;
    }

    private createHoverMessage(suggestion: Suggestion): vscode.MarkdownString {
        const message = new vscode.MarkdownString();
        
        // Show what code will be changed
        if (suggestion.original_code_snippet && suggestion.original_code_snippet.trim()) {
            message.appendMarkdown(`## Current Code\n`);
            message.appendCodeblock(suggestion.original_code_snippet, 'terraform');
            message.appendMarkdown(`\n`);
        }

        // Show the improvement
        message.appendMarkdown(`## Suggested Improvement\n`);
        message.appendCodeblock(suggestion.suggested_code_snippet, 'terraform');
        message.appendMarkdown(`\n---\n\n`);
        
        // Action buttons
        const suggestionJson = JSON.stringify(suggestion);
        const encodedSuggestion = encodeURIComponent(suggestionJson);
        
        const acceptUri = `command:terraformCompliance.acceptSuggestion?${encodedSuggestion}`;
        const declineUri = `command:terraformCompliance.declineSuggestion?${encodedSuggestion}`;
        
        message.appendMarkdown(
            `[Accept](${acceptUri} "Apply this suggestion") • ` +
            `[Dismiss](${declineUri} "Remove this suggestion from view")\n\n`
        );
        
        // Show line number for reference
        const lineInfo = suggestion.line_number ? `**Line:** ${suggestion.line_number}` : '';
        if (lineInfo) {
            message.appendMarkdown(`---\n*${lineInfo}*`);
        }
        
        message.isTrusted = true;
        message.supportHtml = false;
        
        return message;
    }

    async applySuggestion(suggestion: SuggestionWithLocation | Suggestion) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        const document = editor.document;
        
        // Ensure we have location information
        let suggestionWithLocation: SuggestionWithLocation;
        if ('_location' in suggestion) {
            suggestionWithLocation = suggestion as SuggestionWithLocation;
        } else {
            // Find the suggestion with location data from our stored suggestions
            const suggestions = this.getSuggestionsForUri(document.uri.toString());
            const found = suggestions.find(s => 
                s.original_code_snippet === suggestion.original_code_snippet &&
                s.suggested_code_snippet === suggestion.suggested_code_snippet &&
                s.reasoning === suggestion.reasoning &&
                s.line_number === suggestion.line_number
            );
            
            if (found) {
                suggestionWithLocation = found;
            } else {
                // Fallback: create location info on-the-fly
                const location = this.findCodeLocation(document, suggestion);
                suggestionWithLocation = {
                    ...suggestion,
                    _location: location
                };
            }
        }
        
        // Find the actual location by searching for the original code snippet
        const location = suggestionWithLocation._location || this.findCodeLocation(document, suggestionWithLocation);
        
        if (!location.found && suggestionWithLocation.original_code_snippet?.trim()) {
            vscode.window.showErrorMessage('Could not locate the original code in the document. The file may have been modified.');
            return;
        }
        
        await editor.edit(editBuilder => {
            if (!suggestionWithLocation.original_code_snippet || suggestionWithLocation.original_code_snippet.trim() === '') {
                // Insert new code at the determined location
                const position = new vscode.Position(location.startLine, 0);
                const indentedSuggestion = this.getProperIndentation(document, location.startLine) + suggestionWithLocation.suggested_code_snippet;
                editBuilder.insert(position, indentedSuggestion + '\n');
            } else {
                // Replace the entire range with the suggested code
                const indentedSuggestion = this.getProperIndentation(document, location.startLine) + suggestionWithLocation.suggested_code_snippet;
                editBuilder.replace(location.range, indentedSuggestion);
            }
        });
        
        // Remove this suggestion from our tracking
        this.removeSuggestion(document.uri.toString(), suggestionWithLocation);
        vscode.window.showInformationMessage('Suggestion applied successfully');
    }

    // Get proper indentation for a line
    private getProperIndentation(document: vscode.TextDocument, lineNumber: number): string {
        if (lineNumber >= document.lineCount) return '';
        
        const line = document.lineAt(lineNumber);
        const match = line.text.match(/^(\s*)/);
        return match ? match[1] : '';
    }

    private removeSuggestion(uri: string, suggestion: Suggestion | SuggestionWithLocation): boolean {
        const suggestions = this.suggestions.get(uri);
        if (!suggestions) {
            if (this.debugLogging) {
                console.log(`No suggestions found for URI: ${uri}`);
            }
            return false;
        }
        
        // Find the suggestion by comparing its core properties
        const index = suggestions.findIndex(s => 
            s.original_code_snippet === suggestion.original_code_snippet &&
            s.suggested_code_snippet === suggestion.suggested_code_snippet &&
            s.line_number === suggestion.line_number &&
            s.reasoning === suggestion.reasoning
        );
        
        if (index > -1) {
            const removedSuggestion = suggestions.splice(index, 1)[0];
            
            if (this.debugLogging) {
                console.log(`Removed suggestion at index ${index} for URI: ${uri}`);
                console.log(`Remaining suggestions: ${suggestions.length}`);
            }
            
            // Clear all diagnostics and decorations for this document first
            this.diagnosticCollection.delete(vscode.Uri.parse(uri));
            
            // Clear decorations immediately
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === uri) {
                editor.setDecorations(this.decorationType, []);
            }
            
            // Re-process remaining suggestions if any exist
            const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
            if (document && suggestions.length > 0) {
                // Convert back to basic Suggestion objects for reprocessing
                const basicSuggestions: Suggestion[] = suggestions.map(s => ({
                    original_code_snippet: s.original_code_snippet,
                    suggested_code_snippet: s.suggested_code_snippet,
                    line_number: s.line_number,
                    reasoning: s.reasoning
                }));
                
                // Reprocess the remaining suggestions to update decorations and diagnostics
                this.processSuggestions(document, basicSuggestions);
            } else if (suggestions.length === 0) {
                // No suggestions left, ensure everything is cleaned up
                if (editor && editor.document.uri.toString() === uri) {
                    editor.setDecorations(this.decorationType, []);
                }
                this.diagnosticCollection.delete(vscode.Uri.parse(uri));
            }
            
            this.updateStatusBar();
            return true;
        } else {
            if (this.debugLogging) {
                console.log(`Could not find suggestion to remove for URI: ${uri}`);
                console.log(`Available suggestions:`, suggestions.map(s => ({
                    line: s.line_number,
                    reasoning: s.reasoning.substring(0, 50) + '...'
                })));
            }
            return false;
        }
    }

    async declineSuggestion(suggestion: Suggestion) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }
        
        if (this.debugLogging) {
            console.log('Declining suggestion:', {
                line: suggestion.line_number,
                reasoning: suggestion.reasoning.substring(0, 50) + '...',
                originalCode: suggestion.original_code_snippet?.substring(0, 30) + '...'
            });
        }
        
        const removed = this.removeSuggestion(editor.document.uri.toString(), suggestion);
        if (removed) {
            vscode.window.showInformationMessage('Suggestion dismissed successfully');
            if (this.debugLogging) {
                console.log('Successfully declined and removed suggestion');
            }
        } else {
            vscode.window.showWarningMessage('Could not find suggestion to dismiss. It may have already been removed.');
            if (this.debugLogging) {
                console.log('Failed to find suggestion to decline');
            }
        }
    }

    getSuggestionsForUri(uri: string): SuggestionWithLocation[] {
        return this.suggestions.get(uri) || [];
    }
    
    // Process suggestions and find their exact locations in the document
    private processAndValidateSuggestions(document: vscode.TextDocument, suggestions: Suggestion[]): SuggestionWithLocation[] {
        const validSuggestions: SuggestionWithLocation[] = [];
        
        for (const suggestion of suggestions) {
            if (this.debugLogging) {
                console.log(`Processing suggestion for line ${suggestion.line_number}: "${suggestion.original_code_snippet}"`);
            }
            
            const location = this.findCodeLocation(document, suggestion);
            
            const correctedSuggestion: SuggestionWithLocation = {
                ...suggestion,
                line_number: location.found ? location.startLine + 1 : suggestion.line_number,
                _location: location
            };
            
            validSuggestions.push(correctedSuggestion);
            
            if (this.debugLogging) {
                console.log(`  ${location.found ? 'Found' : 'Using fallback'} location: lines ${location.startLine + 1}-${location.endLine + 1}`);
            }
        }
        
        return validSuggestions;
    }

    // Sort suggestions by importance (security > performance > general)
    private prioritizeSuggestions(suggestions: SuggestionWithLocation[]): SuggestionWithLocation[] {
        return suggestions.sort((a, b) => {
            // Suggestions with confirmed locations first
            const aFound = a._location?.found ? 1 : 0;
            const bFound = b._location?.found ? 1 : 0;
            if (aFound !== bFound) return bFound - aFound;
            
            // Security issues first
            const aIsSecurityRelated = this.isSecurityRelated(a.reasoning);
            const bIsSecurityRelated = this.isSecurityRelated(b.reasoning);
            if (aIsSecurityRelated !== bIsSecurityRelated) {
                return bIsSecurityRelated ? 1 : -1;
            }
            
            // Performance issues second
            const aIsPerformanceRelated = this.isPerformanceRelated(a.reasoning);
            const bIsPerformanceRelated = this.isPerformanceRelated(b.reasoning);
            if (aIsPerformanceRelated !== bIsPerformanceRelated) {
                return bIsPerformanceRelated ? 1 : -1;
            }
            
            // Earlier lines first
            return a.line_number - b.line_number;
        });
    }
    
    // Check if a suggestion is related to security
    private isSecurityRelated(reasoning: string): boolean {
        const securityKeywords = [
            'security', 'encryption', 'vulnerable', 'exposure', 'access', 'permission',
            'public', 'private', 'ssl', 'tls', 'https', 'authentication', 'authorization'
        ];
        return securityKeywords.some(keyword => 
            reasoning.toLowerCase().includes(keyword.toLowerCase())
        );
    }
    
    // Check if a suggestion is related to performance
    private isPerformanceRelated(reasoning: string): boolean {
        const performanceKeywords = [
            'performance', 'optimization', 'cost', 'efficient', 'resource', 'scaling',
            'capacity', 'throughput', 'latency', 'bandwidth'
        ];
        return performanceKeywords.some(keyword => 
            reasoning.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    dispose() {
        this.stopAutoAnalysis();
        this.diagnosticCollection.dispose();
        this.codeActionProvider.dispose();
        this.decorationType.dispose();
        this.statusBarItem?.dispose();
    }

    // Manually analyze document for compliance issues (called from command)
    async manualAnalyzeDocument(document: vscode.TextDocument): Promise<void> {
        if (this.isAnalyzing) {
            vscode.window.showWarningMessage('Analysis already in progress. Please wait...');
            return;
        }
        
        this.isAnalyzing = true;
        this.updateStatusBar();
        
        try {
            const currentContent = document.getText();
            const suggestions = await this.llmService.analyzeTerraformCode(currentContent);
            
            // Update the last analyzed content for this document
            this.lastAnalyzedContent.set(document.uri.toString(), currentContent);
            
            // Process and display the suggestions
            this.processSuggestions(document, suggestions);
            
            // Show user feedback about the results
            const suggestionCount = suggestions.length;
            if (suggestionCount > 0) {
                const limitedCount = Math.min(suggestionCount, this.maxSuggestionsPerFile);
                vscode.window.showInformationMessage(
                    `Found ${suggestionCount} compliance ${suggestionCount === 1 ? 'issue' : 'issues'}. ` +
                    `Showing top ${limitedCount} suggestions.`
                );
            } else {
                vscode.window.showInformationMessage('✅ No compliance issues found! Your Terraform code looks good.');
            }
            
        } catch (error) {
            console.error('Manual analysis failed:', error);
            vscode.window.showErrorMessage(`Failed to analyze Terraform code: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.isAnalyzing = false;
            this.updateStatusBar();
        }
    }
}