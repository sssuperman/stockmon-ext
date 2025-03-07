export interface LocaleMessages {
    connection: {
        status: string;
        connected: string;
        connecting: string;
        reconnecting: string;
        closing: string;
        closed: string;
        unknown: string;
        connectingToService: string;
        disconnected: string;
        clickToReconnect: string;
    };
    stock: {
        cost: string;
        shares: string;
        profit: string;
        profitRate: string;
        noCost: string;
        setCost: string;
        setAlert: string;
        realtime: string;
        delayed: string;
        waiting: string;
        waitingPrice: string;
        add: string;
        delete: string;
        pleaseSetTrackingStocks: string;
        clickToSetStocks: string;
        waitingForData: string;
        gettingPriceData: string;
        defaultStock: string;
        noStocksInList: string;
        selectStockToDelete: string;
        confirmDelete: string;
        deleteSuccess: string;
        alreadyInList: string;
        addSuccess: string;
        setCostNow: string;
        inputCostPrice: string;
        inputShares: string;
        setCostSuccess: string;
        invalidPrice: string;
        invalidShares: string;
        pleaseInputPrice: string;
        pleaseInputShares: string;
        selectStock: string;
        error: string;
        generalError: string;
        setCostError: string;
        selectStockToSetCost: string;
    };
    panel: {
        title: string;
        totalProfit: string;
    };
    alert: {
        priceAbove: string;
        priceBelow: string;
        setSuccess: string;
        removeSuccess: string;
        noAlerts: string;
        selectStock: string;
        noTriggered: string;
        priceReached: string;
    };
    auth: {
        login: string;
        logout: string;
        username: string;
        password: string;
        loginSuccess: string;
        loginFailed: string;
        logoutSuccess: string;
        logoutFailed: string;
        loggedInAs: string;
        logoutConfirmation: string;
        loggingIn: string;
        loggingOut: string;
    };
    details: {
        title: string;
        noData: string;
        setCostAndShares: string;
        portfolioDetails: string;
        clickToSetCost: string;
    };
    commands: {
        addStock: string;
        searchStocks: string;
        deleteStock: string;
        refresh: string;
        setCost: string;
        setPriceAlert: string;
        managePriceAlerts: string;
        manualCheckPriceAlerts: string;
        login: string;
        logout: string;
        showPanel: string;
        clearAllSubscriptions: string;
        showSessionInfo: string;
        syncUserStocks: string;
        manualSync: string;
    };
    config: {
    };
    subscription: {
        clearConfirmation: string;
        clearSuccess: string;
    };
    common: {
        confirm: string;
        cancel: string;
        yes: string;
        no: string;
    };
    sync: {
        notAuthenticated: string;
        syncing: string;
        syncComplete: string;
        syncFailed: string;
    };
}

