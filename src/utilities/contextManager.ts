import * as vscode from 'vscode';

export class ExtensionContextManager {
    private static _context: vscode.ExtensionContext;

    static initialize(context: vscode.ExtensionContext) {
        this._context = context;
    }

    static getContext(): vscode.ExtensionContext {
        if (!this._context) {
            throw new Error('Extension context not initialized');
        }
        return this._context;
    }
} 