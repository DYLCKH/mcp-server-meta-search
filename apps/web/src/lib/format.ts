export function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

export function formatDuration(value?: number | null) {
  if (value == null) {
    return "-";
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  return `${(value / 1000).toFixed(2)}s`;
}

export function formatStrategy(value?: string | null) {
  if (value === "round_robin") {
    return "Round robin";
  }

  if (value === "random") {
    return "Random";
  }

  return value || "-";
}
