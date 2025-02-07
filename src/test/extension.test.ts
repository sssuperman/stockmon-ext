import * as assert from 'assert';
import * as vscode from 'vscode';
import { StockService } from '../stockService';

suite('Stock Watch Extension Test Suite', () => {
    let stockService: StockService;
    const mockContext = {
        globalState: {
            get: (key: string) => {
                switch (key) {
                    case 'clientUuid':
                        return 'test-uuid';
                    case 'sessionInfo':
                        return null;
                    case 'authToken':
                        return null;
                    case 'stockCosts':
                        return [];
                    case 'priceAlerts':
                        return [];
                    default:
                        return undefined;
                }
            },
            update: () => Promise.resolve()
        },
        subscriptions: [],
        workspaceState: {
            get: () => undefined,
            update: () => Promise.resolve()
        },
        extensionPath: '',
        storagePath: '',
        logPath: '',
        extensionUri: vscode.Uri.file(''),
        asAbsolutePath: (relativePath: string) => relativePath,
    };

    const mockStatusBarItem = {
        text: '',
        tooltip: '',
        command: '',
        show: () => {},
        hide: () => {},
        dispose: () => {},
        name: 'Stock Watch'
    } as vscode.StatusBarItem;

    setup(() => {
        stockService = new StockService(mockContext as unknown as vscode.ExtensionContext, mockStatusBarItem);
    });

    test('Stock Service - Set and Get Cost with Shares', () => {
        const symbol = '2317';
        const cost = 500;
        const shares = 1000;

        stockService.setCost(symbol, cost, shares);
        const result = stockService.getCost(symbol);

        assert.strictEqual(result?.cost, cost);
        assert.strictEqual(result?.shares, shares);
    });

    test('Stock Service - Calculate Total Profit', async () => {
        const symbol = '2317';
        const cost = 500;
        const shares = 1000;

        stockService.setCost(symbol, cost, shares);
        const stockData = await stockService.getStockPrice([symbol]);

        if (stockData.length > 0 && stockData[0].price > 0) {
            const { totalProfit, totalProfitPercent } = stockService.calculateTotalProfit();
            assert.ok(typeof totalProfit === 'number');
            assert.ok(typeof totalProfitPercent === 'number');
        }
    });
});
