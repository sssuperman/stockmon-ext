# Stock Monitor (股票監控)

A powerful VSCode extension for monitoring Taiwan stock market prices in real-time. Perfect for developers who want to keep an eye on their investments while coding.

這是一個強大的 VS Code 擴展，用於即時監控台股股價。適合想在寫程式時同時關注投資的開發者。

## Features 功能

- 🔄 Real-time stock price monitoring in VSCode status bar
  - 在 VS Code 狀態欄即時顯示股價資訊
- 📊 Support multiple stock symbols simultaneously
  - 支援多支股票同時監控
- ⏰ Automatic updates
  - 自動定時更新
- 📈 Price change indicators (up/down)
  - 股價漲跌顯示
- 🔔 Price alerts and notifications
  - 價格提醒通知功能
- 🔐 Secure login system for data synchronization
  - 安全的登入系統，支援資料同步
- 🌐 WebSocket support for real-time updates
  - WebSocket 支援，提供即時更新

## Installation 安裝方式

1. Open VSCode
2. Press `Ctrl+P` or `Cmd+P`
3. Type `ext install sssuperman.stockmon`

## Usage 使用方法

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) to open command palette
   按下 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux) 開啟命令面板
2. Type "StockMon: Add Stock Symbol" to add stocks for monitoring
   輸入 "StockMon: Add Stock Symbol" 來新增要監控的股票
3. Stock prices will appear in the VSCode status bar and update automatically
   股價會顯示在 VS Code 下方的狀態欄，並自動更新

## Settings 設定選項

This extension provides the following settings:
此擴展提供以下設定選項：

* `stockmon.useProxy`: Whether to use proxy server for connection
  是否使用代理伺服器連接
* `stockmon.proxyApiBaseUrl`: API base URL for proxy server
  代理伺服器的 API 基礎 URL
* `stockmon.proxyWsHost`: WebSocket host for proxy server
  代理伺服器的 WebSocket host
* `stockmon.proxyWsPort`: WebSocket port for proxy server
  代理伺服器的 WebSocket port
* `stockmon.logLevel`: Log level for the extension (DEBUG, INFO, WARNING, ERROR)
  擴展的日誌級別 (DEBUG, INFO, WARNING, ERROR)

## Security & Privacy 安全性與隱私

- All network communications are encrypted using HTTPS/WSS
  所有網路通訊皆使用 HTTPS/WSS 加密
- No personal data is collected except for basic usage statistics
  除基本使用統計外，不收集個人資料
- Login credentials are stored securely using VSCode's built-in secret storage
  登入憑證使用 VSCode 內建的安全儲存機制

## Known Issues 已知問題

- Stock prices may have a slight delay (up to 1 minute) due to market data restrictions
  因市場資料限制，股價可能會有最多 1 分鐘的延遲

## Support & Feedback 支援與回饋

- Report issues on [GitHub](https://github.com/sssuperman/stock-monitor/issues)
  在 GitHub 上回報問題
- Send feedback via [email](mailto:sssuperman@gmail.com)
  透過 email 發送回饋

## Release Notes 版本資訊

### 0.2.5
- Enhanced authentication system with comprehensive login/logout management
  增強認證系統，提供完整的登入/登出管理
- Added new status bar integration showing connection, login, and portfolio profit status
  新增狀態欄整合，顯示連接狀態、登入狀態和投資組合收益狀況
- Refactored stock data synchronization
  重構股票資料同步機制
- Enhanced localization for authentication 
  增強認證和同步過程

### 0.2.4
- Added portfolio summary section showing total daily profit/loss and accumulated profit/loss
  新增投資組合摘要區塊，顯示今日總損益及累積總損益

### 0.2.2
- Improved proxy configuration with clearer settings and commands
  改進代理伺服器配置，提供更清晰的設定和命令
- Added cost and profit information to table view
  在表格視圖中添加成本和盈虧信息
- Removed unused configuration options for better clarity
  移除未使用的配置選項，提高清晰度
- Enhanced configuration checking command with detailed proxy status
  增強配置檢查命令，顯示詳細的代理狀態
- Add sidebar for portfolio management
  左側新增SideBar進行持股管理
  

### 0.1.7
- Added WebSocket support for real-time updates
  新增 WebSocket 支援，提供即時更新
- Improved error handling and notifications
  改善錯誤處理與通知機制
- Added price alerts feature
  新增價格提醒功能

### 0.1.0
- Initial release with basic monitoring features
  初始版本發布，包含基本監控功能

## License 授權條款

This extension is licensed under the MIT License.
此擴展採用 MIT 授權條款。
