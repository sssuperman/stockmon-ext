import * as vscode from 'vscode';
import { LoggerService, LogCategory, LogLevel } from '../utilities/loggerService';
import { useWebSocketStore } from '../store/websocketStore';
import { setUseProxy } from '../config';

const wsStore = useWebSocketStore.getState();

export function registerConfigCommands(context: vscode.ExtensionContext, logger: LoggerService) {
    logger.info(LogCategory.COMMAND, 'Registering config commands');

    const checkConfigCommand = vscode.commands.registerCommand('stockmon.checkConfig', () => {
        const { config } = require('./config');
        const stockmonConfig = vscode.workspace.getConfiguration('stockmon');
        const useProxy = stockmonConfig.get<boolean>('useProxy') || false;

        logger.log(LogCategory.EXTENSION, '=== Current Configuration ===');
        logger.log(LogCategory.EXTENSION, `Proxy Enabled: ${useProxy}`);

        if (useProxy) {
            logger.log(LogCategory.EXTENSION, '=== Proxy Settings ===');
            logger.log(LogCategory.EXTENSION, `API Base URL: ${stockmonConfig.get('proxyApiBaseUrl')}`);
            logger.log(LogCategory.EXTENSION, `WebSocket Host: ${stockmonConfig.get('proxyWsHost')}`);
            logger.log(LogCategory.EXTENSION, `WebSocket Port: ${stockmonConfig.get('proxyWsPort')}`);
        }

        logger.log(LogCategory.EXTENSION, '=== Active Configuration ===');
        logger.log(LogCategory.EXTENSION, JSON.stringify(config, null, 2));

        vscode.window.showInformationMessage(`Configuration checked. Proxy: ${useProxy ? 'Enabled' : 'Disabled'}. See output panel for details.`);
    });

    const enableProxyCommand = vscode.commands.registerCommand('stockmon.enableProxy', async () => {
        await setUseProxy(true);
        wsStore.disconnect();
        wsStore.connect(logger);
        vscode.window.showInformationMessage('Proxy Server Enabled');
    });

    const disableProxyCommand = vscode.commands.registerCommand('stockmon.disableProxy', async () => {
        await setUseProxy(false);
        wsStore.disconnect();
        wsStore.connect(logger);
        vscode.window.showInformationMessage('Proxy Server Disabled');
    });

    const setLogLevelCommand = vscode.commands.registerCommand('stockmon.setLogLevel', async () => {
        const levels = Object.keys(LogLevel).filter(key => isNaN(Number(key)));
        const selectedLevel = await vscode.window.showQuickPick(levels, {
            placeHolder: 'Select log level',
            title: 'StockMon Log Level'
        });

        if (selectedLevel) {
            const logLevel = LogLevel[selectedLevel as keyof typeof LogLevel];
            logger.setLogLevel(logLevel);

            // 保存到設置
            const config = vscode.workspace.getConfiguration('stockmon');
            await config.update('logLevel', selectedLevel, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(`Log level set to ${selectedLevel}`);
        }
    });

    context.subscriptions.push(checkConfigCommand);
    context.subscriptions.push(enableProxyCommand);
    context.subscriptions.push(disableProxyCommand);
    context.subscriptions.push(setLogLevelCommand);
}

