import React, { useState, useEffect, useRef } from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { IndiceData } from '../../../src/types';
import './StockListIndiceBar.css';

interface IndiceBarProps {
  indices: Record<string, IndiceData>;
}

export const IndiceBar: React.FC<IndiceBarProps> = ({ indices }) => {
  const [visible, setVisible] = useState<boolean>(true);
  const [updatedIndices, setUpdatedIndices] = useState<Record<string, boolean>>({});
  // 添加前一次指数值的引用
  const prevIndicesRef = useRef<Record<string, IndiceData>>({});

  // 當指數數據更新時，標記更新的指數
  useEffect(() => {
    // 创建新的更新标记对象
    const newUpdatedIndices: Record<string, boolean> = {};
    
    // 比较当前值和前一个值，仅标记变化的指数
    Object.keys(indices).forEach(symbol => {
      const currentIndice = indices[symbol];
      const prevIndice = prevIndicesRef.current[symbol];
      
      // 如果之前没有此指数或者指数值发生了变化，则标记为已更新
      if (!prevIndice || currentIndice.index !== prevIndice.index) {
        console.log(`指数 ${symbol} 更新: ${prevIndice?.index} -> ${currentIndice.index}`);
        newUpdatedIndices[symbol] = true;
      }
    });
    
    // 更新引用以备下次比较
    prevIndicesRef.current = {...indices};
    
    // 只有存在已更新的指数时才设置更新状态
    if (Object.keys(newUpdatedIndices).length > 0) {
      setUpdatedIndices(newUpdatedIndices);
      
      // 2秒後清除更新標記
      const timer = setTimeout(() => {
        setUpdatedIndices({});
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [indices]);

  const toggleVisibility = () => {
    setVisible(!visible);
  };

  // 格式化數字
  const formatNumber = (num: number | undefined): string => {
    if (num === undefined || isNaN(num)) {
      return '0.00';
    }
    return num.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // 格式化百分比
  const formatPercent = (num: number | undefined): string => {
    if (num === undefined || isNaN(num)) {
      return '+0.00%';
    }
    return `${(num > 0 ? '+' : '')}${num.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  // 排序指數，確保台灣加權指數和上櫃指數排在前面
  const sortedIndices = Object.entries(indices).sort(([symbolA], [symbolB]) => {
    if (symbolA === 'TAIEX') return -1;
    if (symbolB === 'TAIEX') return 1;
    if (symbolA === 'TPEx') return -1;
    if (symbolB === 'TPEx') return 1;
    return symbolA.localeCompare(symbolB);
  });

  return (
    <div className="indice-bar-container">
      <div className="indice-bar-header" onClick={toggleVisibility}>
        <span className="indice-bar-title">指數資訊</span>
        <VSCodeButton className="indice-toggle-button">
          {visible ? '隱藏' : '顯示'}
        </VSCodeButton>
      </div>
      
      {visible && (
        <div className="indice-bar-content">
          {sortedIndices.length === 0 ? (
            <div className="indice-no-data">無指數資料</div>
          ) : (
            <div className="indice-list">
              {sortedIndices.map(([symbol, indice]) => (
                <div 
                  key={symbol} 
                  className={`indice-item ${updatedIndices[symbol] ? 'flash-update' : ''}`}
                >
                  <div className="indice-name">
                    {indice.name || symbol}:
                  </div>
                  <div className={`indice-value ${indice.change && indice.change > 0 ? 'profit-up' : indice.change && indice.change < 0 ? 'profit-down' : ''}`}>
                    {formatNumber(indice.index)} 
                    <span>
                      {formatPercent(indice.changePercent)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}; 