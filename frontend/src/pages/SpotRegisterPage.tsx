/** [Gate WishPlaces] 場所の追加は行きたい場所の画面にまとめた(以前の URL は残す)。 */
import React from 'react';
import { Navigate } from 'react-router-dom';

const SpotRegisterPage: React.FC = () => <Navigate to="/spots?add=1" replace />;

export default SpotRegisterPage;
