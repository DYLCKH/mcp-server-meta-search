import { toast } from "sonner";

import type { PatRecord, SettingsData } from "@/lib/api";

export type AuthStatus = "checking" | "authenticated" | "guest";

export interface NavItem {
  path: string;
  label: string;
  description: string;
  shortLabel: string;
}

export interface RequestLogFilters {
  tool: string;
  provider: string;
  status: string;
  from: string;
  to: string;
}

export interface AuditLogFilters {
  action: string;
  target: string;
  from: string;
  to: string;
}

export const PAGE_SIZE = 50;

export const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    label: "Dashboard",
    description: "关键容量、令牌暴露面与运行状态总览。",
    shortLabel: "Overview",
  },
  {
    path: "/providers",
    label: "Providers",
    description: "集中处理 provider 池与 key 健康状态。",
    shortLabel: "Capacity",
  },
  {
    path: "/pats",
    label: "PATs",
    description: "管理客户端访问令牌与到期风险。",
    shortLabel: "Access",
  },
  {
    path: "/settings",
    label: "Settings",
    description: "直接调整重试、超时和 key 生命周期策略。",
    shortLabel: "Policy",
  },
  {
    path: "/logs",
    label: "Logs",
    description: "按请求和审计维度排查系统事件。",
    shortLabel: "Events",
  },
];

export const EMPTY_REQUEST_FILTERS: RequestLogFilters = {
  tool: "",
  provider: "",
  status: "",
  from: "",
  to: "",
};

export const EMPTY_AUDIT_FILTERS: AuditLogFilters = {
  action: "",
  target: "",
  from: "",
  to: "",
};

export const FIELD_META: Record<
  keyof SettingsData,
  { label: string; description: string }
> = {
  key_rotation_strategy: {
    label: "Key rotation strategy",
    description: "决定运行时如何在可用 key 之间分配请求。",
  },
  max_attempts_per_request: {
    label: "Max attempts per request",
    description: "单次请求在最终失败前允许的最大重试次数。",
  },
  request_timeout_ms: {
    label: "Request timeout (ms)",
    description: "每次上游 provider 请求的超时时间。",
  },
  key_recovery_interval_ms: {
    label: "Key recovery interval (ms)",
    description: "被禁用 key 重新进入轮转前的等待时间。",
  },
  max_disable_before_revoke: {
    label: "Max disables before revoke",
    description: "key 在被永久撤销前允许经历的禁用次数。",
  },
};

export function providerKeyDescription(
  key: { status: string; enabled: boolean },
) {
  if (key.status === "revoked") {
    return "已撤销，不能重新进入轮转，只能替换。";
  }

  if (key.enabled) {
    return "当前可参与流量分配。";
  }

  return "已从轮转中移出，等待人工恢复。";
}

export function statusVariant(status: string) {
  if (status === "active" || status === "success") {
    return "success" as const;
  }

  if (status === "disabled") {
    return "warning" as const;
  }

  if (status === "revoked" || status === "error") {
    return "destructive" as const;
  }

  return "outline" as const;
}

export function capitalize(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function summarizeNames(names: string[], max = 2) {
  if (names.length <= max) {
    return names.join(", ");
  }

  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export function isPatExpiringSoon(pat: PatRecord) {
  if (!pat.expiresAt) {
    return false;
  }

  const expiresAt = new Date(pat.expiresAt).getTime();
  const now = Date.now();
  return expiresAt >= now && expiresAt <= now + 7 * 24 * 60 * 60 * 1000;
}

export function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

export async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Failed to copy");
  }
}
