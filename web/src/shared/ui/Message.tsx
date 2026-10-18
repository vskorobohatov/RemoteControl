import type { HTMLAttributes } from "react";
import { classnames, type Tone } from "./controls";
import styles from "./Message.module.scss";

interface MessageProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: Tone;
}

export function Message({ tone, className, children, ...rest }: MessageProps) {
  return (
    <p className={classnames(styles.message, tone && styles[`tone-${tone}`], className)} {...rest}>
      {children}
    </p>
  );
}
