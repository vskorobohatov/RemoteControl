import type { HTMLAttributes } from "react";
import { classnames, type Tone } from "./controls";
import styles from "./Card.module.scss";

interface CardProps extends HTMLAttributes<HTMLElement> {
  accent?: Tone;
  outline?: Tone;
  raised?: boolean;
  as?: "article" | "form" | "section";
}

export function Card({ as: Element = "article", accent, outline, raised, className, children, ...rest }: CardProps) {
  return (
    <Element
      className={classnames(
        styles.card,
        accent && styles.accent,
        accent && styles[`accent-${accent}`],
        outline && styles[`outline-${outline}`],
        raised && styles.raised,
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}
