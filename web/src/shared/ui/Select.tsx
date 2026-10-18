import type { SelectHTMLAttributes } from "react";
import { classnames, type ClassMap, type ControlSize } from "./controls";
import field from "./Field.module.scss";

export interface SelectOption {
  value: string;
  label: string;
}

const SIZES: ClassMap<ControlSize> = {
  sm: field.sm,
  md: field.md,
  lg: field.lg,
};

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "onChange" | "size"> {
  label: string;
  options: readonly (string | SelectOption)[];
  onChange: (value: string) => void;
  size?: ControlSize;
}

function normalize(option: string | SelectOption): SelectOption {
  return typeof option === "string" ? { value: option, label: option } : option;
}

export function Select({ label, options, onChange, size = "md", className, ...rest }: SelectProps) {
  return (
    <label className={field.field}>
      <span className={field.label}>{label}</span>
      <select
        className={classnames(field.control, field.select, SIZES[size], className)}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      >
        {options.map((option) => {
          const { value, label: text } = normalize(option);
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}