const zhTW: LocaleMessages = {
    connection: {
        status: '連線狀態',
        connected: '已連接',
        connecting: '連接中',
        reconnecting: '重新連接中',
        closing: '關閉中',
        closed: '已斷開',
        unknown: '未知狀態',
        connectingToService: '正在連接到股票服務...',
        disconnected: '連接已斷開',
        clickToReconnect: '點擊以重新連接'
    },
    stock: {
        cost: '成本',
        shares: '股數',
        profit: '損益',
        profitRate: '報酬率',
        noCost: '尚未設定成本',
        setCost: '設定成本',
        setAlert: '設定提醒',
        realtime: '即時',
        delayed: '延遲',
        waiting: '等待連線',
        waitingPrice: '等待報價',
        add: '新增股票',
        delete: '刪除',
        pleaseSetTrackingStocks: '請設定要追蹤的股票',
        clickToSetStocks: '點擊以設定股票',
        waitingForData: '等待股價資料...',
        gettingPriceData: '正在獲取股價資料',
        defaultStock: '',  // 預設股票代號
        noStocksInList: '追蹤清單中沒有股票',
        selectStockToDelete: '選擇要刪除的股票',
        confirmDelete: '確定要刪除 {0} 嗎？',
        deleteSuccess: '已從追蹤清單中刪除 {0}',
        alreadyInList: '{0} 已在追蹤清單中',
        addSuccess: '已新增 {0} ({1}) 到追蹤清單',
        setCostNow: '是否要設定成本？',
        inputCostPrice: '輸入 {0} 的成本價格',
        inputShares: '輸入 {0} 的持有股數',
        setCostSuccess: '已設定 {0} 的成本價為 {1}，持有股數為 {2}',
        invalidPrice: '請輸入有效的價格',
        invalidShares: '請輸入有效的股數',
        pleaseInputPrice: '請輸入成本價格',
        pleaseInputShares: '請輸入股數',
        selectStock: '選擇股票',
        error: '{0} 操作失敗：{1}',
        generalError: '操作發生錯誤：{0}',
        setCostError: '設定 {0} 成本時發生錯誤：{1}',
        selectStockToSetCost: '選擇要設定成本的股票'
    },
    panel: {
        title: 'Stock Monitor',
        totalProfit: '總損益'
    },
    alert: {
        priceAbove: '價格上漲至',
        priceBelow: '價格下跌至',
        setSuccess: '設定成功',
        removeSuccess: '移除成功',
        noAlerts: '目前沒有設定任何到價提醒',
        selectStock: '選擇要檢查到價提醒的股票',
        noTriggered: '{0} 目前沒有觸發任何到價提醒',
        priceReached: '{0} 股價 {1} {2}！目前價格：{3}'
    },
    auth: {
        login: '登入',
        logout: '登出',
        username: '使用者名稱',
        password: '密碼',
        loginSuccess: '登入成功！',
        loginFailed: '登入失敗，請檢查使用者名稱和密碼。',
        logoutSuccess: '已登出',
        logoutFailed: '登出失敗，請稍後再試。',
        loggedInAs: '已登入為',
        logoutConfirmation: '確定要登出嗎？',
        loggingIn: '正在登入...',
        loggingOut: '正在登出...'
    },
    details: {
        title: '股票投資組合明細',
        noData: '沒有可顯示的股票資訊',
        setCostAndShares: '選擇股票以設定成本和股數',
        portfolioDetails: '投資組合明細',
        clickToSetCost: '點擊以設定成本'
    },
    commands: {
        addStock: '新增股票代號',
        searchStocks: '搜尋股票',
        deleteStock: '刪除股票代號',
        refresh: '更新股價',
        setCost: '設定股票成本',
        setPriceAlert: '設定到價提醒',
        managePriceAlerts: '管理到價提醒',
        manualCheckPriceAlerts: '手動檢查到價提醒',
        login: '登入',
        logout: '登出',
        showPanel: '顯示股票監控面板',
        clearAllSubscriptions: '清除所有訂閱',
        showSessionInfo: '顯示會話資訊',
        syncUserStocks: '從伺服器同步用戶股票',
        manualSync: '手動同步'
    },
    config: {
    },
    subscription: {
        clearConfirmation: '確定要清除所有訂閱嗎？這將會移除所有追蹤的股票。',
        clearSuccess: '已清除所有訂閱'
    },
    common: {
        confirm: '確定',
        cancel: '取消',
        yes: '是',
        no: '否'
    },
    sync: {
        notAuthenticated: '請先登入以同步您的股票資料',
        syncing: '正在同步股票資料...',
        syncComplete: '股票資料同步完成',
        syncFailed: '同步失敗'
    }
};

