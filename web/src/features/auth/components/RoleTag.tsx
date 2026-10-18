import type { HTMLAttributes } from "react";
import type { UserRole } from "@server/types";
import { Tag } from "@shared/ui/Status";

const ROLE_TONE: Record<UserRole, "primary" | "accent" | undefined> = {
  admin: "primary",
  manager: "accent",
  guest: undefined,
};

export function RoleTag({ role, ...rest }: HTMLAttributes<HTMLSpanElement> & { role: UserRole }) {
  return (
    <Tag tone={ROLE_TONE[role]} {...rest}>
      {role}
    </Tag>
  );
}
