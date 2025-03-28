import React, { useState, useEffect, FormEvent } from 'react';
import { 
    VSCodeButton, 
    VSCodeTextField, 
    VSCodeTextArea, 
    VSCodeDivider 
} from '@vscode/webview-ui-toolkit/react';
import { vscode } from '../utilities/vscode';
import './FeedbackButton.css';

// 回饋類型
enum FeedbackType {
    FEATURE = '功能建議',
    QUESTION = '使用問題',
    ISSUE = '錯誤報告'
}

export interface SessionInfo {
    user?: string;
    email?: string;
    is_authenticated: boolean;
}

interface FeedbackButtonProps {
    sessionInfo: SessionInfo;
}

const FeedbackButton: React.FC<FeedbackButtonProps> = ({ sessionInfo }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [formStep, setFormStep] = useState(0);
    const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [email, setEmail] = useState('');
    const [emailError, setEmailError] = useState('');
    const [isFormValid, setIsFormValid] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // 驗證 email 格式
    const validateEmail = (email: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // 處理 email 變更
    const handleEmailChange = (e: Event | FormEvent<HTMLElement>) => {
        const target = e.target as HTMLInputElement;
        const newEmail = target.value;
        setEmail(newEmail);
        
        if (!newEmail.trim()) {
            setEmailError('電子郵件為必填項');
        } else if (!validateEmail(newEmail)) {
            setEmailError('請輸入有效的電子郵件地址');
        } else {
            setEmailError('');
        }
    };

    // 即時驗證表單
    useEffect(() => {
        const isEmailValid = sessionInfo.is_authenticated || (email.trim() && validateEmail(email));
        const isTitleValid = title.trim().length > 0;
        const isDescriptionValid = description.trim().length > 0;
        
        setIsFormValid(Boolean(isEmailValid && isTitleValid && isDescriptionValid));
    }, [title, description, email, sessionInfo.is_authenticated]);

    // 打開回饋表單
    const handleOpenFeedback = () => {
        setIsOpen(true);
        setFormStep(0);
        setSelectedType(null);
        setTitle('');
        setDescription('');
        setEmail('');
        setEmailError('');
        setSubmitted(false);
    };

    // 關閉反饋表單
    const handleClose = () => {
        setIsOpen(false);
    };

    // 選擇反饋類型
    const handleSelectType = (type: FeedbackType) => {
        setSelectedType(type);
        setFormStep(1);
    };

    // 提交反饋
    const handleSubmit = () => {
        if (!isFormValid) {
            return;
        }

        // 向擴展發送消息
        vscode.postMessage({
            command: 'submitFeedback',
            feedback: {
                type: selectedType,
                title,
                description,
                email: sessionInfo.is_authenticated ? undefined : email,
                timestamp: new Date().toISOString()
            }
        });

        // 顯示感謝信息
        setFormStep(2);
        setSubmitted(true);
        
        // 3秒後關閉反饋表單
        setTimeout(() => {
            setIsOpen(false);
        }, 3000);
    };

    // 返回選擇類型步驟
    const handleBack = () => {
        setFormStep(0);
    };

    return (
        <>
            {/* 浮動反饋按鈕 */}
            <button 
                className={`feedback-button ${isOpen ? 'active' : ''}`} 
                onClick={handleOpenFeedback}
                aria-label="提交反饋"
            >
                <span className="feedback-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </span>
            </button>

            {/* 反饋表單對話框 */}
            {isOpen && (
                <div className="feedback-overlay">
                    <div className="feedback-dialog">
                        <div className="feedback-header">
                            <h2>用戶反饋</h2>
                            <button className="close-button" onClick={handleClose}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                        <VSCodeDivider />
                        
                        <div className="feedback-content">
                            {/* 步驟 0: 選擇反饋類型 */}
                            {formStep === 0 && (
                                <div className="feedback-type-selection">
                                    <p>請選擇您想提交的回饋類型：</p>
                                    
                                    <div className="feedback-type-buttons">
                                        <VSCodeButton onClick={() => handleSelectType(FeedbackType.FEATURE)}>
                                            <span className="button-icon">⭐</span> 功能建議
                                        </VSCodeButton>
                                        
                                        <VSCodeButton onClick={() => handleSelectType(FeedbackType.QUESTION)}>
                                            <span className="button-icon">❓</span> 使用問題
                                        </VSCodeButton>
                                        
                                        <VSCodeButton onClick={() => handleSelectType(FeedbackType.ISSUE)}>
                                            <span className="button-icon">🐞</span> 錯誤報告
                                        </VSCodeButton>
                                    </div>
                                </div>
                            )}

                            {/* 步驟 1: 填寫反饋詳情 */}
                            {formStep === 1 && selectedType && (
                                <div className="feedback-form">
                                    <div className="selected-type">
                                        {selectedType === FeedbackType.FEATURE && <span className="type-badge feature">⭐ 功能建議</span>}
                                        {selectedType === FeedbackType.QUESTION && <span className="type-badge question">❓ 使用問題</span>}
                                        {selectedType === FeedbackType.ISSUE && <span className="type-badge issue">🐞 錯誤報告</span>}
                                    </div>
                                    
                                    <div className="form-group">
                                        <label htmlFor="feedback-title">標題</label>
                                        <VSCodeTextField 
                                            id="feedback-title"
                                            placeholder="簡單描述您的反饋內容"
                                            value={title}
                                            onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
                                        />
                                    </div>
                                    
                                    <div className="form-group">
                                        <label htmlFor="feedback-description">詳細描述</label>
                                        <VSCodeTextArea 
                                            id="feedback-description"
                                            placeholder={
                                                selectedType === FeedbackType.FEATURE ? "請描述您希望添加的功能..." :
                                                selectedType === FeedbackType.QUESTION ? "請詳細描述您遇到的問題或疑問..." :
                                                "請詳細描述您遇到的錯誤，如何重現等..."
                                            }
                                            value={description}
                                            onChange={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                                            rows={5}
                                        />
                                    </div>

                                    {/* 只在未登入時顯示 email 欄位 */}
                                    {!sessionInfo.is_authenticated && (
                                        <div className="form-group">
                                            <label htmlFor="feedback-email">電子郵件（必填）</label>
                                            <VSCodeTextField
                                                id="email"
                                                type="email"
                                                placeholder="請輸入您的電子郵件地址"
                                                value={email}
                                                onChange={handleEmailChange}
                                                ariaErrormessage={emailError}
                                            />
                                            {emailError && (
                                                <div className="error-message">
                                                    {emailError}
                                                </div>
                                            )}
                                            <small className="email-hint">我們將通過此郵件地址與您聯繫</small>
                                        </div>
                                    )}
                                    
                                    <div className="form-actions">
                                        <VSCodeButton appearance="secondary" onClick={handleBack}>
                                            返回
                                        </VSCodeButton>
                                        <VSCodeButton 
                                            onClick={handleSubmit}
                                            disabled={!isFormValid}
                                        >
                                            提交反饋
                                        </VSCodeButton>
                                    </div>
                                </div>
                            )}

                            {/* 步驟 2: 提交成功 */}
                            {formStep === 2 && submitted && (
                                <div className="feedback-success">
                                    <div className="success-icon">✓</div>
                                    <h3>感謝您的反饋！</h3>
                                    <p>我們已收到您的意見，並將盡快處理。</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default FeedbackButton; 