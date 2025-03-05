// This file provides a safe wrapper around the VS Code API

// The VS Code API should be available globally as `vscode` via our HTML template
// Define interface for type safety
declare global {
  interface Window {
    vscode: any;
    vscodeMessaging: {
      pendingMessages: any[];
      initialized: boolean;
      registerHandler: (handler: (message: any) => void) => void;
      handleExtensionMessage?: (message: any) => void;
    };
  }
}

// Safely get the VS Code API without calling acquireVsCodeApi() again
export const vscode = window.vscode;

/**
 * Sends a message to the extension
 */
export function postMessage(message: any): void {
  if (vscode) {
    vscode.postMessage(message);
  } else {
    console.error('VS Code API not available');
  }
}

/**
 * Register a handler for messages from the extension
 */
export function registerMessageHandler(handler: (message: any) => void): void {
  if (window.vscodeMessaging) {
    window.vscodeMessaging.registerHandler(handler);
  } else {
    console.error('VS Code messaging system not initialized');
  }
} 