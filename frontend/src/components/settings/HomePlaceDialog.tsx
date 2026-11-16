/** [Gate HomePlace] 旅程の出発・帰着の行から開く「自宅の場所の設定」 */
import React from 'react';
import Modal from '@/components/common/Modal';
import HomePlaceForm from './HomePlaceForm';

const HomePlaceDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="自宅の場所の設定" size="md">
    <Modal.Body>
      {isOpen && <HomePlaceForm inDialog onDone={onClose} />}
    </Modal.Body>
  </Modal>
);

export default HomePlaceDialog;
