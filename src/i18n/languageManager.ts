import * as vscode from 'vscode';
import { LocaleMessages, getLocaleMessages } from './locales';

export class LanguageManager {
    private static instance: LanguageManager;
    private currentLocale: string;
    private messages: LocaleMessages;

    private constructor() {
        // 獲取 VS Code 的語言設定
        this.currentLocale = vscode.env.language;
        this.messages = getLocaleMessages(this.currentLocale);

        // 監聽語言變更
        vscode.window.onDidChangeActiveTextEditor(() => {
            const newLocale = vscode.env.language;
            if (newLocale !== this.currentLocale) {
                this.currentLocale = newLocale;
                this.messages = getLocaleMessages(this.currentLocale);
            }
        });
    }

    public static getInstance(): LanguageManager {
        if (!LanguageManager.instance) {
            LanguageManager.instance = new LanguageManager();
        }
        return LanguageManager.instance;
    }

    public getMessage(): LocaleMessages {
        return this.messages;
    }

    public getCurrentLocale(): string {
        return this.currentLocale;
    }
} 
