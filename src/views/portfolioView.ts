import * as vscode from 'vscode';
import { useStockDataStore } from '../store/stockDataStore';
import { StockInventory, StockCostData } from '../types';
import { LoggerService, LogCategory, LogLevel } from '../utilities/loggerService';

/**
 * 股票項目，用於在樹視圖中顯示
 */
export class StockItem extends vscode.TreeItem {
    constructor(
        public readonly stock: StockInventory,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        // 使用全形空格和特殊字符確保等寬顯示
        let paddedSymbol = stock.symbol;
        const symbolLength = stock.symbol.length;
        
        // 根據代號長度添加全形空格和特殊字符
        if (symbolLength < 7) {
            // 使用全形空格和特殊字符填充
            // 使用不可見的全形空格（U+3000）和零寬空格（U+200B）組合
            paddedSymbol += '\u3000'.repeat(Math.ceil((7 - symbolLength) / 2));
            // 如果需要更精確的對齊，可以添加零寬空格
            if ((7 - symbolLength) % 2 !== 0) {
                paddedSymbol += '\u200B';
            }
        }
        
        super(paddedSymbol, collapsibleState);
        
        // 確保標籤不會被覆蓋
        this.label = paddedSymbol;
        
        // 格式化股價和漲跌幅
        const priceText = `$${stock.price.toFixed(2)}`;
        const changeText = stock.change >= 0 
            ? `+${stock.change.toFixed(2)} (+${stock.changePercent.toFixed(2)}%)` 
            : `${stock.change.toFixed(2)} (${stock.changePercent.toFixed(2)}%)`;
        const changeColor = stock.change >= 0 ? 'charts.red' : 'charts.green';
        
        // 計算損益（如果有成本數據）
        let profitText = '';
        let profitColor = '';
        
        if (stock.cost) {
            // 確保 averageCost 是數字
            const averageCost = typeof stock.cost.averageCost === 'number' ? stock.cost.averageCost : parseFloat(stock.cost.averageCost as any);
            
            // 只有當 averageCost 是有效數字時才計算利潤
            if (!isNaN(averageCost)) {
                const profit = (stock.price - averageCost) * stock.cost.quantity;
                const profitPercent = ((stock.price - averageCost) / averageCost) * 100;
                
                profitText = `$${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`;
                profitColor = profit >= 0 ? 'charts.red' : 'charts.green';
            } else {
                profitText = 'N/A';
            }
        } else {
            profitText = 'N/A';
        }
        
        // 設置描述 - 股價和漲跌幅，使用簡單的 padEnd 方法確保等寬
        this.description = `${priceText.padEnd(10)} ${changeText.padEnd(20)} ${profitText}`;
        
        // 設置工具提示 - 詳細信息
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${stock.symbol} - ${stock.name}**\n\n`);
        this.tooltip.appendMarkdown(`Price: ${priceText} (${changeText})\n\n`);
        
        if (stock.cost) {
            // 確保 averageCost 是數字
            const averageCost = typeof stock.cost.averageCost === 'number' ? stock.cost.averageCost : parseFloat(stock.cost.averageCost as any);
            
            // 只有當 averageCost 是有效數字時才計算利潤
            if (!isNaN(averageCost)) {
                this.tooltip.appendMarkdown(`Quantity: ${stock.cost.quantity}\n\n`);
                this.tooltip.appendMarkdown(`Average Cost: $${averageCost.toFixed(2)}\n\n`);
                this.tooltip.appendMarkdown(`Profit/Loss: ${profitText}`);
            }
        }
        
        // 設置圖標
        if (stock.cost) {
            // 確保 averageCost 是數字
            const averageCost = typeof stock.cost.averageCost === 'number' ? stock.cost.averageCost : parseFloat(stock.cost.averageCost as any);
            
            // 只有當 averageCost 是有效數字時才計算利潤
            if (!isNaN(averageCost)) {
                const profit = (stock.price - averageCost) * stock.cost.quantity;
                if (profit > 0) {
                    this.iconPath = new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('charts.red'));
                } else if (profit < 0) {
                    this.iconPath = new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('charts.green'));
                } else {
                    this.iconPath = new vscode.ThemeIcon('dash');
                }
            } else {
                this.iconPath = new vscode.ThemeIcon('dash');
            }
        } else {
            // 使用漲跌幅來決定圖標
            if (stock.change > 0) {
                this.iconPath = new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('charts.red'));
            } else if (stock.change < 0) {
                this.iconPath = new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('charts.green'));
            } else {
                this.iconPath = new vscode.ThemeIcon('dash');
            }
        }
        
        // 設置上下文值 - 用於右鍵選單
        this.contextValue = 'stock';
        
        // 設置命令（點擊時執行）
        this.command = {
            command: 'stockmon.showStockDetail',
            title: 'Show Stock Detail',
            arguments: [this.stock.symbol]
        };
    }
}

/**
 * 表頭項目，用於在樹視圖中顯示列標題
 */
export class HeaderItem extends vscode.TreeItem {
    constructor() {
        super('Header', vscode.TreeItemCollapsibleState.None);
        
        // 設置標籤 - 使用全形空格確保等寬
        // 「代號」是2個全形字符，需要添加全形空格使其與最長的股票代號對齊
        this.label = '代號\u3000\u3000'; // 2個全形字符 + 2個全形空格
        
        // 設置描述 - 股價、漲跌幅和損益
        this.description = `${'股價'.padEnd(10)} ${'漲跌幅'.padEnd(20)} ${'損益'.padEnd(10)}`;
        
        // 設置樣式
        this.contextValue = 'header';
        
        // 使用特殊圖標
        this.iconPath = new vscode.ThemeIcon('list-tree');
        
        // 設置工具提示
        this.tooltip = '股票列表表頭';
    }
}

/**
 * 股票組合視圖提供者
 */
export class PortfolioViewProvider implements vscode.TreeDataProvider<StockItem | HeaderItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StockItem | HeaderItem | undefined | null | void> = new vscode.EventEmitter<StockItem | HeaderItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StockItem | HeaderItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    private logger = LoggerService.getInstance();
    private unsubscribeStore: (() => void) | undefined;
    
    constructor() {
        this.logger.info(LogCategory.PORTFOLIO, 'Initializing portfolio view provider');
        
        // 訂閱 stockDataStore 的變化
        this.unsubscribeStore = useStockDataStore.subscribe(
            (state) => {
                this.logger.debug(LogCategory.PORTFOLIO, 'Stock data changed, refreshing view');
                this.refresh();
            }
        );
    }
    
    /**
     * 刷新視圖
     */
    public refresh(): void {
        this.logger.debug(LogCategory.PORTFOLIO, 'Refreshing portfolio view');
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * 獲取樹項目
     * @param element 樹項目
     */
    getTreeItem(element: StockItem | HeaderItem): vscode.TreeItem {
        return element;
    }
    
    /**
     * 獲取子項目
     * @param element 父項目
     */
    async getChildren(element?: StockItem | HeaderItem): Promise<(StockItem | HeaderItem)[]> {
        if (element) {
            // 如果有父項目，返回空數組（暫不支持嵌套）
            return [];
        }
        
        try {
            // 獲取股票數據
            const stocks = useStockDataStore.getState().stocks;
            this.logger.debug(LogCategory.PORTFOLIO, `Found ${stocks.length} stocks in store`);
            
            if (stocks.length === 0) {
                this.logger.info(LogCategory.PORTFOLIO, 'No stocks found in store');
                return [];
            }
            
            // 添加表頭
            const result: (StockItem | HeaderItem)[] = [new HeaderItem()];
            
            // 按照是否有成本數據和股票代碼排序
            const sortedStocks = [...stocks].sort((a, b) => {
                // 首先按照是否有成本數據排序
                if (a.cost && !b.cost) {
                    return -1;
                }
                if (!a.cost && b.cost) {
                    return 1;
                }
                
                // 然後按照股票代碼排序
                return a.symbol.localeCompare(b.symbol);
            });
            
            this.logger.debug(LogCategory.PORTFOLIO, `Sorted ${sortedStocks.length} stocks for display`);
            
            // 創建樹項目
            const stockItems = sortedStocks.map(stock => 
                new StockItem(stock, vscode.TreeItemCollapsibleState.None)
            );
            
            // 將股票項目添加到結果中
            result.push(...stockItems);
            
            return result;
        } catch (error) {
            this.logger.logError(LogCategory.PORTFOLIO, error, 'Error getting children for portfolio view');
            return [];
        }
    }
    
    /**
     * 釋放資源
     */
    dispose() {
        this.logger.debug(LogCategory.PORTFOLIO, 'Disposing portfolio view provider');
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
        }
    }
} 