const enUS: LocaleMessages = {
    connection: {
        status: 'Connection Status',
        connected: 'Connected',
        connecting: 'Connecting',
        reconnecting: 'Reconnecting',
        closing: 'Closing',
        closed: 'Disconnected',
        unknown: 'Unknown',
        connectingToService: 'Connecting to stock service...',
        disconnected: 'Connection lost',
        clickToReconnect: 'Click to reconnect'
    },
    stock: {
        cost: 'Cost',
        shares: 'Shares',
        profit: 'Profit',
        profitRate: 'Return Rate',
        noCost: 'Cost not set',
        setCost: 'Set Cost',
        setAlert: 'Set Alert',
        realtime: 'Real-time',
        delayed: 'Delayed',
        waiting: 'Waiting',
        waitingPrice: 'Waiting for price',
        add: 'Add Stock',
        delete: 'Delete',
        pleaseSetTrackingStocks: 'Please set stocks to track',
        clickToSetStocks: 'Click to set stocks',
        waitingForData: 'Waiting for stock data...',
        gettingPriceData: 'Getting price data',
        defaultStock: '2317',  // Default stock symbol
        noStocksInList: 'No stocks in tracking list',
        selectStockToDelete: 'Select stock to delete',
        confirmDelete: 'Are you sure you want to delete {0}?',
        deleteSuccess: 'Removed {0} from tracking list',
        alreadyInList: '{0} is already in tracking list',
        addSuccess: 'Added {0} ({1}) to tracking list',
        setCostNow: 'Would you like to set the cost now?',
        inputCostPrice: 'Enter cost price for {0}',
        inputShares: 'Enter number of shares for {0}',
        setCostSuccess: 'Set cost price for {0} to {1} with {2} shares',
        invalidPrice: 'Please enter a valid price',
        invalidShares: 'Please enter a valid number of shares',
        pleaseInputPrice: 'Please enter cost price',
        pleaseInputShares: 'Please enter number of shares',
        selectStock: 'Select Stock',
        error: '{0} operation failed: {1}',
        generalError: 'Operation error: {0}',
        setCostError: 'Error setting cost for {0}: {1}',
        selectStockToSetCost: 'Select stock to set cost'
    },
    panel: {
        title: 'Stock Monitor',
        totalProfit: 'Total Profit'
    },
    alert: {
        priceAbove: 'Price rises to',
        priceBelow: 'Price falls to',
        setSuccess: 'Set successfully',
        removeSuccess: 'Removed successfully',
        noAlerts: 'No price alerts set',
        selectStock: 'Select stock to check price alerts',
        noTriggered: 'No price alerts triggered for {0}',
        priceReached: '{0} price has {1} {2}! Current price: {3}'
    },
    auth: {
        login: 'Login',
        logout: 'Logout',
        username: 'Username',
        password: 'Password',
        loginSuccess: 'Login successful!',
        loginFailed: 'Login failed, please check your username and password.',
        logoutSuccess: 'Logged out successfully',
        logoutFailed: 'Logout failed, please try again later.',
        loggedInAs: 'Logged in as',
        logoutConfirmation: 'Are you sure you want to log out?',
        loggingIn: 'Logging in...',
        loggingOut: 'Logging out...'
    },
    details: {
        title: 'Stock Portfolio Details',
        noData: 'No stock information available',
        setCostAndShares: 'Select a stock to set cost and shares',
        portfolioDetails: 'Portfolio Details',
        clickToSetCost: 'Click to set cost'
    },
    commands: {
        addStock: 'Add Stock Symbol',
        searchStocks: 'Search Stocks',
        deleteStock: 'Delete Stock Symbol',
        refresh: 'Refresh Stock Price',
        setCost: 'Set Stock Cost',
        setPriceAlert: 'Set Price Alert',
        managePriceAlerts: 'Manage Price Alerts',
        manualCheckPriceAlerts: 'Manual Check Price Alerts',
        login: 'Login',
        logout: 'Logout',
        showPanel: 'Show Stock Monitor Panel',
        clearAllSubscriptions: 'Clear All Subscriptions',
        showSessionInfo: 'Show Session Info',
        syncUserStocks: 'Sync User Stocks from Server',
        manualSync: 'Manual Sync'
    },
    config: {
    },
    subscription: {
        clearConfirmation: 'Are you sure you want to clear all subscriptions? This will remove all tracked stocks.',
        clearSuccess: 'All subscriptions cleared'
    },
    common: {
        confirm: 'Confirm',
        cancel: 'Cancel',
        yes: 'Yes',
        no: 'No'
    },
    sync: {
        notAuthenticated: 'Please login to sync your stock data',
        syncing: 'Syncing stock data...',
        syncComplete: 'Stock data sync completed',
        syncFailed: 'Sync failed'
    }
};

const locales: { [key: string]: LocaleMessages } = {
    'zh-tw': zhTW,
    'en': enUS,
    'en-us': enUS
};

export function getLocaleMessages(locale: string): LocaleMessages {
    // 將語言代碼轉換為小寫以進行比對
    const normalizedLocale = locale.toLowerCase();
    
    // 嘗試完全匹配
    if (locales[normalizedLocale]) {
        return locales[normalizedLocale];
    }
    
    // 嘗試匹配主要語言代碼
    const mainLang = normalizedLocale.split('-')[0];
    if (locales[mainLang]) {
        return locales[mainLang];
    }
    
    // 默認使用英文
    return enUS;
} 