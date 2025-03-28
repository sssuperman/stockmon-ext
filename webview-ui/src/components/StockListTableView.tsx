import React, { useMemo } from 'react';
import { StockInventory } from '../../../src/types';
import { BsThreeDotsVertical } from 'react-icons/bs';
import { 
    useMaterialReactTable, 
    type MRT_TableOptions,
    type MRT_ColumnDef,
    type MRT_Row,
    MRT_TableContainer,
} from 'material-react-table';
import { ThemeProvider, createTheme } from '@mui/material';

interface TableViewProps {
    tableData: StockInventory[];
    updatedStocks: Set<string>;
    activeMenu: string | null;
    setTableData: React.Dispatch<React.SetStateAction<StockInventory[]>>;
    handleStockClick: (stock: StockInventory) => void;
    handleMenuClick: (symbol: string) => void;
    handleSetCost: (symbol: string) => void;
    handleSetAlert: (symbol: string) => void;
    handleDelete: (symbol: string) => void;
}

// 輔助函數
const formatNumber = (num: any): string => {
    if (typeof num !== 'number' || isNaN(num)) {
        if (typeof num === 'string') {
            const parsedNum = parseFloat(num);
            if (!isNaN(parsedNum)) {
                return parsedNum.toFixed(2);
            }
        }
        return '0.00';
    }
    return num.toFixed(2);
};

const formatPercent = (num: any): string => {
    if (typeof num !== 'number' || isNaN(num)) {
        return '+0.00%';
    }
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
};

