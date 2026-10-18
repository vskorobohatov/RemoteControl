import { useEffect, useRef, type ReactNode } from "react";
import { Panel } from "./Panel";
import styles from "./Modal.module.scss";

interface ModalProps {
  title: string;
  kicker?: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ kicker, title, description, onClose, children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) {
          onClose();
        }
      }}
    >
      <Panel variant="sheet" className={styles.card}>
        {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
        <h3 className={styles.title}>{title}</h3>
        {description ? <p className={styles.description}>{description}</p> : null}
        {children}
      </Panel>
    </dialog>
  );
}
