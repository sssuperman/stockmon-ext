import React, { useState, useEffect } from 'react';
import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import { vscode } from '../../utilities/vscode';
import { 
    useMaterialReactTable, 
    type MRT_ColumnDef,
    MRT_TableContainer,
} from 'material-react-table';
import { ThemeProvider, createTheme } from '@mui/material';
import { BsThreeDotsVertical, BsPlusCircle, BsTrash } from 'react-icons/bs';
import { AlertTypeEnum, StockAlertItem } from '../../store/alertTypes';
import './AlertList.css';

// 獲取提醒類型的中文描述
function getAlertTypeDescription(alertType: AlertTypeEnum): string {
  switch(alertType) {
    case AlertTypeEnum.PRICE_ABOVE:
      return '價格超過';
    case AlertTypeEnum.PRICE_BELOW:
      return '價格低於';
    case AlertTypeEnum.CHANGE_ABOVE:
      return '漲幅大於';
    case AlertTypeEnum.CHANGE_BELOW:
      return '跌幅大於';
    case AlertTypeEnum.VOLUME_ABOVE:
      return '成交量超過';
    case AlertTypeEnum.MA_CROSS_ABOVE:
      return '短期均線上穿長期均線';
    case AlertTypeEnum.MA_CROSS_BELOW:
      return '短期均線下穿長期均線';
    case AlertTypeEnum.VOLUME_MA_ABOVE:
      return '成交量超過均量線';
    case AlertTypeEnum.RSI_ABOVE:
      return 'RSI超過';
    case AlertTypeEnum.RSI_BELOW:
      return 'RSI低於';
    case AlertTypeEnum.MACD_CROSS_ABOVE:
      return 'MACD金叉';
    case AlertTypeEnum.MACD_CROSS_BELOW:
      return 'MACD死叉';
    case AlertTypeEnum.BB_UPPER_TOUCH:
      return '接觸布林上軌';
    case AlertTypeEnum.BB_LOWER_TOUCH:
      return '接觸布林下軌';
    default:
      return '未知提醒類型';
  }
}

interface AlertListProps {
    alerts: StockAlertItem[];
    isAuthenticated: boolean;
}