export const TableView: React.FC<TableViewProps> = ({
    tableData,
    updatedStocks,
    activeMenu,
    setTableData,
    handleStockClick,
    handleMenuClick,
    handleSetCost,
    handleSetAlert,
    handleDelete,
}) => {
    // 獲取 CSS 變數的實際顏色值
    const getCssVariableValue = (variableName: string): string => {
        const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        return value || '#1e1e1e';
    };

    // 創建深色主題
    const darkTheme = useMemo(
        () => {
            const editorBackground = getCssVariableValue('--vscode-editor-background') || '#1e1e1e';
            const editorForeground = getCssVariableValue('--vscode-editor-foreground') || '#d4d4d4';
            const buttonBackground = getCssVariableValue('--vscode-button-background') || '#0e639c';
            const descriptionForeground = getCssVariableValue('--vscode-descriptionForeground') || '#cccccc';

            return createTheme({
                palette: {
                    mode: 'dark',
                    background: {
                        default: editorBackground,
                        paper: editorBackground,
                    },
                    primary: {
                        main: buttonBackground,
                    },
                    text: {
                        primary: editorForeground,
                        secondary: descriptionForeground,
                    },
                },
                typography: {
                    fontFamily: 'var(--vscode-font-family, "Segoe UI", Tahoma, Geneva, Verdana, sans-serif)',
                },
                components: {
                    MuiPaper: {
                        styleOverrides: {
                            root: {
                                backgroundColor: editorBackground,
                                color: editorForeground,
                            },
                        },
                    },
                },
            });
        },
        []
    );

    // 定義表格列
    const columns = useMemo<MRT_ColumnDef<StockInventory>[]>(
        () => [
            {
                accessorFn: (row) => ({ name: row.name, symbol: row.symbol }),
                id: 'nameSymbol',
                header: '庫存股',
                Cell: ({ cell }) => (
                    <div className="stock-name-symbol-cell">
                        <div className="stock-name-display">{cell.getValue<{name: string, symbol: string}>().name}</div>
                        <div className="stock-symbol-display">{cell.getValue<{name: string, symbol: string}>().symbol}</div>
                    </div>
                ),
            },
            {
                accessorFn: (row) => {
                    const change = typeof row.change === 'number' ? row.change : 0;
                    const changePercent = typeof row.changePercent === 'number' ? row.changePercent : 0;
                    const quantity = row.cost && typeof row.cost.quantity === 'number' ? row.cost.quantity : 0;
                    const todayProfit = quantity * change;
                    return {
                        profit: todayProfit,
                        percent: changePercent,
                        isPositive: todayProfit >= 0
                    };
                },
                id: 'todayProfit',
                header: '今日損益',
                Cell: ({ cell }) => {
                    const value = cell.getValue<{profit: number, percent: number, isPositive: boolean}>();
                    return cell.row.original.cost ? (
                        <div className={value.isPositive ? 'profit-up' : 'profit-down'}>
                            {formatNumber(value.profit)} ({formatPercent(value.percent)})
                        </div>
                    ) : '-';
                },
                sortingFn: (rowA, rowB, columnId) => {
                    const valueA = rowA.original.cost ? 
                        (typeof rowA.original.change === 'number' ? rowA.original.change : 0) * 
                        (rowA.original.cost && typeof rowA.original.cost.quantity === 'number' ? rowA.original.cost.quantity : 0)
                        : 0;
                    const valueB = rowB.original.cost ? 
                        (typeof rowB.original.change === 'number' ? rowB.original.change : 0) * 
                        (rowB.original.cost && typeof rowB.original.cost.quantity === 'number' ? rowB.original.cost.quantity : 0)
                        : 0;
                    return valueA - valueB;
                },
            },
            {
                accessorFn: (row) => {
                    const profit = typeof row.profit === 'number' ? row.profit : 0;
                    const profitPercent = typeof row.profitPercent === 'number' ? row.profitPercent : 0;
                    return {
                        profit: profit,
                        percent: profitPercent,
                        isPositive: profit >= 0
                    };
                },
                id: 'totalProfit',
                header: '總損益',
                Cell: ({ cell }) => {
                    const value = cell.getValue<{profit: number, percent: number, isPositive: boolean}>();
                    return cell.row.original.cost ? (
                        <div className={value.isPositive ? 'profit-up' : 'profit-down'}>
                            {formatNumber(value.profit)} ({formatPercent(value.percent)})
                        </div>
                    ) : '-';
                },
                sortingFn: (rowA, rowB, columnId) => {
                    const valueA = typeof rowA.original.profit === 'number' ? rowA.original.profit : 0;
                    const valueB = typeof rowB.original.profit === 'number' ? rowB.original.profit : 0;
                    return valueA - valueB;
                },
            },
            {
                accessorFn: (row) => row.cost ? row.cost.quantity : 0,
                id: 'quantity',
                header: '股數',
                Cell: ({ cell }) => cell.getValue<number>() > 0 ? cell.getValue<number>() : '-',
            },
            {
                accessorFn: (row) => ({
                    price: typeof row.price === 'number' ? row.price : 0,
                    change: typeof row.change === 'number' ? row.change : 0,
                    changePercent: typeof row.changePercent === 'number' ? row.changePercent : 0,
                }),
                id: 'priceChange',
                header: '股價',
                Cell: ({ cell }) => {
                    const value = cell.getValue<{price: number, change: number, changePercent: number}>();
                    return (
                        <div className="price-change-cell">
                            <div className={`price-display ${value.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                {formatNumber(value.price)}
                            </div>
                            <div className={`change-display ${value.change >= 0 ? 'profit-up' : 'profit-down'}`}>
                                {formatNumber(value.change)} ({formatPercent(value.changePercent)})
                            </div>
                        </div>
                    );
                },
                sortingFn: (rowA, rowB, columnId) => {
                    const valueA = typeof rowA.original.price === 'number' ? rowA.original.price : 0;
                    const valueB = typeof rowB.original.price === 'number' ? rowB.original.price : 0;
                    return valueA - valueB;
                },
            },
            {
                accessorFn: (row) => {
                    if (!row.cost) return 0;
                    let averageCost = 0;
                    if (typeof row.cost.averageCost === 'number') {
                        averageCost = row.cost.averageCost;
                    } else if (typeof row.cost.averageCost === 'string') {
                        averageCost = parseFloat(row.cost.averageCost);
                        if (isNaN(averageCost)) averageCost = 0;
                    }
                    return averageCost;
                },
                id: 'cost',
                header: '成本',
                Cell: ({ cell }) => cell.getValue<number>() > 0 ? formatNumber(cell.getValue<number>()) : '-',
            },
            {
                id: 'actions',
                header: '操作',
                size: 100,
                Cell: ({ row }) => (
                    <div className="menu-container">
                        <button 
                            className="menu-button" 
                            onClick={(e) => {
                                e.stopPropagation(); // 阻止事件冒泡
                                handleMenuClick(row.original.symbol);
                            }}
                        >
                            <BsThreeDotsVertical />
                        </button>
                        {activeMenu === row.original.symbol && (
                            <div className="menu-dropdown">
                                <button 
                                    className="menu-item" 
                                    onClick={(e) => {
                                        e.stopPropagation(); // 阻止事件冒泡
                                        handleSetCost(row.original.symbol);
                                    }}
                                >
                                    設定成本
                                </button>
                                <button 
                                    className="menu-item" 
                                    onClick={(e) => {
                                        e.stopPropagation(); // 阻止事件冒泡
                                        handleSetAlert(row.original.symbol);
                                    }}
                                >
                                    設定價格提醒
                                </button>
                                <button 
                                    className="menu-item delete" 
                                    onClick={(e) => {
                                        e.stopPropagation(); // 阻止事件冒泡
                                        handleDelete(row.original.symbol);
                                    }}
                                >
                                    刪除
                                </button>
                            </div>
                        )}
                    </div>
                ),
                enableSorting: false,
                muiTableBodyCellProps: {
                    align: 'center',
                },
            },
        ],
        [activeMenu, handleMenuClick, handleSetCost, handleSetAlert, handleDelete]
    );

    // 表格選項配置
    const tableOptions = useMemo<MRT_TableOptions<StockInventory>>(() => ({
        columns,
        data: tableData,
        enableRowOrdering: true,
        enableSorting: false,
        enableColumnFilters: false,
        enableColumnActions: false,
        enablePagination: false,
        enableBottomToolbar: false,
        enableTopToolbar: false,
        muiRowDragHandleProps: ({ table }) => ({
            onDragEnd: () => {
                const { draggingRow, hoveredRow } = table.getState();
                if (hoveredRow && draggingRow && 
                    typeof hoveredRow.index === 'number' && 
                    typeof draggingRow.index === 'number') {
                    const newData = [...tableData];
                    newData.splice(
                        hoveredRow.index,
                        0,
                        newData.splice(draggingRow.index, 1)[0]
                    );
                    setTableData(newData);
                }
            },
        }),
        getRowId: (row) => row.symbol,
        muiTableBodyRowProps: ({ row }) => ({
            onClick: () => handleStockClick(row.original),
            className: updatedStocks.has(row.original.symbol) ? 'flash-update' : '',
            sx: { cursor: 'pointer' },
        }),
        muiTableContainerProps: {
            sx: {
                maxHeight: '70vh',
                backgroundColor: getCssVariableValue('--vscode-editor-background'),
            },
        },
        muiTableHeadCellProps: {
            sx: {
                backgroundColor: getCssVariableValue('--vscode-editor-background'),
                color: getCssVariableValue('--vscode-editor-foreground'),
                fontWeight: 'bold',
            },
        },
        muiTableBodyCellProps: {
            sx: {
                backgroundColor: getCssVariableValue('--vscode-editor-background'),
                color: getCssVariableValue('--vscode-editor-foreground'),
            },
        },
    }), [tableData, updatedStocks, handleStockClick, columns, setTableData]);

    // 創建表格實例
    const table = useMaterialReactTable(tableOptions);

    return (
        <ThemeProvider theme={darkTheme}>
            <MRT_TableContainer table={table} />
        </ThemeProvider>
    );
};

export default TableView; 