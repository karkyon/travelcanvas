/** [Gate Remaining-6] FR-003 認証不要のアカウントの画面(1 つの塊にまとめて、最初に読む JS を増やさない) */
import React from 'react';
import { useLocation } from 'react-router-dom';
import ForgotPasswordPage from './ForgotPasswordPage';
import VerifyEmailPage from './VerifyEmailPage';

const AccountPages: React.FC = () => (useLocation().pathname.startsWith('/verify-email') ? <VerifyEmailPage /> : <ForgotPasswordPage />);

export default AccountPages;