export const AlertList: React.FC<AlertListProps> = ({ alerts, isAuthenticated }) => {
    const [tableData, setTableData] = useState<StockAlertItem[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [pagination, setPagination] = useState({ pageSize: 10, pageIndex: 0 });

    // 當alerts變化時更新tableData
    useEffect(() => {
        setTableData(alerts);
    }, [alerts]);

    // 在組件載入時獲取提醒數據
    useEffect(() => {
        if (isAuthenticated) {
            fetchAlerts();
        }
    }, [isAuthenticated]);

    // 獲取提醒列表
    const fetchAlerts = async () => {
        setIsLoading(true);
        vscode.postMessage({ command: 'fetchAlerts' });
        // 延遲1秒後重置加載狀態
        setTimeout(() => setIsLoading(false), 1000);
    };

    // 處理刪除提醒
    const handleDeleteAlert = (alertId: number) => {
        vscode.postMessage({ 
            command: 'confirmDeleteAlert',
            alertId
        });
    };

    // 處理添加提醒
    const handleAddAlert = () => {
        vscode.postMessage({ command: 'addAlert' });
    };

    // 獲取CSS變數的實際顏色值
    const getCssVariableValue = (variableName: string): string => {
        const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        return value || '#1e1e1e';
    };

    // 創建深色主題
    const darkTheme = React.useMemo(
        () => {
            const editorBackground = getCssVariableValue('--vscode-editor-background') || '#1e1e1e';
            const editorForeground = getCssVariableValue('--vscode-editor-foreground') || '#d4d4d4';
            const buttonBackground = getCssVariableValue('--vscode-button-background') || '#0e639c';
            const descriptionForeground = getCssVariableValue('--vscode-descriptionForeground') || '#cccccc';
            const panelBorder = getCssVariableValue('--vscode-panel-border') || '#555555';
            const listHoverBackground = getCssVariableValue('--vscode-list-hoverBackground') || '#2a2d2e';
            const editorGroupHeaderTabsBackground = getCssVariableValue('--vscode-editorGroupHeader-tabsBackground') || '#252526';

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
                    divider: panelBorder,
                    action: {
                        hover: listHoverBackground,
                    }
                },
                typography: {
                    fontFamily: 'var(--vscode-font-family, "Segoe UI", Tahoma, Geneva, Verdana, sans-serif)',
                },
                components: {
                    MuiCssBaseline: {
                        styleOverrides: {
                            body: {
                                backgroundColor: editorBackground,
                                color: editorForeground,
                            },
                        },
                    },
                    MuiPaper: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                                color: editorForeground,
                                backgroundImage: 'none !important',
                                boxShadow: 'none',
                            },
                        },
                    },
                    MuiTable: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                            },
                        },
                    },
                    MuiTableBody: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                            },
                        },
                    },
                    MuiTableCell: {
                        styleOverrides: {
                            root: {
                                borderBottomColor: panelBorder,
                                color: editorForeground,
                                backgroundColor: `${editorBackground} !important`,
                            },
                            head: {
                                backgroundColor: `${editorGroupHeaderTabsBackground} !important`,
                                color: editorForeground,
                                fontWeight: 'bold',
                            },
                            body: {
                                backgroundColor: `${editorBackground} !important`,
                            },
                        },
                    },
                    MuiTableHead: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorGroupHeaderTabsBackground} !important`,
                            },
                        },
                    },
                    MuiTableRow: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                                '&:hover': {
                                    backgroundColor: `${listHoverBackground} !important`,
                                },
                                '&.MuiTableRow-hover:hover': {
                                    backgroundColor: `${listHoverBackground} !important`,
                                },
                            },
                        },
                    },
                    MuiTablePagination: {
                        styleOverrides: {
                            root: {
                                color: editorForeground,
                                backgroundColor: `${editorBackground} !important`,
                            },
                            selectIcon: {
                                color: editorForeground,
                            },
                        },
                    },
                    MuiSelect: {
                        styleOverrides: {
                            icon: {
                                color: editorForeground,
                            },
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                            },
                        },
                    },
                    MuiMenuItem: {
                        styleOverrides: {
                            root: {
                                color: editorForeground,
                                backgroundColor: `${editorBackground} !important`,
                                '&:hover': {
                                    backgroundColor: `${listHoverBackground} !important`,
                                },
                                '&.Mui-selected': {
                                    backgroundColor: `${listHoverBackground} !important`,
                                },
                            },
                        },
                    },
                    MuiInputBase: {
                        styleOverrides: {
                            root: {
                                color: editorForeground,
                                backgroundColor: `${editorBackground} !important`,
                            },
                            input: {
                                backgroundColor: `${editorBackground} !important`,
                                '&::placeholder': {
                                    color: descriptionForeground,
                                    opacity: 0.7,
                                },
                            },
                        },
                    },
                    MuiToolbar: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                                color: editorForeground,
                            },
                        },
                    },
                    MuiTableContainer: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                            },
                        },
                    },
                    MuiPopover: {
                        styleOverrides: {
                            paper: {
                                backgroundColor: `${editorBackground} !important`,
                                color: editorForeground,
                            },
                        },
                    },
                    MuiList: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                            },
                        },
                    },
                    MuiListItem: {
                        styleOverrides: {
                            root: {
                                backgroundColor: `${editorBackground} !important`,
                                '&:hover': {
                                    backgroundColor: `${listHoverBackground} !important`,
                                },
                            },
                        },
                    },
                    MuiCheckbox: {
                        styleOverrides: {
                            root: {
                                color: editorForeground,
                            },
                        },
                    },
                    MuiSvgIcon: {
                        styleOverrides: {
                            root: {
                                color: editorForeground,
                            },
                        },
                    },
                    MuiButton: {
                        styleOverrides: {
                            root: {
                                color: editorForeground,
                            },
                        },
                    },
                },
            });
        },
        []
    );

    // 自定義格式化日期時間
    const formatDateTime = (dateString: string | null) => {
        if (!dateString) return '尚未觸發';
        const date = new Date(dateString);
        return date.toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    };

    // 定義表格列
    const columns = React.useMemo<MRT_ColumnDef<StockAlertItem>[]>(
        () => [
            {
                accessorFn: (row) => ({ name: row.stock.name, symbol: row.stock.symbol }),
                id: 'stock',
                header: '股票',
                Cell: ({ cell }) => (
                    <div className="stock-name-symbol-cell">
                        <div className="stock-name-display">{cell.getValue<{name: string, symbol: string}>().name}</div>
                        <div className="stock-symbol-display">{cell.getValue<{name: string, symbol: string}>().symbol}</div>
                    </div>
                ),
            },
            {
                accessorFn: (row) => ({
                    type: row.alert_rule.alert_type,
                    name: row.alert_rule.name,
                }),
                id: 'alertType',
                header: '提醒類型',
                Cell: ({ cell }) => {
                    const value = cell.getValue<{type: AlertTypeEnum, name: string}>();
                    return (
                        <div className="alert-type-cell">
                            <div className="alert-type-display">{getAlertTypeDescription(value.type)}</div>
                            <div className="alert-name-display">{value.name}</div>
                        </div>
                    );
                },
            },
            {
                accessorFn: (row) => {
                    const threshold = row.alert_rule.threshold;
                    const parameters = row.alert_rule.parameters;
                    return { threshold, parameters };
                },
                id: 'condition',
                header: '條件',
                Cell: ({ cell, row }) => {
                    const value = cell.getValue<{threshold: number | null, parameters: Record<string, any>}>();
                    const alertType = row.original.alert_rule.alert_type;
                    
                    let conditionText = '';
                    
                    // 根據提醒類型顯示不同的條件
                    if ([AlertTypeEnum.PRICE_ABOVE, AlertTypeEnum.PRICE_BELOW, 
                         AlertTypeEnum.CHANGE_ABOVE, AlertTypeEnum.CHANGE_BELOW, 
                         AlertTypeEnum.VOLUME_ABOVE, AlertTypeEnum.RSI_ABOVE, 
                         AlertTypeEnum.RSI_BELOW].includes(alertType as AlertTypeEnum)) {
                        conditionText = `${value.threshold}`;
                        if (alertType === AlertTypeEnum.CHANGE_ABOVE || alertType === AlertTypeEnum.CHANGE_BELOW) {
                            conditionText += '%';
                        }
                    } else if (alertType === AlertTypeEnum.MA_CROSS_ABOVE || alertType === AlertTypeEnum.MA_CROSS_BELOW) {
                        const { fast_period, slow_period } = value.parameters;
                        conditionText = `MA(${fast_period}) ${alertType === AlertTypeEnum.MA_CROSS_ABOVE ? '上穿' : '下穿'} MA(${slow_period})`;
                    } else if (alertType === AlertTypeEnum.VOLUME_MA_ABOVE) {
                        const { period } = value.parameters;
                        conditionText = `成交量 > MA(${period})`;
                    } else if (alertType === AlertTypeEnum.MACD_CROSS_ABOVE || alertType === AlertTypeEnum.MACD_CROSS_BELOW) {
                        const { fast_period, slow_period, signal_period } = value.parameters;
                        conditionText = `MACD(${fast_period},${slow_period},${signal_period})`;
                    } else if (alertType === AlertTypeEnum.BB_UPPER_TOUCH || alertType === AlertTypeEnum.BB_LOWER_TOUCH) {
                        const { period, std_dev } = value.parameters;
                        conditionText = `BB(${period},${std_dev})`;
                    }
                    
                    return <div className="alert-condition">{conditionText}</div>;
                },
            },
            {
                accessorFn: (row) => row.is_active,
                id: 'status',
                header: '狀態',
                Cell: ({ cell }) => (
                    <div className={`alert-status ${cell.getValue<boolean>() ? 'active' : 'inactive'}`}>
                        {cell.getValue<boolean>() ? '啟用' : '停用'}
                    </div>
                ),
            },
            {
                accessorFn: (row) => row.repeat_notification,
                id: 'repeatNotification',
                header: '允許重複通知',
                Cell: ({ cell }) => (
                    <div className={`alert-repeat ${cell.getValue<boolean>() ? 'allowed' : 'not-allowed'}`}>
                        {cell.getValue<boolean>() ? '允許' : '不允許'}
                    </div>
                ),
            },
            {
                accessorFn: (row) => row.last_triggered,
                id: 'lastTriggered',
                header: '最後觸發',
                Cell: ({ cell }) => (
                    <div className="last-triggered">
                        {formatDateTime(cell.getValue<string | null>())}
                    </div>
                ),
            },
            {
                id: 'actions',
                header: '操作',
                size: 150,
                Cell: ({ row }) => (
                    <div className="action-buttons-container">
                        <button 
                            className="action-button delete"
                            title="刪除提醒"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAlert(row.original.id);
                            }}
                        >
                            <BsTrash />
                        </button>
                    </div>
                ),
            },
        ],
        []
    );

    // 使用 Material React Table 配置警報表格
    const table = useMaterialReactTable({
        columns,
        data: alerts,
        state: {
            isLoading,
            pagination,
        },
        enableStickyHeader: true,
        enableColumnResizing: true,
        enableFilters: true,
        enableSorting: true,
        enablePagination: true,
        manualPagination: false,
        enableToolbarInternalActions: false,
        enableFullScreenToggle: false,
        enableDensityToggle: false,
        enableHiding: false,
        positionToolbarAlertBanner: 'top',
        enableTableFooter: true,
        enableBottomToolbar: true,
        enableTopToolbar: true,
        displayColumnDefOptions: {
            'mrt-row-actions': {
                header: '操作',
                size: 150,
            },
        },
        defaultColumn: {
            minSize: 80,
            maxSize: 400,
            size: 120,
        },
        localization: {
            rowsPerPage: '每頁行數',
            of: '/',
        },
        onPaginationChange: setPagination,
        positionPagination: 'bottom',
        initialState: {
            pagination: {
                pageSize: 10,
                pageIndex: 0,
            },
        },
    });

    // 未登入提示組件
    const UnauthenticatedPrompt = () => (
        <div className="unauthenticated-prompt">
            <div className="prompt-content">
                <div className="prompt-icon">🔒</div>
                <p>您需要登入以查看和管理股票提醒</p>
                <VSCodeButton
                    onClick={() => vscode.postMessage({ command: 'login' })}
                >
                    立即登入
                </VSCodeButton>
            </div>
        </div>
    );

    // 空提醒列表提示組件
    const EmptyAlertsPrompt = () => (
        <div className="empty-alerts-container">
            <div className="empty-alerts-message">
                <BsPlusCircle className="empty-alerts-icon" />
                <h3>您尚未設置任何股票提醒</h3>
                <p>點擊下方按鈕添加您的第一個股票提醒</p>
                <VSCodeButton 
                    onClick={handleAddAlert} 
                    className="empty-alerts-button"
                >
                    添加提醒
                </VSCodeButton>
            </div>
        </div>
    );

    return (
        <div className="alert-list-container">
            {!isAuthenticated ? (
                <UnauthenticatedPrompt />
            ) : tableData.length === 0 ? (
                <EmptyAlertsPrompt />
            ) : (
                <>
                    <div className="alert-list-header">
                        <h2>股票提醒列表</h2>
                        <VSCodeButton 
                            onClick={handleAddAlert}
                            appearance="secondary"
                        >
                            <BsPlusCircle className="action-icon" />
                            新增提醒
                        </VSCodeButton>
                    </div>
                    <VSCodeDivider />
                    <div className="alert-list-table">
                        <ThemeProvider theme={darkTheme}>
                            <MRT_TableContainer table={table} />
                        </ThemeProvider>
                    </div>
                </>
            )}
        </div>
    );
}; 