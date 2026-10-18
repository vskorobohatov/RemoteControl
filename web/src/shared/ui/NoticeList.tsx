import { classnames } from "./controls";
import styles from "./NoticeList.module.scss";

interface NoticeListProps {
  notices: readonly string[];
  className?: string;
}

export function NoticeList({ notices, className }: NoticeListProps) {
  if (notices.length === 0) return null;
  return (
    <div className={classnames(styles.notices, className)}>
      {notices.map((notice) => (
        <span key={notice} className={styles.notice}>
          {notice}
        </span>
      ))}
    </div>
  );
}
